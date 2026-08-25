#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Project root, not process.cwd() — so a relative DB_PATH resolves the same way
// regardless of where the MCP host launches this process from.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const rawDbPath = process.env.DB_PATH ?? process.argv[2];
if (!rawDbPath) {
  console.error("Missing database path. Set the DB_PATH environment variable or pass it as the first CLI argument.");
  process.exit(1);
}
const dbPath = path.isAbsolute(rawDbPath) ? rawDbPath : path.resolve(projectRoot, rawDbPath);

let db: Database.Database;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
} catch (err) {
  console.error(`Could not open database at "${dbPath}": ${(err as Error).message}`);
  process.exit(1);
}

const server = new McpServer({ name: "sqlite-mcp-server", version: "0.1.0" });

/**
 * Translate a raw SQLite error into a message that tells the caller what to do next,
 * instead of a bare driver message (or, if uncaught, a Node stack trace).
 */
function friendlySqlError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  const noSuchTable = message.match(/no such table:\s*(\S+)/i);
  if (noSuchTable) {
    return `Table "${noSuchTable[1]}" does not exist. Call list_tables to see the tables available in this database.`;
  }

  const noSuchColumn = message.match(/no such column:\s*(\S+)/i);
  if (noSuchColumn) {
    return `Column "${noSuchColumn[1]}" does not exist. Call describe_table on the relevant table to see its actual columns.`;
  }

  if (/no such function/i.test(message)) {
    return `Query failed: ${message}. This SQL function isn't available in SQLite — check for typos or a non-portable function name.`;
  }

  if (/syntax error/i.test(message)) {
    return `SQL syntax error: ${message}. Check for typos, missing commas, or unbalanced parentheses/quotes.`;
  }

  return `Query failed: ${message}`;
}

server.registerTool(
  "list_tables",
  {
    title: "List tables",
    description:
      "List every table in the SQLite database, with its column names and types. " +
      "Call this first to discover what data is available before writing a query. " +
      "Does not return row counts or sample data — use describe_table for that.",
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[];

      const result = tables.map((t) => ({
        table: t.name,
        columns: (db.prepare(`PRAGMA table_info(${JSON.stringify(t.name)})`).all() as any[]).map((c) => ({
          name: c.name,
          type: c.type,
          notNull: !!c.notnull,
          primaryKey: !!c.pk,
        })),
      }));

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: friendlySqlError(err) }] };
    }
  }
);

server.registerTool(
  "describe_table",
  {
    title: "Describe table",
    description:
      "Get the column schema, exact row count, and up to 3 sample rows for one table. " +
      "Use list_tables first if you don't know the exact table name — names are case-sensitive.",
    inputSchema: {
      table: z.string().describe("Exact table name, as returned by list_tables."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ table }) => {
    try {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      if (!exists) {
        return {
          isError: true,
          content: [{ type: "text", text: `Table "${table}" does not exist. Call list_tables to see valid names.` }],
        };
      }

      const columns = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all();
      const rowCount = (db.prepare(`SELECT COUNT(*) as n FROM ${JSON.stringify(table)}`).get() as { n: number }).n;
      const sample = db.prepare(`SELECT * FROM ${JSON.stringify(table)} LIMIT 3`).all();

      return {
        content: [{ type: "text", text: JSON.stringify({ table, columns, rowCount, sample }, null, 2) }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: friendlySqlError(err) }] };
    }
  }
);

const SELECT_ONLY = /^\s*(select|with)\b/i;
// SQLite allows data-modifying CTEs ("WITH cte AS (...) DELETE FROM ...") and PRAGMA-based
// schema tricks, so the SELECT/WITH prefix check alone isn't enough — block these keywords
// anywhere in the statement, not just at the start.
const FORBIDDEN_KEYWORDS =
  /\b(insert|update|delete|drop|alter|create|attach|detach|vacuum|pragma|reindex)\b|\breplace\s+into\b/i;
const HAS_LIMIT_OR_OFFSET = /\b(limit|offset)\b/i;
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 100;

