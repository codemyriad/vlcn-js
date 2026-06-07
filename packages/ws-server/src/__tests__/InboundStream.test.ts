import { test, expect } from "vitest";
import { tags } from "@vlcn.io/ws-common";
import type { Changes } from "@vlcn.io/ws-common";
import InboundStream from "../streams/InboundStream.js";
import type { IDB } from "../DB.js";
import type Transport from "../Trasnport.js";

// A crsql_changes row tuple: [table, pk, cid, val, col_version, db_version, site_id, cl, seq].
// InboundStream only reads index 5 (db_version).
function change(dbVersion: bigint): any {
  return ["item", new Uint8Array([1]), "v", null, 1n, dbVersion, null, 1n, 0];
}

function fakeDb(applied: any[][]): IDB {
  return {
    siteId: new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]),
    schemaName: "test",
    schemaVersion: 1n,
    getLastSeen: (_site: Uint8Array) => [1n, 0] as const,
    applyChangesetAndSetLastSeen: (changes: any[]) => {
      applied.push(changes);
    },
  } as unknown as IDB;
}

function recordingTransport(): {
  transport: Transport;
  rejects: any[];
  statuses: any[];
} {
  const rejects: any[] = [];
  const statuses: any[] = [];
  const transport = {
    startStreaming: () => {},
    rejectChanges: (msg: any) => rejects.push(msg),
    sendSyncStatus: (msg: any) => statuses.push(msg),
  } as unknown as Transport;
  return { transport, rejects, statuses };
}

const sender = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

test("rejects a gapped changeset and does NOT apply it or advance the cursor", async () => {
  const applied: any[][] = [];
  const db = fakeDb(applied);
  const { transport, rejects } = recordingTransport();

  const stream = new InboundStream(transport, db, sender);
  stream.start(); // lastSeen = [1, 0]

  // A changeset that begins AFTER a gap: since = [2, 0] but we have only applied up to [1, 0].
  const gapped: Changes = {
    _tag: tags.Changes,
    sender,
    since: [2n, 0],
    changes: [change(3n)],
  } as Changes;
  await stream.receiveChanges(gapped);

  // The sender is asked to rewind to our last-seen...
  expect(rejects).toHaveLength(1);
  expect(rejects[0].since).toEqual([1n, 0]);

  // ...and crucially the non-contiguous batch is NOT applied. Before the fix this was [ [change(3)] ]
  // and the cursor advanced to [3, 0], so the missing db_version 2 was lost forever and never
  // re-requested — silent permanent divergence between peers.
  expect(applied).toHaveLength(0);
});

test("applies a contiguous changeset normally", async () => {
  const applied: any[][] = [];
  const db = fakeDb(applied);
  const { transport, rejects } = recordingTransport();

  const stream = new InboundStream(transport, db, sender);
  stream.start(); // lastSeen = [1, 0]

  // Contiguous: since = [1, 0] matches our last-seen.
  const contiguous: Changes = {
    _tag: tags.Changes,
    sender,
    since: [1n, 0],
    changes: [change(2n), change(3n)],
  } as Changes;
  await stream.receiveChanges(contiguous);

  expect(rejects).toHaveLength(0);
  expect(applied).toHaveLength(1);
  expect(applied[0]).toHaveLength(2);
});
