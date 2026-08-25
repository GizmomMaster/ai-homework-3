import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createFixtureDb, createTempDb } from "./fixture.js";
import { withClient, jsonOf, textOf } from "./client.js";

let fixture: ReturnType<typeof createFixtureDb>;
before(() => { fixture = createFixtureDb(); });
after(() => fixture.cleanup());

test("list_tables returns all four tables with columns", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const result = await client.callTool({ name: "list_tables", arguments: {} });
    const tables = jsonOf(result) as { table: string; columns: unknown[] }[];
    const names = tables.map((t) => t.table).sort();
    assert.deepEqual(names, ["customers", "order_items", "orders", "products"]);
    const customers = tables.find((t) => t.table === "customers")!;
    assert.ok(Array.isArray(customers.columns) && customers.columns.length > 0);
  });
});

test("describe_table returns schema, row count, and sample rows for an existing table", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const result = await client.callTool({ name: "describe_table", arguments: { table: "customers" } });
    const info = jsonOf(result);
    assert.equal(info.table, "customers");
    assert.equal(info.rowCount, 3);
    assert.ok(Array.isArray(info.sample) && info.sample.length <= 3);
    assert.ok(Array.isArray(info.columns) && info.columns.some((c: any) => c.name === "email"));
  });
});

test("describe_table on a nonexistent table returns isError with a helpful hint", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const result: any = await client.callTool({ name: "describe_table", arguments: { table: "ghosts" } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /list_tables/);
  });
});

test("every tool exposes a title and a description of reasonable length", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 7, `expected at least 7 tools, got ${tools.length}`);
    for (const tool of tools) {
      assert.ok(tool.title, `${tool.name} is missing a title`);
      assert.ok(
        tool.description && tool.description.length >= 40,
        `${tool.name} description is too short to be useful: "${tool.description}"`
      );
    }
  });
});

test("read-only tools are annotated readOnlyHint: true", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      assert.equal((tool.annotations as any)?.readOnlyHint, true, `${tool.name} should be readOnlyHint: true`);
    }
  });
});

test("run_query and the specialized top-N tools cross-reference each other in their descriptions", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const { tools } = await client.listTools();
    const runQuery = tools.find((t) => t.name === "run_query")!;
    // run_query should point callers at the dedicated tools instead of hand-writing common joins
    assert.match(runQuery.description!, /top_customers_by_spend/);
    const byOrderCount = tools.find((t) => t.name === "customers_by_order_count")!;
    // and the dedicated tools should disambiguate from their closest sibling
    assert.match(byOrderCount.description!, /top_customers_by_spend/);
  });
});

test("describe_table handles a table name that needs SQL quoting", async () => {
  // Identifiers can't be bound as parameters, so they are interpolated — with SQLite's own
  // quoting rules ("" for an embedded quote), not JSON escaping, which SQLite rejects.
  const quirky = createTempDb((db) => {
    db.exec('CREATE TABLE "we""ird name" (id INTEGER)');
    db.exec('INSERT INTO "we""ird name" (id) VALUES (1), (2)');
  });
  try {
    await withClient(quirky.dbPath, async (client) => {
      const info = jsonOf(await client.callTool({ name: "describe_table", arguments: { table: 'we"ird name' } }));
      assert.equal(info.rowCount, 2);
      assert.deepEqual(info.sample, [{ id: 1 }, { id: 2 }]);

      const tables = jsonOf(await client.callTool({ name: "list_tables", arguments: {} }));
      assert.deepEqual(tables[0].columns.map((c: any) => c.name), ["id"]);
    });
  } finally {
    quirky.cleanup();
  }
});
