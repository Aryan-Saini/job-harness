import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.JH_DB = join(mkdtempSync(join(tmpdir(), "jh-sql-")), "jh.db");
const { query } = await import("../src/db.ts");
const { table } = await import("../src/table.ts");

describe("jh sql", () => {
  it("reads, and refuses writes unless asked", () => {
    expect(query("select 1 as one;")).toEqual([{ one: 1 }]);
    expect(() => query("insert into kv (key, value) values ('a', '1')")).toThrow(/readonly/);
    expect(query("insert into kv (key, value) values ('a', '1') returning key", { write: true })).toEqual([{ key: "a" }]);
    // Read-only was per call: the harness's own writes still work after a refused one.
    expect(query("select value from kv where key = 'a' -- trailing; comment")).toEqual([{ value: "1" }]);
  });

  it("takes one statement, ignoring semicolons in strings and comments", () => {
    expect(query("select ';' as s /* ; */")).toEqual([{ s: ";" }]);
    expect(() => query("select 1; delete from kv")).toThrow(/One statement/);
  });

  it("prints aligned one-line cells", () => {
    expect(table([{ a: 1, b: "x\ny" }, { a: null, b: "long" }])).toBe("a | b\n--+-----\n1 | x⏎y\n  | long\n(2 rows)");
    expect(table([{ b: "abcdef" }], 4)).toBe("b\n----\nabc…\n(1 row)");
  });
});
