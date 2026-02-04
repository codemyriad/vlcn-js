import { Msg, decode, encode, tags, type AnnouncePresence, type SyncStatus } from "@vlcn.io/ws-common";
import SyncConnection, { createSyncConnection } from "./SyncConnection.js";
import DBCache from "./DBCache.js";
import { WebSocket } from "ws";
import Transport from "./Trasnport.js";
import { logger } from "@vlcn.io/logger-provider";

export type Options = {
  ws: WebSocket;
  dbCache: DBCache;
  room: string;
};

/**
 * A connection broker maps PartyKit connections to Database Sync connections
 * and dispatches messages from the PartyKitConnection to the appropriate
 * SyncConnection methods.
 */
export default class ConnectionBroker {
  #syncConnection: SyncConnection | null = null;
  readonly #dbCache;
  readonly #ws;
  readonly #room;
  readonly #transport;
  #closed = false;

  constructor({ ws, dbCache, room }: Options) {
    this.#dbCache = dbCache;
    this.#ws = ws;
    this.#room = room;
    this.#transport = new Transport(ws);

    this.#ws.on("message", async (data) => {
      // TODO: for litefs support we should just read the tag out
      // then pass the message to the primary
      const msg = decode(new Uint8Array(data as any));
      try {
        await this.#handleMessage(msg);
      } catch (e) {
        console.error(e);
        this.close();
      }
    });
    this.#ws.on("close", () => {
      this.close();
    });
    this.#ws.on("error", () => {
      this.close();
    });
    // TODO: impl ping & pong heartbeat
    // so we can force close if we don't get a close event.
    // this.#ws.on("pong", () => {});
    // this.#ws.on("ping", () => {});
  }

  async #handleMessage(msg: Msg) {
    const tag = msg._tag;

    switch (tag) {
      case tags.Ping: {
        this.#ws.send(encode({ _tag: tags.Pong }));
        return;
      }
      // Note: room could go in the `AnnouncePresence` message instead of the random headers.
      case tags.AnnouncePresence: {
        logger.info(`AnnouncePresence for: ${this.#room}`);
        if (this.#syncConnection != null) {
          throw new Error(
            `A sync connection for ${
              this.#room
            } was already started for the given websocket`
          );
        }

        const status = await this.#buildSyncStatus(msg);
        this.#transport.sendSyncStatus(status);

        if (!status.ok) {
          logger.warn(`Closing connection for ${this.#room} due to incompatible sync status: ${status.reason || "unknown"}`);
          this.#ws.close(1011, "sync_incompatible");
          return;
        }

        try {
          const syncConnection = await createSyncConnection(
            this.#dbCache,
            this.#transport,
            this.#room,
            msg
          );
          this.#syncConnection = syncConnection;
          syncConnection.start();
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          logger.error(`Failed to create sync connection for ${this.#room}: ${reason}`);
          this.#transport.sendSyncStatus({
            _tag: tags.SyncStatus,
            ok: false,
            reason: "server_error",
            message: reason,
            stage: "handshake",
          });
          this.close();
          this.#ws.close(1011, "sync_setup_failed");
        }
        return;
      }
      case tags.Changes: {
        // get our synced db from the cache
        // apply the changes
        // if no inbound stream is started, this'll start one.
        const syncConn = this.#syncConnection!;
        await syncConn.receiveChanges(msg);
        return;
      }
      case tags.RejectChanges: {
        // get our synced db, tell it changes were rejected
        const syncConn = this.#syncConnection!;
        syncConn.changesRejected(msg);
        return;
      }
      case tags.StartStreaming: {
        throw new Error(
          `Illegal state -- servers do not process the "StartTreaming" message`
        );
        // the server does not process this message. It sends this message
        // to a client after a client has announced its presence.
        return;
      }
    }
  }

  close() {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#syncConnection?.close();
  }

  async #buildSyncStatus(msg: AnnouncePresence): Promise<SyncStatus> {
    try {
      return await this.#dbCache.use(this.#room, msg.schemaName, async (db) => {
        const schemaMismatch =
          db.schemaName !== msg.schemaName || db.schemaVersion !== msg.schemaVersion;
        const lastSeen = db.getLastSeen(msg.sender);

        return {
          _tag: tags.SyncStatus,
          ok: !schemaMismatch,
          siteId: db.siteId,
          schemaName: db.schemaName,
          schemaVersion: db.schemaVersion,
          schemaHash: db.schemaVersion.toString(),
          ackDbVersion: lastSeen?.[0],
          stage: "handshake",
          reason: schemaMismatch ? "schema_mismatch" : undefined,
          message: schemaMismatch
            ? `Server schema ${db.schemaVersion.toString()} does not match client ${msg.schemaVersion.toString()}`
            : undefined,
        };
      });
    } catch (err) {
      return {
        _tag: tags.SyncStatus,
        ok: false,
        reason: "server_error",
        message: err instanceof Error ? err.message : String(err),
        stage: "handshake",
      };
    }
  }
}
