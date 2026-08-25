import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

/** Spawn the built server (dist/index.js) against `dbPath` and hand a connected client to `fn`. */
export async function withClient<T>(dbPath: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { ...(process.env as Record<string, string>), DB_PATH: dbPath },
  });
  const client = new Client({ name: "sqlite-mcp-server-tests", version: "0.0.1" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

export function textOf(result: any): string {
  return result.content[0].text;
}

export function jsonOf(result: any): any {
  return JSON.parse(textOf(result));
}
