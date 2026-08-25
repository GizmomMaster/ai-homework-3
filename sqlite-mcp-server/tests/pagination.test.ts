import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createFixtureDb, EXPECTED } from "./fixture.js";
import { withClient, jsonOf, textOf } from "./client.js";

let fixture: ReturnType<typeof createFixtureDb>;
before(() => { fixture = createFixtureDb(); });
after(() => fixture.cleanup());

test("run_query paginates: 6 orders / limit 2 -> three full pages, then hasMore=false", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const sql = "SELECT id FROM orders ORDER BY id";

    const page0 = jsonOf(await client.callTool({ name: "run_query", arguments: { sql, limit: 2, offset: 0 } }));
    assert.deepEqual(page0.rows.map((r: any) => r.id), [1, 2]);
    assert.equal(page0.hasMore, true);
    assert.equal(page0.nextOffset, 2);

    const page1 = jsonOf(await client.callTool({ name: "run_query", arguments: { sql, limit: 2, offset: page0.nextOffset } }));
    assert.deepEqual(page1.rows.map((r: any) => r.id), [3, 4]);
    assert.equal(page1.hasMore, true);
    assert.equal(page1.nextOffset, 4);

    const page2 = jsonOf(await client.callTool({ name: "run_query", arguments: { sql, limit: 2, offset: page1.nextOffset } }));
    assert.deepEqual(page2.rows.map((r: any) => r.id), [5, 6]);
    assert.equal(page2.hasMore, false);
    assert.equal(page2.nextOffset, null);
  });
});

test("run_query pages preserve the query's own ORDER BY (no duplicate/missing/reordered rows)", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const sql = "SELECT id FROM orders ORDER BY total_amount DESC";
    const wholeSet = jsonOf(await client.callTool({ name: "run_query", arguments: { sql, limit: 6 } })).rows.map((r: any) => r.id);

    const p0 = jsonOf(await client.callTool({ name: "run_query", arguments: { sql, limit: 3, offset: 0 } })).rows.map((r: any) => r.id);
    const p1 = jsonOf(await client.callTool({ name: "run_query", arguments: { sql, limit: 3, offset: 3 } })).rows.map((r: any) => r.id);

    assert.deepEqual([...p0, ...p1], wholeSet);
  });
});

test("run_query defaults limit to 100 when omitted", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const body = jsonOf(await client.callTool({ name: "run_query", arguments: { sql: "SELECT id FROM orders" } }));
    assert.equal(body.limit, 100);
    assert.equal(body.hasMore, false);
  });
});

test("run_query rejects limit above the hard cap (200) as a schema validation error", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const result: any = await client.callTool({ name: "run_query", arguments: { sql: "SELECT id FROM orders", limit: 500 } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /200/);
  });
});

test("run_query rejects a query that already contains its own LIMIT/OFFSET", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const result: any = await client.callTool({ name: "run_query", arguments: { sql: "SELECT id FROM orders LIMIT 5" } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /limit.*offset/i);
  });
});
