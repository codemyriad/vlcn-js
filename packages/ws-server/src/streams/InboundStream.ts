import { Changes, greaterThanOrEqual, tags, type SyncStatus } from "@vlcn.io/ws-common";
import DB, { IDB } from "../DB.js";
import Transport from "../Trasnport.js";

/**
 * Processes a stream of changes from the given sender.
 * Sends the sender a rejection if the changes are out of order.
 *
 * TODO: make this isomorphic with the client? It should be the same logic on both sides.
 * Well.. except that on the server our db interface is synchronous.
 */
export default class InboundStream {
  readonly #transport;
  readonly #db;
  readonly #from;
  #lastSeen: readonly [bigint, number] | null = null;
  #sentSteadyStatus = false;

  constructor(transport: Transport, db: IDB, from: Uint8Array) {
    this.#transport = transport;
    this.#db = db;
    this.#from = from;
  }

  start() {
    // figure out our last seen from `from`
    // send the request for the client to start streaming
    this.#lastSeen = this.#db.getLastSeen(this.#from);

    // Tell the connected client to start streaming
    this.#transport.startStreaming({
      _tag: tags.StartStreaming,
      excludeSites: [this.#db.siteId],
      localOnly: false,
      since: this.#lastSeen,
    });

    // Immediately acknowledge readiness so the client can exit "connecting" even if there
    // are no inbound changes to apply yet.
    this.#sendApplyStatus(true, this.#lastSeen);
  }

  async receiveChanges(msg: Changes) {
    // check for contiguity
    // apply
    if (this.#lastSeen == null) {
      throw new Error(
        `Illegal state -- last seen should not be null when receiving changes`
      );
    }

    if (!greaterThanOrEqual(this.#lastSeen, msg.since)) {
      // Gap detected: this changeset starts after the version we have actually applied. Ask the
      // sender to rewind and re-send from our last-seen, and STOP — do NOT apply this
      // non-contiguous batch. Applying it (and advancing #lastSeen / the durable tracked_peers
      // cursor below) past the gap silently and permanently dropped the missing range: the server
      // marked itself caught up, never re-requested it, and the peer's committed changes were lost
      // on the server and every other peer. Mirrors the client InboundStream, which returns
      // immediately after rejecting.
      this.#transport.rejectChanges({
        _tag: tags.RejectChanges,
        whose: msg.sender,
        since: this.#lastSeen,
      });
      return;
    }

    try {
      if (msg.changes.length > 0) {
        const lastChange = msg.changes[msg.changes.length - 1];
        const newLastSeen = [lastChange[5], 0] as const;
        await this.#db.applyChangesetAndSetLastSeen(
          msg.changes,
          msg.sender,
          newLastSeen
        );

        this.#lastSeen = newLastSeen;
      }
      this.#sendApplyStatus(true, this.#lastSeen);
    } catch (err) {
      this.#sendApplyStatus(false, null, err);
      throw err;
    }
  }

  #sendApplyStatus(
    ok: boolean,
    lastSeen: readonly [bigint, number] | null,
    err?: unknown
  ) {
    if (ok && lastSeen == null) {
      return;
    }
    const stage = ok
      ? this.#sentSteadyStatus
        ? ("apply_ack" as SyncStatus["stage"])
        : ("steady" as SyncStatus["stage"])
      : ("steady" as SyncStatus["stage"]);

    if (ok && !this.#sentSteadyStatus) {
      this.#sentSteadyStatus = true;
    }

    const status: SyncStatus = ok
      ? {
          _tag: tags.SyncStatus,
          ok,
          stage,
          siteId: this.#db.siteId,
          schemaName: this.#db.schemaName,
          schemaVersion: this.#db.schemaVersion,
          schemaHash: this.#db.schemaVersion.toString(),
          ackDbVersion: lastSeen?.[0],
        }
      : {
          _tag: tags.SyncStatus,
          ok,
          stage: this.#sentSteadyStatus ? "apply_ack" : "steady",
          siteId: this.#db.siteId,
          schemaName: this.#db.schemaName,
          schemaVersion: this.#db.schemaVersion,
          schemaHash: this.#db.schemaVersion.toString(),
          reason: "apply_failed",
          message: err instanceof Error ? err.message : String(err ?? "unknown"),
        };

    this.#transport.sendSyncStatus(status);
  }
}
