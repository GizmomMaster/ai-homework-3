#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, resolveDbPath } from "./config.js";
import { openDatabase } from "./db.js";
import { createServer } from "./server.js";

/**
 * Entry point: resolve the database path, open it, and serve MCP over stdio.
 *
 * A misconfiguration is reported as a single stderr line and exit code 1 — before the
 * transport opens, and without a stack trace, since the host surfaces this to a human.
 */
async function main(): Promise<void> {
  const db = openDatabase(resolveDbPath(process.env, process.argv));
  await createServer(db).connect(new StdioServerTransport());
}

try {
  await main();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
