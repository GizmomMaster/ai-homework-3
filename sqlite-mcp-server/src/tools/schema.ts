import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Db, quoteIdentifier, tableExists } from "../db.js";
import { ToolError } from "../errors.js";
import { registerReadOnlyTool } from "./register.js";

const SAMPLE_ROWS = 3;

type ColumnInfo = { name: string; type: string; notnull: number; pk: number };

function columnsOf(db: Db, table: string): ColumnInfo[] {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as ColumnInfo[];
}

/** Discovery tools: what tables exist, and what one of them actually contains. */
export function registerSchemaTools(server: McpServer, db: Db): void {
  registerReadOnlyTool(
    server,
    "list_tables",
    {
      title: "List tables",
      description:
        "List every table in the SQLite database, with its column names and types. " +
        "Call this first to discover what data is available before writing a query. " +
        "Does not return row counts or sample data — use describe_table for that.",
      inputSchema: {},
    },
    () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[];

      return tables.map((t) => ({
        table: t.name,
        columns: columnsOf(db, t.name).map((c) => ({
          name: c.name,
          type: c.type,
          notNull: !!c.notnull,
          primaryKey: !!c.pk,
        })),
      }));
    }
  );

  registerReadOnlyTool(
    server,
    "describe_table",
    {
      title: "Describe table",
      description:
        `Get the column schema, exact row count, and up to ${SAMPLE_ROWS} sample rows for one table. ` +
        "Use list_tables first if you don't know the exact table name — names are case-sensitive.",
      inputSchema: {
        table: z.string().describe("Exact table name, as returned by list_tables."),
      },
    },
    ({ table }) => {
      // Checked against sqlite_master first so an unknown name gets a pointer to list_tables,
      // rather than whatever the PRAGMA below happens to do with it.
      if (!tableExists(db, table)) {
        throw new ToolError(`Table "${table}" does not exist. Call list_tables to see valid names.`);
      }

      const quoted = quoteIdentifier(table);
      return {
        table,
        columns: columnsOf(db, table),
        rowCount: (db.prepare(`SELECT COUNT(*) AS n FROM ${quoted}`).get() as { n: number }).n,
        sample: db.prepare(`SELECT * FROM ${quoted} LIMIT ${SAMPLE_ROWS}`).all(),
      };
    }
  );
}