server.registerTool(
  "run_query",
  {
    title: "Run a read-only SQL query",
    description:
      "Execute an arbitrary read-only SQL query (a single SELECT, or WITH ... SELECT) and return a page of " +
      "results. Only SELECT-shaped statements are allowed — INSERT/UPDATE/DELETE/DROP/ALTER/CREATE and other " +
      "modifying statements are rejected, as is more than one statement per call. Do not include your own " +
      "LIMIT/OFFSET — use this tool's `limit`/`offset` parameters instead, so results stay paginated correctly. " +
      "For 'top N customers/products/categories'-style questions, prefer the dedicated top_customers_by_spend / " +
      "top_selling_products / revenue_by_category / customers_by_order_count tools — they're pre-validated and " +
      "don't require you to hand-write the join.",
    inputSchema: {
      sql: z.string().describe("A single SELECT (or WITH ... SELECT) statement, without LIMIT/OFFSET."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE_SIZE)
        .default(DEFAULT_PAGE_SIZE)
        .describe(`Max rows to return in this page. Hard-capped at ${MAX_PAGE_SIZE} regardless of the value passed.`),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Rows to skip before returning a page. Use with `limit` to page through large result sets."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ sql, limit, offset }) => {
    if (!SELECT_ONLY.test(sql)) {
      return {
        isError: true,
        content: [{ type: "text", text: "Only SELECT (or WITH ... SELECT) statements are allowed." }],
      };
    }

    if (sql.split(";").map((s) => s.trim()).filter(Boolean).length > 1) {
      return {
        isError: true,
        content: [{ type: "text", text: "Only a single statement is allowed per call." }],
      };
    }

    const forbidden = sql.match(FORBIDDEN_KEYWORDS);
    if (forbidden) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Rejected: this server is read-only and does not permit "${forbidden[0]}". Only SELECT queries are allowed.`,
          },
        ],
      };
    }

    if (HAS_LIMIT_OR_OFFSET.test(sql)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "This query already contains LIMIT/OFFSET. Remove it and use this tool's `limit`/`offset` parameters instead.",
          },
        ],
      };
    }

    try {
      // Fetch one extra row to know whether a next page exists, without a second COUNT(*) query.
      const rows = db.prepare(`${sql.trim()} LIMIT ? OFFSET ?`).all(limit + 1, offset) as unknown[];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      const body = {
        rows: page,
        returned: page.length,
        limit,
        offset,
        hasMore,
        nextOffset: hasMore ? offset + limit : null,
      };

      return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: friendlySqlError(err) }] };
    }
  }
);

const TOP_N_LIMIT = z.number().int().min(1).max(50).default(10).describe("How many rows to return. Max 50.");
const EXCLUDE_CANCELLED = z
  .boolean()
  .default(true)
  .describe("Exclude cancelled orders/items from the result. Defaults to true.");

server.registerTool(
  "top_customers_by_spend",
  {
    title: "Top customers by spend",
    description:
      "Return the customers who have spent the most money, ranked by total order amount. Returns id, name, " +
      "email, and total_spent for each. Equivalent to joining customers to orders and summing total_amount — " +
      "use this instead of hand-writing that query in run_query.",
    inputSchema: { limit: TOP_N_LIMIT, excludeCancelled: EXCLUDE_CANCELLED },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ limit, excludeCancelled }) => {
    try {
      const sql = `
        SELECT c.id, c.first_name, c.last_name, c.email, ROUND(SUM(o.total_amount), 2) AS total_spent
        FROM customers c
        JOIN orders o ON o.customer_id = c.id
        ${excludeCancelled ? "WHERE o.status != 'cancelled'" : ""}
        GROUP BY c.id
        ORDER BY total_spent DESC
        LIMIT ?
      `;
      const rows = db.prepare(sql).all(limit);
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: friendlySqlError(err) }] };
    }
  }
);

server.registerTool(
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
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ limit, rankBy, excludeCancelled }) => {
    try {
      const sql = `
        SELECT p.name, p.category, SUM(oi.quantity) AS units_sold, ROUND(SUM(oi.quantity * oi.unit_price), 2) AS revenue
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        JOIN orders o ON o.id = oi.order_id
        ${excludeCancelled ? "WHERE o.status != 'cancelled'" : ""}
        GROUP BY p.id
        ORDER BY ${rankBy} DESC
        LIMIT ?
      `;
      const rows = db.prepare(sql).all(limit);
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: friendlySqlError(err) }] };
    }
  }
);

server.registerTool(
  "revenue_by_category",
  {
    title: "Revenue by product category",
    description:
      "Return product categories ranked by total revenue generated. Returns category, revenue, and units_sold " +
      "for each. Joins order_items to products and orders and groups by category — use this instead of " +
      "hand-writing that join in run_query.",
    inputSchema: { limit: TOP_N_LIMIT, excludeCancelled: EXCLUDE_CANCELLED },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ limit, excludeCancelled }) => {
    try {
      const sql = `
        SELECT p.category, ROUND(SUM(oi.quantity * oi.unit_price), 2) AS revenue, SUM(oi.quantity) AS units_sold
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        JOIN orders o ON o.id = oi.order_id
        ${excludeCancelled ? "WHERE o.status != 'cancelled'" : ""}
        GROUP BY p.category
        ORDER BY revenue DESC
        LIMIT ?
      `;
      const rows = db.prepare(sql).all(limit);
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: friendlySqlError(err) }] };
    }
  }
);

server.registerTool(
  "customers_by_order_count",
  {
    title: "Customers by order count",
    description:
      "Return the customers who have placed the most orders, ranked by order count (all statuses included). " +
      "Returns id, name, email, and orders_count for each. Note this ranks by number of orders, not money spent " +
      "— use top_customers_by_spend for that.",
    inputSchema: { limit: TOP_N_LIMIT },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ limit }) => {
    try {
      const sql = `
        SELECT c.id, c.first_name, c.last_name, c.email, COUNT(*) AS orders_count
        FROM customers c
        JOIN orders o ON o.customer_id = c.id
        GROUP BY c.id
        ORDER BY orders_count DESC
        LIMIT ?
      `;
      const rows = db.prepare(sql).all(limit);
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: friendlySqlError(err) }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
