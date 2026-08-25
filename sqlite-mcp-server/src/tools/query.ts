import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "../db.js";
import { assertNoOwnPagination, assertReadOnlySelect } from "../sql-guard.js";
import { registerReadOnlyTool } from "./register.js";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 100;

/** The escape hatch: arbitrary SELECTs, guarded and paginated. */
export function registerQueryTool(server: McpServer, db: Db): void {
  registerReadOnlyTool(
    server,
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
    },
    ({ sql, limit, offset }) => {
      assertReadOnlySelect(sql);
      assertNoOwnPagination(sql);

      // Fetch one extra row to know whether a next page exists, without a second COUNT(*) query.
      // LIMIT/OFFSET is appended to the caller's SQL rather than wrapping it in a subquery, so
      // their own ORDER BY keeps holding across pages.
      const rows = db.prepare(`${sql.trim()} LIMIT ? OFFSET ?`).all(limit + 1, offset) as unknown[];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      return {
        rows: page,
        returned: page.length,
        limit,
        offset,
        hasMore,
        nextOffset: hasMore ? offset + limit : null,
      };
    }
  );
}
