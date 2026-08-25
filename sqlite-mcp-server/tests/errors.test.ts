import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createFixtureDb } from "./fixture.js";
import { withClient, textOf } from "./client.js";

let fixture: ReturnType<typeof createFixtureDb>;
before(() => { fixture = createFixtureDb(); });
after(() => fixture.cleanup());

test("querying a nonexistent table returns a friendly, actionable message", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const result: any = await client.callTool({ name: "run_query", arguments: { sql: "SELECT * FROM ghosts" } });
    assert.equal(result.isError, true);
    const text = textOf(result);
    assert.match(text, /does not exist/);
    assert.match(text, /list_tables/);
  });
});

test("querying a nonexistent column returns a friendly, actionable message", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const result: any = await client.callTool({ name: "run_query", arguments: { sql: "SELECT country FROM customers" } });
    assert.equal(result.isError, true);
    const text = textOf(result);
    assert.match(text, /does not exist/);
    assert.match(text, /describe_table/);
  });
});

test("a SQL syntax error returns a friendly message, not a raw driver dump", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const result: any = await client.callTool({ name: "run_query", arguments: { sql: "SELECT ??? FROM customers" } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /syntax error/i);
  });
});

test("an invalid argument type is rejected before the handler runs, with no stack trace", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const result: any = await client.callTool({ name: "describe_table", arguments: { table: 12345 } });
    assert.equal(result.isError, true);
    assert.doesNotMatch(textOf(result), /at Object|at Module|\.js:\d+:\d+/);
  });
});

test("no error response ever leaks a Node.js stack trace", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const attempts = [
      { name: "run_query", arguments: { sql: "SELECT * FROM ghosts" } },
      { name: "run_query", arguments: { sql: "SELECT ??? garbage" } },
      { name: "describe_table", arguments: { table: "ghosts" } },
      { name: "unknown_tool_xyz", arguments: {} },
    ];
    for (const call of attempts) {
      const result: any = await client.callTool(call);
      const text = textOf(result);
      assert.doesNotMatch(text, /at .*\(.*:\d+:\d+\)/, `leaked a stack frame for ${call.name}: ${text}`);
      assert.doesNotMatch(text, /node_modules[\\/]/, `leaked a file path for ${call.name}: ${text}`);
    }
  });
});
