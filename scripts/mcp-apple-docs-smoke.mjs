#!/usr/bin/env node
/**
 * @Codex
 * Runtime smoke check for apple-docs-mcp:
 * - Passes if the process exits successfully.
 * - Passes if it stays alive past the timeout (server likely started).
 * - Fails on early non-zero exit or spawn errors.
 */
import { spawn } from "node:child_process";

const SERVER_SPEC = "@kimsungwhee/apple-docs-mcp@1.0.23";
const STARTUP_TIMEOUT_MS = 20_000;

const child = spawn("npx", ["-y", SERVER_SPEC, "--test"], {
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
let settled = false;

const done = (code, message) => {
  if (settled) return;
  settled = true;
  if (stdout.trim()) {
    process.stdout.write(stdout);
    if (!stdout.endsWith("\n")) process.stdout.write("\n");
  }
  if (stderr.trim()) {
    process.stderr.write(stderr);
    if (!stderr.endsWith("\n")) process.stderr.write("\n");
  }
  if (message) {
    process.stdout.write(`${message}\n`);
  }
  process.exit(code);
};

child.stdout.on("data", (buf) => {
  stdout += String(buf);
});

child.stderr.on("data", (buf) => {
  stderr += String(buf);
});

child.on("error", (err) => {
  done(1, `apple-docs-mcp smoke failed to start: ${err.message}`);
});

child.on("exit", (code, signal) => {
  if (settled) return;
  if (code === 0) {
    done(0, "apple-docs-mcp smoke passed (process exited with code 0).");
    return;
  }
  const status = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
  done(1, `apple-docs-mcp smoke failed (early exit: ${status}).`);
});

setTimeout(() => {
  if (settled) return;
  child.kill("SIGTERM");
  done(
    0,
    `apple-docs-mcp smoke passed (server stayed alive for ${STARTUP_TIMEOUT_MS / 1000}s).`
  );
}, STARTUP_TIMEOUT_MS);
