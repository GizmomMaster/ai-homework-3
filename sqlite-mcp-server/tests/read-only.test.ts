import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createFixtureDb } from "./fixture.js";
import { withClient, textOf, jsonOf } from "./client.js";

let fixture: ReturnType<typeof createFixtureDb>;
before(() => { fixture = createFixtureDb(); });
after(() => fixture.cleanup());

const REJECTED = [
  ["plain DELETE", "DELETE FROM orders WHERE status = 'cancelled'"],
  ["plain INSERT", "INSERT INTO products (name, category, price, stock_quantity, created_at) VALUES ('x','y',1,1,'2024-01-01')"],
  ["plain UPDATE", "UPDATE orders SET status = 'new'"],
  ["plain DROP", "DROP TABLE orders"],
  ["plain ALTER", "ALTER TABLE orders ADD COLUMN hacked TEXT"],
  ["plain CREATE", "CREATE TABLE evil (id INTEGER)"],
  ["PRAGMA trick", "PRAGMA writable_schema=1"],
  ["data-modifying CTE disguised as WITH", "WITH x AS (SELECT 1) DELETE FROM orders"],
  ["stacked statements", "SELECT 1; DELETE FROM orders;"],
  ["REPLACE INTO", "REPLACE INTO products (id, name, category, price, stock_quantity, created_at) VALUES (1,'x','y',1,1,'2024-01-01')"],
] as const;

for (const [label, sql] of REJECTED) {
  test(`run_query rejects: ${label}`, async () => {
    await withClient(fixture.dbPath, async (client) => {
      const result: any = await client.callTool({ name: "run_query", arguments: { sql } });
      assert.equal(result.isError, true, `expected "${sql}" to be rejected`);
    });
  });
}

test("run_query does not actually mutate the database when a destructive statement is attempted", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const before = jsonOf(await client.callTool({ name: "run_query", arguments: { sql: "SELECT COUNT(*) AS n FROM orders" } }));
    await client.callTool({ name: "run_query", arguments: { sql: "DELETE FROM orders" } });
    await client.callTool({ name: "run_query", arguments: { sql: "WITH x AS (SELECT 1) DELETE FROM orders" } });
    const after = jsonOf(await client.callTool({ name: "run_query", arguments: { sql: "SELECT COUNT(*) AS n FROM orders" } }));
    assert.deepEqual(after.rows, before.rows);
  });
});

test("run_query allows a plain SELECT", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const result = await client.callTool({ name: "run_query", arguments: { sql: "SELECT COUNT(*) AS n FROM orders" } });
    const body = jsonOf(result);
    assert.equal(body.rows[0].n, 6);
  });
});

test("run_query allows WITH ... SELECT", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const result = await client.callTool({
      name: "run_query",
      arguments: { sql: "WITH totals AS (SELECT status, COUNT(*) AS n FROM orders GROUP BY status) SELECT * FROM totals" },
    });
    const body = jsonOf(result);
    assert.ok(body.rows.length > 0);
  });
});

test("there is no dedicated write tool exposed at all", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name.toLowerCase());
    for (const bad of ["insert", "update", "delete", "drop", "write", "mutate"]) {
      assert.ok(!names.some((n) => n.includes(bad)), `found a suspicious tool name containing "${bad}"`);
    }
  });
});
