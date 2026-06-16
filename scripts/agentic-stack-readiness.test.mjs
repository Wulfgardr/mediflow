/* @Codex */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  evaluateGitWorkstream,
  evaluateProbeResult,
  evaluateSkillFiles,
  expectedSkillFiles,
  formatCommandResult,
  inferIssueId,
  parseArgs,
  parseJsonObject,
  redactReportValue,
  sanitizeProbePayload,
  summarizeRequired,
} from "./agentic-stack-readiness.mjs";

test("parses readiness flags", () => {
  const options = parseArgs([
    "--expected-issue",
    "wul-295",
    "--json",
    "--live-gemini",
    "--strict-live",
    "--timeout-ms",
    "1200",
    "--no-workflow-monitor",
  ]);

  assert.equal(options.expectedIssue, "WUL-295");
  assert.equal(options.json, true);
  assert.equal(options.liveGemini, true);
  assert.equal(options.strictLive, true);
  assert.equal(options.workflowMonitor, false);
  assert.equal(options.timeoutMs, 1200);
});

test("rejects missing flag values", () => {
  assert.throws(() => parseArgs(["--expected-issue", "--json"]), /--expected-issue requires a value/);
});

test("builds the delegate skill manifest from the requested home", () => {
  const files = expectedSkillFiles("/tmp/example-home");

  assert.ok(files.some((item) => item.path === "/tmp/example-home/.codex/skills/gemini-cli-delegate/SKILL.md"));
  assert.ok(files.some((item) => item.path === "/tmp/example-home/.codex/skills/claude-cli-delegate/scripts/run_claude_delegate.py"));
});

test("evaluates missing and present delegate skill files", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "mediflow-agentic-readiness-"));

  try {
    const missing = evaluateSkillFiles(tempHome);
    assert.equal(missing.status, "fail");
    assert.ok(missing.missing.length > 0);

    for (const item of expectedSkillFiles(tempHome)) {
      fs.mkdirSync(path.dirname(item.path), { recursive: true });
      fs.writeFileSync(item.path, "");
    }

    const present = evaluateSkillFiles(tempHome);
    assert.equal(present.status, "pass");
    assert.deepEqual(present.missing, []);
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("extracts probe JSON even with wrapper text", () => {
  const parsed = parseJsonObject('noise\n{"ready":true,"version":"1"}\n');

  assert.deepEqual(parsed, { ready: true, version: "1" });
});

test("evaluates probe readiness from command status and ready flag", () => {
  const passing = evaluateProbeResult("gemini", {
    command: "python3",
    args: ["probe.py"],
    ok: true,
    status: 0,
    signal: null,
    stdout: '{"ready":true}',
    stderr: "",
    error: "",
    timedOut: false,
  });

  assert.equal(passing.status, "pass");
  assert.equal(passing.ready, true);

  const failing = evaluateProbeResult("claude", {
    command: "python3",
    args: ["probe.py"],
    ok: true,
    status: 0,
    signal: null,
    stdout: '{"ready":false}',
    stderr: "",
    error: "",
    timedOut: false,
  });

  assert.equal(failing.status, "fail");
});

test("redacts home paths and truncates command output in reports", () => {
  const home = os.homedir();
  const redacted = redactReportValue(`${home}/.codex/skills/example`);

  assert.equal(redacted, "~/.codex/skills/example");

  const command = formatCommandResult({
    command: "tool",
    args: [`${home}/secret`],
    ok: false,
    status: 1,
    signal: null,
    stdout: "x".repeat(7000),
    stderr: `${home}/stderr`,
    error: "",
    timedOut: false,
  }, { includeOutput: true });

  assert.equal(command.args[0], "~/secret");
  assert.match(command.stdout, /\[truncated /);
  assert.equal(command.stderr, "~/stderr");
});

test("omits raw command output by default", () => {
  const command = formatCommandResult({
    command: "probe",
    args: [],
    ok: true,
    status: 0,
    signal: null,
    stdout: "token=secret-value",
    stderr: "session=secret-value",
    error: "",
    timedOut: false,
  });

  assert.equal(command.stdout.includes("secret-value"), false);
  assert.equal(command.stderr.includes("secret-value"), false);
  assert.equal(command.outputOmitted, true);
});

test("allowlists probe payload fields", () => {
  const payload = sanitizeProbePayload({
    binary: "gemini",
    path: "/Users/example/.local/bin/gemini",
    token: "secret-token",
    available: true,
    ready: true,
    version: {
      ok: true,
      returncode: 0,
      stdout: "version output",
      stderr: "token=secret",
    },
    required_flags: {
      "--prompt": true,
      "--model": false,
    },
  });

  assert.deepEqual(payload, {
    binary: "gemini",
    available: true,
    ready: true,
    version: {
      ok: true,
      returncode: 0,
      error: "",
    },
    required_flags: {
      "--prompt": true,
      "--model": false,
    },
  });
});

test("optional live smoke failures do not fail required readiness", () => {
  const summary = summarizeRequired([
    { id: "core", status: "pass", required: true },
    { id: "claude_live_smoke", status: "fail", required: false },
  ]);

  assert.equal(summary.ready, true);
  assert.deepEqual(summary.failed, []);
});

test("infers WUL issue ids from branch names", () => {
  assert.equal(inferIssueId("codex/wul-295-agentic-development-operating-loop"), "WUL-295");
  assert.equal(inferIssueId("feature/no-issue"), "");
});

test("git workstream check reports issue mismatch", () => {
  const verdict = evaluateGitWorkstream(process.cwd(), "WUL-000");

  assert.equal(verdict.status, "fail");
  assert.ok(verdict.reasons.some((reason) => reason.includes("WUL-000")));
});
