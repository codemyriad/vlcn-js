import * as decoding from "lib0/decoding";
import {
  AnnouncePresence,
  Change,
  Changes,
  Err,
  CreateDbOnPrimary,
  ApplyChangesOnPrimary,
  ApplyChangesOnPrimaryResponse,
  Msg,
  Ping,
  Pong,
  RejectChanges,
  StartStreaming,
  SyncStatus,
  TagValues,
  tags,
  CreateDbOnPrimaryResponse,
} from "./msgTypes.js";
import { BIGINT, BLOB, BOOL, NULL, NUMBER, STRING } from "./encode.js";

export function decode(msg: Uint8Array): Msg {
  const decoder = decoding.createDecoder(msg);
  const tag = decoding.readUint8(decoder) as TagValues;
  switch (tag) {
    case tags.AnnouncePresence:
      return {
        _tag: tags.AnnouncePresence,
        sender: decoding.readUint8Array(decoder, 16),
        lastSeens: Array.from({ length: decoding.readVarUint(decoder) }).map(
          (_) => {
            return [
              decoding.readUint8Array(decoder, 16),
              [decoding.readBigInt64(decoder), decoding.readVarInt(decoder)],
            ];
          }
        ),
        schemaName: decoding.readVarString(decoder),
        schemaVersion: decoding.readBigInt64(decoder),
      } satisfies AnnouncePresence;
    case tags.Changes:
      return {
        _tag: tags.Changes,
        sender: decoding.readUint8Array(decoder, 16),
        since: [decoding.readBigInt64(decoder), decoding.readVarInt(decoder)],
        changes: readChanges(decoder),
      } satisfies Changes;
    case tags.RejectChanges:
      return {
        _tag: tags.RejectChanges,
        whose: decoding.readUint8Array(decoder, 16),
        since: [decoding.readBigInt64(decoder), decoding.readVarInt(decoder)],
      } satisfies RejectChanges;
    case tags.StartStreaming:
      return {
        _tag: tags.StartStreaming,
        since: [decoding.readBigInt64(decoder), decoding.readVarInt(decoder)],
        excludeSites: Array.from({ length: decoding.readVarUint(decoder) }).map(
          (_) => {
            return decoding.readUint8Array(decoder, 16);
          }
        ),
        localOnly: decoding.readUint8(decoder) == 1 ? true : false,
      } satisfies StartStreaming;
    case tags.CreateDbOnPrimary:
      return {
        _tag: tags.CreateDbOnPrimary,
        _reqid: decoding.readVarInt(decoder),
        room: decoding.readVarString(decoder),
        schemaName: decoding.readVarString(decoder),
        schemaVersion: decoding.readBigInt64(decoder),
      } satisfies CreateDbOnPrimary;
    case tags.ApplyChangesOnPrimary:
      return {
        _tag: tags.ApplyChangesOnPrimary,
        _reqid: decoding.readVarInt(decoder),
        sender: decoding.readUint8Array(decoder, 16),
        changes: readChanges(decoder),
        room: decoding.readVarString(decoder),
        newLastSeen: [
          decoding.readBigInt64(decoder),
          decoding.readVarInt(decoder),
        ],
      } satisfies ApplyChangesOnPrimary;
    case tags.Ping:
    case tags.Pong:
      return {
        _tag: tag,
      } satisfies Ping | Pong;
    case tags.ApplyChangesOnPrimaryResponse:
      return {
        _tag: tag,
        _reqid: decoding.readVarInt(decoder),
      } satisfies ApplyChangesOnPrimaryResponse;
    case tags.CreateDbOnPrimaryResponse:
      return {
        _tag: tag,
        _reqid: decoding.readVarInt(decoder),
        txid: decoding.readBigInt64(decoder),
      } satisfies CreateDbOnPrimaryResponse;
    case tags.Err:
      return {
        _tag: tags.Err,
        _reqid: decoding.readVarInt(decoder),
        err: decoding.readVarString(decoder),
      } satisfies Err;
    case tags.SyncStatus: {
      const ok = decoding.readUint8(decoder) === 1;

      let siteId: Uint8Array | undefined;
      if (decoding.hasContent(decoder) && decoding.readUint8(decoder) === 1) {
        siteId = decoding.readVarUint8Array(decoder);
      }

      let schemaName: string | undefined;
      if (decoding.hasContent(decoder) && decoding.readUint8(decoder) === 1) {
        schemaName = decoding.readVarString(decoder);
      }

      let schemaVersion: bigint | undefined;
      if (decoding.hasContent(decoder) && decoding.readUint8(decoder) === 1) {
        schemaVersion = decoding.readBigInt64(decoder);
      }

      let schemaHash: string | undefined;
      if (decoding.hasContent(decoder) && decoding.readUint8(decoder) === 1) {
        schemaHash = decoding.readVarString(decoder);
      }

      let stage: SyncStatus["stage"];
      if (decoding.hasContent(decoder) && decoding.readUint8(decoder) === 1) {
        stage = decoding.readVarString(decoder) as SyncStatus["stage"];
      }

      let ackDbVersion: bigint | undefined;
      if (decoding.hasContent(decoder) && decoding.readUint8(decoder) === 1) {
        ackDbVersion = decoding.readBigInt64(decoder);
      }

      let reason: string | undefined;
      if (decoding.hasContent(decoder) && decoding.readUint8(decoder) === 1) {
        reason = decoding.readVarString(decoder);
      }

      let message: string | undefined;
      if (decoding.hasContent(decoder) && decoding.readUint8(decoder) === 1) {
        message = decoding.readVarString(decoder);
      }

      return {
        _tag: tags.SyncStatus,
        ok,
        siteId,
        schemaName,
        schemaVersion,
        schemaHash,
        stage,
        ackDbVersion,
        reason,
        message,
      } satisfies SyncStatus;
    }
    default:
      tag as never;
  }

  throw new Error(`Unexpected tag: ${tag}`);
}

function readChanges(decoder: decoding.Decoder) {
  return Array.from({ length: decoding.readVarUint(decoder) }, () => [
    decoding.readVarString(decoder),
    decoding.readVarUint8Array(decoder),
    decoding.readVarString(decoder),
    (() => {
      const type = decoding.readUint8(decoder);
      switch (type) {
        case NULL:
          return null;
        case BIGINT:
          return decoding.readBigInt64(decoder);
        case NUMBER:
          return decoding.readFloat64(decoder);
        case STRING:
          return decoding.readVarString(decoder);
        case BOOL:
          return decoding.readUint8(decoder) === 1 ? true : false;
        case BLOB:
          return decoding.readVarUint8Array(decoder);
      }
      throw new Error(`Unknown type ${type}`);
    })(),
    decoding.readBigInt64(decoder),
    decoding.readBigInt64(decoder),
    (() => {
      const type = decoding.readUint8(decoder);
      if (type == NULL) {
        return null;
      } else {
        return decoding.readUint8Array(decoder, 16);
      }
    })(),
    decoding.readBigInt64(decoder),
    decoding.readVarInt(decoder),
  ]) satisfies Change[];
}
