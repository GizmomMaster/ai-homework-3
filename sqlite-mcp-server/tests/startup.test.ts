import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

test("missing DB_PATH exits with a clean one-line error, no stack trace", () => {
  const result = spawnSync(process.execPath, [serverEntry], {
    env: { ...process.env, DB_PATH: "" },
    input: "",
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing database path/);
  assert.doesNotMatch(result.stderr, /at .*\(.*:\d+:\d+\)/);
  assert.doesNotMatch(result.stderr, /node_modules[\\/]/);
});

test("nonexistent DB_PATH exits with a clean one-line error, no stack trace", () => {
  const result = spawnSync(process.execPath, [serverEntry], {
    env: { ...process.env, DB_PATH: "/tmp/definitely-does-not-exist-sqlite-mcp-test.db" },
    input: "",
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not open database/);
  assert.doesNotMatch(result.stderr, /at .*\(.*:\d+:\d+\)/);
  assert.doesNotMatch(result.stderr, /node_modules[\\/]/);
});
