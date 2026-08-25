import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

export type TempDb = { dbPath: string; cleanup: () => void };

/**
 * Create a throwaway SQLite file in a temp directory, seeded by `seed`, plus the cleanup
 * that removes it. Every fixture in the suite goes through here so no test ever touches
 * the real sqlitedb/shop.db.
 */
export function createTempDb(seed: (db: Database.Database) => void): TempDb {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-mcp-test-"));
  const dbPath = path.join(dir, "fixture.db");
  const db = new Database(dbPath);
  try {
    seed(db);
  } finally {
    db.close();
  }
  return { dbPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Deterministic, self-contained SQLite fixture — same shape as shop.db (customers /
 * products / orders / order_items) but with hand-picked numbers so every aggregate
 * used by the specialized tools has one, unambiguous expected answer (see EXPECTED
 * below). Never points at the real shop.db, so tests don't depend on data that can
 * be regenerated/reseeded.
 */
export function createFixtureDb(): TempDb {
  return createTempDb((db) => {
    db.exec(`
      CREATE TABLE customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        created_at DATETIME NOT NULL
      );
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price REAL NOT NULL,
        stock_quantity INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL
      );
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        order_date DATETIME NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('new', 'processing', 'shipped', 'completed', 'cancelled')),
        total_amount REAL NOT NULL DEFAULT 0.0,
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      );
      CREATE TABLE order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        unit_price REAL NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
    `);

    const insertCustomer = db.prepare(
      "INSERT INTO customers (id, first_name, last_name, email, created_at) VALUES (?, ?, ?, ?, '2024-01-01')"
    );
    insertCustomer.run(1, "Alice", "Anderson", "alice@example.com");
    insertCustomer.run(2, "Bob", "Baker", "bob@example.com");
    insertCustomer.run(3, "Carol", "Clark", "carol@example.com");

    const insertProduct = db.prepare(
      "INSERT INTO products (id, name, category, price, stock_quantity, created_at) VALUES (?, ?, ?, ?, 100, '2024-01-01')"
    );
    insertProduct.run(1, "Widget", "Gadgets", 10.0);
    insertProduct.run(2, "Gizmo", "Gadgets", 20.0);
    insertProduct.run(3, "Thing", "Tools", 5.0);

    const insertOrder = db.prepare(
      "INSERT INTO orders (id, customer_id, order_date, status, total_amount) VALUES (?, ?, ?, ?, ?)"
    );
    // customer 1: 1 completed (id 1), 1 cancelled (id 2, deliberately large to prove exclusion matters)
    insertOrder.run(1, 1, "2024-01-05", "completed", 70);
    insertOrder.run(2, 1, "2024-02-01", "cancelled", 1000);
    // customer 2: 3 completed orders (ids 3, 5, 6)
    insertOrder.run(3, 2, "2024-03-01", "completed", 50);
    insertOrder.run(5, 2, "2025-05-01", "completed", 20);
    insertOrder.run(6, 2, "2024-06-01", "completed", 60);
    // customer 3: 1 completed order (id 4)
    insertOrder.run(4, 3, "2024-04-01", "completed", 10);

    const insertItem = db.prepare(
      "INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)"
    );
    insertItem.run(1, 1, 5, 10); // order 1 (completed): widget x5 = 50
    insertItem.run(1, 2, 1, 20); //                       gizmo  x1 = 20
    insertItem.run(2, 1, 100, 10); // order 2 (CANCELLED): widget x100 = 1000 — must be excluded by default
    insertItem.run(3, 1, 3, 10); // order 3 (completed): widget x3 = 30
    insertItem.run(3, 3, 4, 5); //                       thing  x4 = 20
    insertItem.run(4, 3, 2, 5); // order 4 (completed): thing  x2 = 10
    insertItem.run(5, 2, 1, 20); // order 5 (completed): gizmo  x1 = 20
    insertItem.run(6, 2, 3, 20); // order 6 (completed): gizmo  x3 = 60
  });
}

/**
 * Hand-computed expected aggregates for the fixture above (excludeCancelled = true
 * unless noted). Keep in sync with createFixtureDb() if the seed data changes.
 */
export const EXPECTED = {
  ordersTotal: 6,
  topCustomersBySpend: [
    { id: 2, total_spent: 130 }, // 50 + 20 + 60
    { id: 1, total_spent: 70 }, // order 2 (cancelled, 1000) excluded
    { id: 3, total_spent: 10 },
  ],
  topCustomersBySpendIncludingCancelled: [
    { id: 1, total_spent: 1070 }, // 70 + 1000
    { id: 2, total_spent: 130 },
    { id: 3, total_spent: 10 },
  ],
  customersByOrderCount: [
    { id: 2, orders_count: 3 },
    { id: 1, orders_count: 2 },
    { id: 3, orders_count: 1 },
  ],
  // product 1 (Widget): 5 (order1) + 3 (order3) = 8 units, 50+30 = 80 revenue (cancelled order 2 excluded)
  // product 2 (Gizmo):  1 (order1) + 1 (order5) + 3 (order6) = 5 units, 20+20+60 = 100 revenue
  // product 3 (Thing):  4 (order3) + 2 (order4) = 6 units, 20+10 = 30 revenue
  topSellingProductsByUnits: [
    { name: "Widget", units_sold: 8, revenue: 80 },
    { name: "Thing", units_sold: 6, revenue: 30 },
    { name: "Gizmo", units_sold: 5, revenue: 100 },
  ],
  topSellingProductsByRevenue: [
    { name: "Gizmo", units_sold: 5, revenue: 100 },
    { name: "Widget", units_sold: 8, revenue: 80 },
    { name: "Thing", units_sold: 6, revenue: 30 },
  ],
  revenueByCategory: [
    { category: "Gadgets", revenue: 180, units_sold: 13 }, // Widget(80) + Gizmo(100), 8+5 units
    { category: "Tools", revenue: 30, units_sold: 6 },
  ],
};
