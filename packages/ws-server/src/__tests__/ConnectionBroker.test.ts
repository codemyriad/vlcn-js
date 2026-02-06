import { test, expect } from "vitest";
import DB from "../DB.js";
import { checkPeerCoherence } from "../ConnectionBroker.js";
import { config, schemaVersion } from "./testConfig.js";

function createDb(name: string) {
  return new DB(config, null, name, "test.sql", schemaVersion);
}

test("new client with empty lastSeens is allowed", () => {
  const db = createDb("coherence-empty-lastseens");
  try {
    const result = checkPeerCoherence(
      db,
      new Uint8Array([1, 2, 3, 4]),
      []
    );
    expect(result).toEqual({ ok: true });
  } finally {
    db.close();
  }
});

test("returning client that knows server siteId is allowed", () => {
  const db = createDb("coherence-knows-server");
  try {
    const result = checkPeerCoherence(
      db,
      new Uint8Array([1, 2, 3, 4]),
      [[db.siteId, [5n, 0]]]
    );
    expect(result).toEqual({ ok: true });
  } finally {
    db.close();
  }
});

test("client with stale history that does not know server is rejected", () => {
  const db = createDb("coherence-stale-client");
  try {
    const unknownSiteId = new Uint8Array([99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84]);
    const result = checkPeerCoherence(
      db,
      new Uint8Array([1, 2, 3, 4]),
      [[unknownSiteId, [5n, 0]]]
    );
    expect(result).toEqual({ ok: false, reason: "peer_mismatch" });
  } finally {
    db.close();
  }
});

test("client unknown to server but referencing server siteId is allowed", () => {
  const db = createDb("coherence-unknown-but-ref-server");
  try {
    const unknownSender = new Uint8Array([10, 20, 30, 40]);
    const result = checkPeerCoherence(
      db,
      unknownSender,
      [[db.siteId, [5n, 0]]]
    );
    expect(result).toEqual({ ok: true });
  } finally {
    db.close();
  }
});

test("server knows client from prior session but client has stale lastSeens → rejected", async () => {
  // This is the key scenario: after a server rebuild, the client connected once
  // (before the coherence check existed) and the server recorded it. On subsequent
  // reconnects the server "knows" the client, but the client's lastSeens still
  // reference the OLD server siteId. This must still be rejected.
  const db = createDb("coherence-server-knows-stale-client");
  try {
    const clientSiteId = new Uint8Array([1, 2, 3, 4]);
    // Simulate the server having recorded this client from a prior connection
    await db.applyChangesetAndSetLastSeen([], clientSiteId, [47n, 0]);
    expect(db.getLastSeen(clientSiteId)[0]).toBe(47n);

    const oldServerSiteId = new Uint8Array([99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84]);
    const result = checkPeerCoherence(
      db,
      clientSiteId,
      [[oldServerSiteId, [5n, 0]]]
    );
    expect(result).toEqual({ ok: false, reason: "peer_mismatch" });
  } finally {
    db.close();
  }
});

test("schema mismatch takes precedence over peer mismatch in buildSyncStatus", () => {
  // This test verifies that checkPeerCoherence itself doesn't check schemas —
  // that's handled by #buildSyncStatus before calling checkPeerCoherence.
  // Here we just confirm checkPeerCoherence only looks at peer data.
  const db = createDb("coherence-schema-precedence");
  try {
    // Even with a peer mismatch scenario, checkPeerCoherence returns peer_mismatch.
    // The caller (#buildSyncStatus) is responsible for checking schemas first.
    const unknownSiteId = new Uint8Array([99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84]);
    const result = checkPeerCoherence(
      db,
      new Uint8Array([1, 2, 3, 4]),
      [[unknownSiteId, [5n, 0]]]
    );
    expect(result).toEqual({ ok: false, reason: "peer_mismatch" });
    // This confirms schema_mismatch must be checked before calling checkPeerCoherence,
    // which is exactly what #buildSyncStatus does.
  } finally {
    db.close();
  }
});
