/** Thrown by a tool handler to reject a call with a message shown to the caller verbatim. */
export class ToolError extends Error {}

/**
 * Translate a raw SQLite error into a message that tells the caller what to do next,
 * instead of a bare driver message (or, if uncaught, a Node stack trace).
 */
export function friendlySqlError(err: unknown): string {
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
