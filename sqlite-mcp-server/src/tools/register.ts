import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape, objectOutputType, ZodTypeAny } from "zod";
import { ToolError, friendlySqlError } from "../errors.js";

/** Every tool here reads and never writes; the hints let a host skip write confirmations. */
const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

function textResult(text: string, isError = false): CallToolResult {
  return { ...(isError ? { isError: true } : {}), content: [{ type: "text", text }] };
}

/**
 * Register a read-only tool whose handler returns plain data.
 *
 * Centralises what every tool would otherwise repeat: the read-only annotations, JSON
 * serialisation of the result, and the try/catch that turns a raw SQLite failure into an
 * actionable message. A handler rejects a call by throwing `ToolError`; anything else it
 * throws is treated as a SQL error and translated by `friendlySqlError`.
 */
export function registerReadOnlyTool<Args extends ZodRawShape>(
  server: McpServer,
  name: string,
  config: { title: string; description: string; inputSchema: Args },
  handler: (args: objectOutputType<Args, ZodTypeAny>) => unknown | Promise<unknown>
): void {
  server.registerTool(name, { ...config, annotations: READ_ONLY_ANNOTATIONS }, (async (args: any) => {
    try {
      return textResult(JSON.stringify(await handler(args), null, 2));
    } catch (err) {
      return textResult(err instanceof ToolError ? err.message : friendlySqlError(err), true);
    }
  }) as never);
}
