import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNoOwnPagination, assertReadOnlySelect } from "../src/sql-guard.js";
import { ToolError } from "../src/errors.js";
import { quoteIdentifier } from "../src/db.js";

/**
 * Unit-level counterpart to read-only.test.ts: the same rules, checked directly against the
 * guard instead of through a spawned server, so a regression here points at one function.
 */

const ALLOWED = [
  "SELECT * FROM orders",
  "  select id from customers",
  "WITH t AS (SELECT 1 AS n) SELECT * FROM t",
  "SELECT COUNT(*) AS n FROM orders;",
];

for (const sql of ALLOWED) {
  test(`assertReadOnlySelect allows: ${sql.trim()}`, () => {
    assert.doesNotThrow(() => assertReadOnlySelect(sql));
  });
}

const REJECTED: [string, string, RegExp][] = [
  ["a bare DELETE", "DELETE FROM orders", /Only SELECT/],
  ["a bare PRAGMA", "PRAGMA writable_schema=1", /Only SELECT/],
  ["stacked statements", "SELECT 1; DELETE FROM orders;", /single statement/],
  ["a data-modifying CTE", "WITH x AS (SELECT 1) DELETE FROM orders", /read-only/],
  ["REPLACE INTO", "REPLACE INTO products VALUES (1)", /Only SELECT/],
];

for (const [label, sql, expected] of REJECTED) {
  test(`assertReadOnlySelect rejects ${label}`, () => {
    assert.throws(() => assertReadOnlySelect(sql), (err: unknown) => {
      assert.ok(err instanceof ToolError, "refusals must be ToolError, so they reach the caller as text");
      assert.match(err.message, expected);
      return true;
    });
  });
}

test("assertNoOwnPagination rejects a caller-supplied LIMIT and names the parameters instead", () => {
  assert.throws(() => assertNoOwnPagination("SELECT id FROM orders LIMIT 5"), /`limit`\/`offset`/);
  assert.throws(() => assertNoOwnPagination("SELECT id FROM orders OFFSET 5"), ToolError);
  assert.doesNotThrow(() => assertNoOwnPagination("SELECT id FROM orders"));
});

test("quoteIdentifier wraps in double quotes and doubles embedded ones", () => {
  assert.equal(quoteIdentifier("orders"), '"orders"');
  assert.equal(quoteIdentifier("order items"), '"order items"');
  // The case JSON.stringify got wrong: it escapes as \" , which SQLite does not accept.
  assert.equal(quoteIdentifier('we"ird'), '"we""ird"');
});
