import SQLiteAsyncESMFactory from "./crsqlite.mjs";
import * as SQLite from "@vlcn.io/wa-sqlite";
// @ts-ignore
import { IDBBatchAtomicVFS } from "@vlcn.io/wa-sqlite/src/examples/IDBBatchAtomicVFS.js";
import { serialize, topLevelMutex } from "./serialize.js";
import { DB } from "./DB.js";
export { DB } from "./DB.js";

let api: SQLite3 | null = null;
type SQLiteAPI = ReturnType<typeof SQLite.Factory>;

export class SQLite3 {
  constructor(private base: SQLiteAPI) {}

  open(filename: string = ":memory:", mode: string = "c", vfs_name?: string) {
    return serialize(
      null,
      undefined,
      () => {
        return this.base.open_v2(
          filename,
          SQLite.SQLITE_OPEN_CREATE |
            SQLite.SQLITE_OPEN_READWRITE |
            SQLite.SQLITE_OPEN_URI,
          // My understanding is that filename = ":memory:" case doesn't care about the vfs_name, whereas not specifying
          // the vfs_name will use the default vfs (which is the desired VFS if set up using 'iniwWasm')
          vfs_name
        );
      },
      topLevelMutex
    ).then((db: any) => {
      const ret = new DB(this.base, db, filename || ":memory:");
      return ret
        .prepare(
          `SELECT tbl_name FROM tables_used(?) AS u
        JOIN sqlite_master ON sqlite_master.name = u.name
        WHERE u.schema = 'main'`
        )
        .then((stmt) => {
          stmt.raw(true);
          ret._setTablesUsedStmt(stmt);
        })
        .then(() => ret.execA("select quote(crsql_site_id());"))
        .then((siteid) => {
          ret._setSiteid(siteid[0][0].replace(/'|X/g, ""));
          return ret;
        });
    });
  }
}

export type InitWasmOptions = {
  APIFactory?: (moduleArg?: Record<string, any>) => Promise<SQLiteAPI>;
  locateWasm?: (file: string) => string;
  vfsFactory?: (module: SQLiteAPI) => Promise<SQLiteVFS>;
};

export default async function initWasm({
  APIFactory = SQLiteAsyncESMFactory,
  locateWasm,
  vfsFactory = (module) => IDBBatchAtomicVFS.create("idb-batch-atomic", module),
}: InitWasmOptions): Promise<SQLite3> {
  if (api != null) {
    return api;
  }

  const wasmModule = await APIFactory({
    locateFile(file: string) {
      if (locateWasm) {
        return locateWasm(file);
      }
      return new URL("crsqlite.wasm", import.meta.url).href;
    },
  });
  const sqlite3 = SQLite.Factory(wasmModule);
  const vfs = await vfsFactory(wasmModule);
  sqlite3.vfs_register(vfs, true);

  api = new SQLite3(sqlite3);
  return api;
}
