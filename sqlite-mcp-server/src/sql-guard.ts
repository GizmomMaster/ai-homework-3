import { ToolError } from "./errors.js";

/** A query must be SELECT-shaped to begin with. */
const SELECT_ONLY = /^\s*(select|with)\b/i;

// SQLite allows data-modifying CTEs ("WITH cte AS (...) DELETE FROM ...") and PRAGMA-based
// schema tricks, so the SELECT/WITH prefix check alone isn't enough — block these keywords
// anywhere in the statement, not just at the start.
const FORBIDDEN_KEYWORDS =
  /\b(insert|update|delete|drop|alter|create|attach|detach|vacuum|pragma|reindex)\b|\breplace\s+into\b/i;

const HAS_LIMIT_OR_OFFSET = /\b(limit|offset)\b/i;

function statementCount(sql: string): number {
  return sql.split(";").filter((part) => part.trim()).length;
}

/**
 * Reject anything that isn't a single read-only SELECT, before it reaches the driver.
 *
 * This is layer 2 of the read-only guarantee: the server exposes no write tools (layer 1),
 * and the connection itself is opened read-only (layer 3, see openDatabase). The checks
 * here are deliberately conservative — they can refuse an exotic but harmless query, and
 * that is the safe direction to err in.
 *
 * @throws ToolError with the reason for the refusal.
 */
export function assertReadOnlySelect(sql: string): void {
  if (!SELECT_ONLY.test(sql)) {
    throw new ToolError("Only SELECT (or WITH ... SELECT) statements are allowed.");
  }

  // Closes the "SELECT 1; DELETE FROM orders;" stacked-statement bypass.
  if (statementCount(sql) > 1) {
    throw new ToolError("Only a single statement is allowed per call.");
  }

  const forbidden = sql.match(FORBIDDEN_KEYWORDS);
  if (forbidden) {
    throw new ToolError(
      `Rejected: this server is read-only and does not permit "${forbidden[0]}". Only SELECT queries are allowed.`
    );
  }
}

/**
 * Reject a query that brings its own LIMIT/OFFSET. Not a safety rule but a correctness one:
 * run_query appends its own pagination clause, which would be a syntax error after the
 * caller's — better to say so up front than to return a cryptic parser message.
 *
 * @throws ToolError when the query already paginates itself.
 */
export function assertNoOwnPagination(sql: string): void {
  if (HAS_LIMIT_OR_OFFSET.test(sql)) {
    throw new ToolError(
      "This query already contains LIMIT/OFFSET. Remove it and use this tool's `limit`/`offset` parameters instead."
    );
  }
}
