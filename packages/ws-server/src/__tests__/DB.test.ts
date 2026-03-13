import { test, expect } from "vitest";
import DB from "../DB.js";
import fs from "node:fs";
import { Config } from "../config.js";
import { cryb64 } from "@vlcn.io/ws-common";
import DBFactory from "../DBFactory.js";

test("db instantiation", () => {
  const config: Config = {
    schemaFolder: "./testSchemas",
    dbFolder: null,
    pathPattern: /\/vlcn-ws/,
  };

  const schemaContent = fs.readFileSync("./testSchemas/test.sql", "utf-8");
  const schemaVersion = cryb64(schemaContent);
  const db = new DB(config, null, "some-db", "test.sql", schemaVersion);
  expect(db).toBeDefined();
  db.close();
});

test("pull changes", () => {});

test("write changes", () => {});

test("get last seen", () => {});

// TODO: test schema migration

test("methods no-op safely after close", async () => {
  const config: Config = {
    schemaFolder: "./testSchemas",
    dbFolder: null,
    pathPattern: /\/vlcn-ws/,
  };

  const schemaContent = fs.readFileSync("./testSchemas/test.sql", "utf-8");
  const schemaVersion = cryb64(schemaContent);
  const db = new DB(config, null, "closed-db", "test.sql", schemaVersion);
  db.close();

  expect(db.getLastSeen(new Uint8Array([1, 2, 3]))).toEqual([0n, 0]);
  expect(() =>
    db.pullChangeset([0n, 0], new Uint8Array([9, 9, 9]))
  ).not.toThrow();
  await expect(
    db.applyChangesetAndSetLastSeen([], new Uint8Array([4, 5, 6]), [1n, 0])
  ).resolves.toBeUndefined();
});
