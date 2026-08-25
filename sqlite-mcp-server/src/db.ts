import Database from "better-sqlite3";
import { ConfigError } from "./config.js";

export type Db = Database.Database;

/**
 * Open the SQLite file read-only.
 *
 * `readonly` is enforced by the SQLite engine itself (SQLITE_OPEN_READONLY), not just by
 * application logic — the final layer of the read-only guarantee. `fileMustExist` keeps a
 * typo in the path from silently creating an empty database.
 *
 * @throws ConfigError when the file is missing or unreadable.
 */
export function openDatabase(dbPath: string): Db {
  try {
    return new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (err) {
    throw new ConfigError(`Could not open database at "${dbPath}": ${(err as Error).message}`);
  }
}

/**
 * Quote an identifier for interpolation into SQL: wrap in double quotes and double any
 * embedded quote, per SQLite's rules. Identifiers can't be bound as parameters, so table
 * names reaching PRAGMA/FROM clauses must go through this.
 */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** True if a table (excluding SQLite's internal ones) with this exact name exists. */
export function tableExists(db: Db, table: string): boolean {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return row !== undefined;
}
