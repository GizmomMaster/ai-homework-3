import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "../db.js";
import { registerReadOnlyTool } from "./register.js";

const TOP_N_LIMIT = z.number().int().min(1).max(50).default(10).describe("How many rows to return. Max 50.");

const EXCLUDE_CANCELLED = z
  .boolean()
  .default(true)
  .describe("Exclude cancelled orders/items from the result. Defaults to true.");

/** Identifying columns every customer-facing result shares. */
const CUSTOMER_COLUMNS = "c.id, c.first_name, c.last_name, c.email";

/** Money summed across order items, to cents. */
const REVENUE = "ROUND(SUM(oi.quantity * oi.unit_price), 2)";

/** WHERE clause filtering out cancelled orders, or nothing when they're wanted. */
function cancelledFilter(excludeCancelled: boolean): string {
  return excludeCancelled ? "WHERE o.status != 'cancelled'" : "";
}

/**
 * Pre-written versions of the joins these questions keep needing, so an agent doesn't
 * hand-write (and mis-write) the same aggregation every time.
 *
 * All four are specific to the shop schema (customers / orders / order_items / products).
 * Against a database without those tables they surface a "no such table" message through
 * the shared error translation, rather than crashing.
 */
export function registerAnalyticsTools(server: McpServer, db: Db): void {
  registerReadOnlyTool(
    server,
    "top_customers_by_spend",
    {
      title: "Top customers by spend",
      description:
        "Return the customers who have spent the most money, ranked by total order amount. Returns id, name, " +
        "email, and total_spent for each. Equivalent to joining customers to orders and summing total_amount — " +
        "use this instead of hand-writing that query in run_query.",
      inputSchema: { limit: TOP_N_LIMIT, excludeCancelled: EXCLUDE_CANCELLED },
    },
    ({ limit, excludeCancelled }) =>
      db
        .prepare(
          `SELECT ${CUSTOMER_COLUMNS}, ROUND(SUM(o.total_amount), 2) AS total_spent
           FROM customers c
           JOIN orders o ON o.customer_id = c.id
           ${cancelledFilter(excludeCancelled)}
           GROUP BY c.id
           ORDER BY total_spent DESC
           LIMIT ?`
        )
        .all(limit)
  );

  registerReadOnlyTool(
    server,
    "top_selling_products",
    {
      title: "Top selling products",
      description:
        "Return the best-selling products, ranked by units sold or by revenue (your choice). Returns name, " +
        "category, units_sold, and revenue for each. Computed by joining order_items to products and orders — " +
        "use this instead of hand-writing that aggregation in run_query.",
      inputSchema: {
        limit: TOP_N_LIMIT,
        rankBy: z
          .enum(["units_sold", "revenue"])
          .default("units_sold")
          .describe("Rank products by total units sold, or by total revenue."),
        excludeCancelled: EXCLUDE_CANCELLED,
      },
    },
    ({ limit, rankBy, excludeCancelled }) =>
      db
        .prepare(
          // rankBy is interpolated, not bound — SQLite can't parameterise ORDER BY. It is
          // constrained to the two literals above by the schema, so it can't carry SQL in.
          `SELECT p.name, p.category, SUM(oi.quantity) AS units_sold, ${REVENUE} AS revenue
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           JOIN orders o ON o.id = oi.order_id
           ${cancelledFilter(excludeCancelled)}
           GROUP BY p.id
           ORDER BY ${rankBy} DESC
           LIMIT ?`
        )
        .all(limit)
  );

  registerReadOnlyTool(
    server,
    "revenue_by_category",
    {
      title: "Revenue by product category",
      description:
        "Return product categories ranked by total revenue generated. Returns category, revenue, and units_sold " +
        "for each. Joins order_items to products and orders and groups by category — use this instead of " +
        "hand-writing that join in run_query.",
      inputSchema: { limit: TOP_N_LIMIT, excludeCancelled: EXCLUDE_CANCELLED },
    },
    ({ limit, excludeCancelled }) =>
      db
        .prepare(
          `SELECT p.category, ${REVENUE} AS revenue, SUM(oi.quantity) AS units_sold
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           JOIN orders o ON o.id = oi.order_id
           ${cancelledFilter(excludeCancelled)}
           GROUP BY p.category
           ORDER BY revenue DESC
           LIMIT ?`
        )
        .all(limit)
  );

  registerReadOnlyTool(
    server,
    "customers_by_order_count",
    {
      title: "Customers by order count",
      description:
        "Return the customers who have placed the most orders, ranked by order count (all statuses included). " +
        "Returns id, name, email, and orders_count for each. Note this ranks by number of orders, not money spent " +
        "— use top_customers_by_spend for that.",
      inputSchema: { limit: TOP_N_LIMIT },
    },
    ({ limit }) =>
      db
        .prepare(
          `SELECT ${CUSTOMER_COLUMNS}, COUNT(*) AS orders_count
           FROM customers c
           JOIN orders o ON o.customer_id = c.id
           GROUP BY c.id
           ORDER BY orders_count DESC
           LIMIT ?`
        )
        .all(limit)
  );
}
