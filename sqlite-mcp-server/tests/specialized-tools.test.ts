import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createFixtureDb, EXPECTED } from "./fixture.js";
import { withClient, jsonOf } from "./client.js";

let fixture: ReturnType<typeof createFixtureDb>;
before(() => { fixture = createFixtureDb(); });
after(() => fixture.cleanup());

test("top_customers_by_spend excludes cancelled orders by default", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const rows = jsonOf(await client.callTool({ name: "top_customers_by_spend", arguments: { limit: 3 } }));
    assert.deepEqual(
      rows.map((r: any) => ({ id: r.id, total_spent: r.total_spent })),
      EXPECTED.topCustomersBySpend
    );
  });
});

test("top_customers_by_spend includes cancelled orders when excludeCancelled=false", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const rows = jsonOf(
      await client.callTool({ name: "top_customers_by_spend", arguments: { limit: 3, excludeCancelled: false } })
    );
    assert.deepEqual(
      rows.map((r: any) => ({ id: r.id, total_spent: r.total_spent })),
      EXPECTED.topCustomersBySpendIncludingCancelled
    );
  });
});

test("top_customers_by_spend respects limit", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const rows = jsonOf(await client.callTool({ name: "top_customers_by_spend", arguments: { limit: 1 } }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, EXPECTED.topCustomersBySpend[0].id);
  });
});

test("customers_by_order_count ranks by number of orders regardless of status", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const rows = jsonOf(await client.callTool({ name: "customers_by_order_count", arguments: { limit: 3 } }));
    assert.deepEqual(
      rows.map((r: any) => ({ id: r.id, orders_count: r.orders_count })),
      EXPECTED.customersByOrderCount
    );
  });
});

test("top_selling_products ranks by units_sold and excludes cancelled orders by default", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const rows = jsonOf(await client.callTool({ name: "top_selling_products", arguments: { limit: 3, rankBy: "units_sold" } }));
    assert.deepEqual(
      rows.map((r: any) => ({ name: r.name, units_sold: r.units_sold, revenue: r.revenue })),
      EXPECTED.topSellingProductsByUnits
    );
  });
});

test("top_selling_products ranks by revenue when requested", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const rows = jsonOf(await client.callTool({ name: "top_selling_products", arguments: { limit: 3, rankBy: "revenue" } }));
    assert.deepEqual(
      rows.map((r: any) => ({ name: r.name, units_sold: r.units_sold, revenue: r.revenue })),
      EXPECTED.topSellingProductsByRevenue
    );
  });
});

test("top_selling_products with excludeCancelled=false pulls the cancelled order's 100 units back in", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const rows = jsonOf(
      await client.callTool({ name: "top_selling_products", arguments: { limit: 1, rankBy: "units_sold", excludeCancelled: false } })
    );
    assert.equal(rows[0].name, "Widget");
    assert.equal(rows[0].units_sold, 8 + 100);
    assert.equal(rows[0].revenue, 80 + 1000);
  });
});

test("revenue_by_category aggregates across products within each category", async () => {
  await withClient(fixture.dbPath, async (client) => {
    const rows = jsonOf(await client.callTool({ name: "revenue_by_category", arguments: { limit: 3 } }));
    assert.deepEqual(rows, EXPECTED.revenueByCategory);
  });
});

test("specialized tools report a friendly error (not a crash) against a database missing the expected tables", async () => {
  // A bare SQLite file with none of the shop tables — the specialized tools should
  // degrade to a clear, actionable error instead of an unhandled exception.
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-mcp-empty-"));
  const dbPath = path.join(dir, "empty.db");
  const db = new Database(dbPath);
  db.exec("CREATE TABLE unrelated (id INTEGER)");
  db.close();

  try {
    await withClient(dbPath, async (client) => {
      const result: any = await client.callTool({ name: "top_customers_by_spend", arguments: {} });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /does not exist/);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
