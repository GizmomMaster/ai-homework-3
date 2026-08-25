import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "./db.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerQueryTool } from "./tools/query.js";
import { registerSchemaTools } from "./tools/schema.js";

/**
 * Build the MCP server over an already-open database.
 *
 * Every tool registered here reads; there is deliberately no write tool anywhere in the
 * server — that absence is the first layer of the read-only guarantee.
 */
export function createServer(db: Db): McpServer {
  const server = new McpServer({ name: "sqlite-mcp-server", version: "0.1.0" });

  registerSchemaTools(server, db);
  registerQueryTool(server, db);
  registerAnalyticsTools(server, db);

  return server;
}
