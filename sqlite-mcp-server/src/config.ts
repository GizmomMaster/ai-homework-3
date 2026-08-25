import path from "node:path";
import { fileURLToPath } from "node:url";

// Project root, not process.cwd() — so a relative DB_PATH resolves the same way
// regardless of where the MCP host launches this process from.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Thrown for a misconfiguration the user has to fix before the server can start. */
export class ConfigError extends Error {}

/**
 * Pick the database path from the environment or the CLI, and resolve a relative
 * one against the project root.
 *
 * @throws ConfigError when no path was supplied at all.
 */
export function resolveDbPath(env: NodeJS.ProcessEnv, argv: string[]): string {
  const raw = env.DB_PATH || argv[2];
  if (!raw) {
    throw new ConfigError(
      "Missing database path. Set the DB_PATH environment variable or pass it as the first CLI argument."
    );
  }
  return path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw);
}
