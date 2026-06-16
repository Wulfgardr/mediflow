#!/usr/bin/env node
/* @Codex */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TOOL_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";
const OMITTED_COMMAND_OUTPUT = "[omitted; rerun the probe directly for local debugging]";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const SECRET_KEY_PATTERN = /(?:token|secret|password|passwd|api[_-]?key|authorization|auth|credential|session|cookie|bearer)/i;
const SECRET_TOKEN_PATTERN = /\b(?:sk|ghp|gho|ghu|github_pat|xox[baprs])[_-][A-Za-z0-9_=-]{8,}\b/g;

const DELEGATE_SPECS = [
  {
    id: "gemini",
    skillDir: ".codex/skills/gemini-cli-delegate",
    requiredFiles: [
      "SKILL.md",
      "scripts/probe_gemini_cli.py",
      "scripts/run_gemini_delegate.py",
    ],
    probeScript: "scripts/probe_gemini_cli.py",
  },
  {
    id: "claude",
    skillDir: ".codex/skills/claude-cli-delegate",
    requiredFiles: [
      "SKILL.md",
      "scripts/probe_claude_cli.py",
      "scripts/run_claude_delegate.py",
    ],
    probeScript: "scripts/probe_claude_cli.py",
  },
];

function usage() {
  console.log(`MediFlow agentic stack readiness

Usage:
  npm run agentic:readiness -- [--expected-issue WUL-295] [--json]
  npm run agentic:readiness -- --expected-issue WUL-295 --live-gemini
  npm run agentic:readiness -- --expected-issue WUL-295 --live-claude

Privacy boundary:
  Default mode checks local delegate skill files, CLI non-live probes, branch issue
  metadata, and workflow-monitor metadata. It does not read clinical data, private
  docs, mail, SQLite, or delegate transcript contents. Live smoke flags send only
  a minimal non-PHI prompt to the selected model CLI.

Options:
  --repo <path>                  Repo root. Defaults to cwd.
  --expected-issue <WUL-123>     Guard for the intended Linear issue branch.
  --json                         Emit JSON.
  --live-gemini                  Make a minimal Gemini model call.
  --live-claude                  Make a minimal Claude model call.
  --strict-live                  Make requested live smoke failures block the run.
  --gemini-model <name>          Defaults to ${DEFAULT_GEMINI_MODEL}.
  --timeout-ms <ms>              Probe/smoke timeout. Defaults to ${DEFAULT_TIMEOUT_MS}.
  --no-workflow-monitor          Skip workflow-monitor metadata check.
`);
}

export function parseArgs(argv) {
  const options = {
    repo: process.cwd(),
    expectedIssue: "",
    json: false,
    liveGemini: false,
    liveClaude: false,
    strictLive: false,
    geminiModel: process.env.CODEX_GEMINI_DELEGATE_MODEL || DEFAULT_GEMINI_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    workflowMonitor: true,
    command: "run",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--help" || arg === "-h") {
      options.command = "help";
    } else if (arg === "--repo") {
      options.repo = requireValue(arg, next);
      index += 1;
    } else if (arg === "--expected-issue") {
      options.expectedIssue = requireValue(arg, next).toUpperCase();
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--live-gemini") {
      options.liveGemini = true;
    } else if (arg === "--live-claude") {
      options.liveClaude = true;
    } else if (arg === "--strict-live") {
      options.strictLive = true;
    } else if (arg === "--gemini-model") {
      options.geminiModel = requireValue(arg, next);
      index += 1;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Math.max(1_000, Number.parseInt(requireValue(arg, next), 10) || DEFAULT_TIMEOUT_MS);
      index += 1;
    } else if (arg === "--no-workflow-monitor") {
      options.workflowMonitor = false;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function requireValue(flag, value) {
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    input: options.input,
    encoding: "utf8",
    timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });

  return {
    command,
    args,
    cwd: options.cwd || process.cwd(),
    ok: result.status === 0,
    status: result.status,
    signal: result.signal,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
    error: result.error ? result.error.message : "",
    timedOut: result.error?.code === "ETIMEDOUT",
  };
}

function check(status, id, label, details = {}) {
  return {
    id,
    label,
    status,
    ...details,
  };
}

export function expectedSkillFiles(homeDir = os.homedir()) {
  return DELEGATE_SPECS.flatMap((spec) =>
    spec.requiredFiles.map((relativeFile) => ({
      delegate: spec.id,
      path: path.join(homeDir, spec.skillDir, relativeFile),
    }))
  );
}

export function evaluateSkillFiles(homeDir = os.homedir(), exists = fs.existsSync) {
  const files = expectedSkillFiles(homeDir).map((item) => ({
    delegate: item.delegate,
    path: redactReportValue(item.path),
    exists: exists(item.path),
  }));
  const missing = files.filter((item) => !item.exists);

  return check(missing.length === 0 ? "pass" : "fail", "delegate_skill_files", "Delegate skill files", {
    required: true,
    missing: missing.map((item) => item.path),
    files,
  });
}

export function parseJsonObject(output) {
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
    const firstBrace = output.indexOf("{");
    const lastBrace = output.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace <= firstBrace) return null;
    try {
      return JSON.parse(output.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

export function evaluateProbeResult(delegateId, commandResult) {
  const parsed = parseJsonObject(commandResult.stdout);
  const ready = Boolean(parsed?.ready);
  const status = commandResult.ok && ready ? "pass" : "fail";

  return check(status, `${delegateId}_cli_probe`, `${delegateId} CLI non-live probe`, {
    required: true,
    ready,
    parsed: sanitizeProbePayload(parsed),
    command: formatCommandResult(commandResult),
  });
}

export function sanitizeProbePayload(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const payload = {
    binary: typeof parsed.binary === "string" && !parsed.binary.includes("/") ? parsed.binary : "",
    available: Boolean(parsed.available),
    ready: Boolean(parsed.ready),
  };

  if (parsed.version && typeof parsed.version === "object" && !Array.isArray(parsed.version)) {
    payload.version = {
      ok: Boolean(parsed.version.ok),
      returncode: Number.isInteger(parsed.version.returncode) ? parsed.version.returncode : null,
      error: parsed.version.error ? redactReportValue(parsed.version.error) : "",
    };
  }

  if (parsed.required_flags && typeof parsed.required_flags === "object" && !Array.isArray(parsed.required_flags)) {
    payload.required_flags = Object.fromEntries(
      Object.entries(parsed.required_flags).map(([key, value]) => [key, Boolean(value)])
    );
  }

  return payload;
}

export function redactReportValue(value, key = "") {
  if (key && SECRET_KEY_PATTERN.test(key)) return "[redacted-secret]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactReportValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([itemKey, item]) => [itemKey, redactReportValue(item, itemKey)]));
  }
  return value;
}

function redactText(value) {
  const homeDir = os.homedir();
  const redactedSecrets = String(value)
    .replace(SECRET_TOKEN_PATTERN, "[redacted-token]")
    .replace(
      /((?:token|secret|password|passwd|api[_-]?key|authorization|credential|session|cookie|bearer)[\w.-]*\s*[:=]\s*)[^\s"',}]+/gi,
      "$1[redacted-secret]"
    );
  const redactedHome = redactedSecrets.split(homeDir).join("~");
  if (redactedHome.length <= 6_000) return redactedHome;
  return `${redactedHome.slice(0, 6_000)}\n[truncated ${redactedHome.length - 6_000} chars]`;
}

export function formatCommandResult(commandResult, options = {}) {
  const includeOutput = Boolean(options.includeOutput);
  return {
    command: commandResult.command,
    args: redactReportValue(commandResult.args),
    status: commandResult.status,
    signal: commandResult.signal,
    stdout: includeOutput ? redactReportValue(commandResult.stdout) : commandResult.stdout ? OMITTED_COMMAND_OUTPUT : "",
    stderr: includeOutput ? redactReportValue(commandResult.stderr) : commandResult.stderr ? OMITTED_COMMAND_OUTPUT : "",
    error: redactReportValue(commandResult.error),
    timedOut: commandResult.timedOut,
    outputOmitted: !includeOutput && Boolean(commandResult.stdout || commandResult.stderr),
  };
}

function evaluatePythonRuntime(timeoutMs) {
  const result = runCommand("python3", ["--version"], { cwd: REPO_ROOT, timeoutMs });
  return check(result.ok ? "pass" : "fail", "python3_runtime", "python3 runtime", {
    required: true,
    command: formatCommandResult(result),
  });
}

function runDelegateProbes(homeDir, timeoutMs) {
  return DELEGATE_SPECS.map((spec) => {
    const script = path.join(homeDir, spec.skillDir, spec.probeScript);
    if (!fs.existsSync(script)) {
      return check("fail", `${spec.id}_cli_probe`, `${spec.id} CLI non-live probe`, {
        required: true,
        ready: false,
        command: { error: redactReportValue(`Missing probe script: ${script}`) },
      });
    }

    const result = runCommand("python3", [script], { cwd: REPO_ROOT, timeoutMs });
    return evaluateProbeResult(spec.id, result);
  });
}

export function inferIssueId(value) {
  const match = String(value || "").match(/\b(WUL-\d+)\b/i);
  return match ? match[1].toUpperCase() : "";
}

function gitValue(repoRoot, args, fallback = "") {
  const result = runCommand("git", args, { cwd: repoRoot, timeoutMs: 10_000 });
  return result.ok ? result.stdout : fallback;
}

export function evaluateGitWorkstream(repoRoot, expectedIssue = "") {
  const root = path.resolve(repoRoot);
  const branch = gitValue(root, ["rev-parse", "--abbrev-ref", "HEAD"], "unknown");
  const upstream = gitValue(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], "");
  const branchIssue = inferIssueId(branch);
  const normalizedExpected = String(expectedIssue || "").toUpperCase();
  const reasons = [];
  let status = "pass";

  if (branch === "main") {
    status = "fail";
    reasons.push("Current branch is main.");
  }
  if (normalizedExpected && branchIssue !== normalizedExpected) {
    status = "fail";
    reasons.push(`Branch issue ${branchIssue || "missing"} does not match expected ${normalizedExpected}.`);
  }

  return check(status, "git_workstream", "Git workstream", {
    required: true,
    repo: redactReportValue(root),
    branch,
    branchIssue,
    upstream,
    expectedIssue: normalizedExpected,
    reasons,
  });
}

function runLiveGemini(options) {
  const result = withEmptyTempDir((cwd) =>
    runCommand(
      "gemini",
      [
        "--prompt",
        "Reply with exactly: GEMINI_OK",
        "--approval-mode",
        "plan",
        "--output-format",
        "text",
        "--model",
        options.geminiModel,
      ],
      { cwd, timeoutMs: options.timeoutMs }
    )
  );
  const passed = result.ok && /\bGEMINI_OK\b/.test(result.stdout);

  return check(passed ? "pass" : "fail", "gemini_live_smoke", "Gemini live smoke", {
    required: Boolean(options.strictLive),
    model: options.geminiModel,
    command: formatCommandResult(result),
  });
}

function runLiveClaude(options) {
  const result = withEmptyTempDir((cwd) =>
    runCommand(
      "claude",
      [
        "--print",
        "--input-format",
        "text",
        "--output-format",
        "text",
        "--permission-mode",
        "plan",
        "--tools",
        "",
        "--no-session-persistence",
      ],
      {
        cwd,
        input: "Reply with exactly: CLAUDE_OK",
        timeoutMs: options.timeoutMs,
      }
    )
  );
  const passed = result.ok && /\bCLAUDE_OK\b/.test(result.stdout);

  return check(passed ? "pass" : "fail", "claude_live_smoke", "Claude live smoke", {
    required: Boolean(options.strictLive),
    command: formatCommandResult(result),
  });
}

function skippedLiveCheck(id, label) {
  return check("skip", id, label, {
    required: false,
    reason: "Live model smoke not requested.",
  });
}

function withEmptyTempDir(callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mediflow-agentic-live-"));
  try {
    return callback(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function summarizeRequired(checks) {
  const requiredChecks = checks.filter((item) => item.required !== false);
  const failed = requiredChecks.filter((item) => item.status === "fail");
  return {
    ready: failed.length === 0,
    failed: failed.map((item) => item.id),
  };
}

function runWorkflowMonitor(options, preliminaryReady) {
  if (!options.workflowMonitor) {
    return check("skip", "workflow_monitor", "Workflow monitor", {
      required: false,
      reason: "Skipped by --no-workflow-monitor.",
    });
  }

  const args = [
    path.join(REPO_ROOT, "scripts/codex-workflow-monitor.mjs"),
    "--once",
    "--json",
    "--check",
    `agentic-stack-readiness=${preliminaryReady ? "pass" : "fail"}`,
  ];
  if (options.expectedIssue) {
    args.push("--expected-issue", options.expectedIssue);
  }

  const result = runCommand(process.execPath, args, { cwd: options.repo, timeoutMs: options.timeoutMs });
  const parsed = parseJsonObject(result.stdout);
  const monitorStatus = parsed?.decision?.status;
  const passed = result.ok && monitorStatus === "continue";

  return check(passed ? "pass" : "fail", "workflow_monitor", "Workflow monitor", {
    required: true,
    monitorStatus,
    flags: parsed?.decision?.flags || [],
    nextStep: parsed?.decision?.nextStep || "",
    parsed: redactReportValue(parsed),
    command: formatCommandResult(result),
  });
}

export function buildReadinessReport(options) {
  const resolvedOptions = {
    ...options,
    repo: path.resolve(options.repo || process.cwd()),
  };
  const homeDir = os.homedir();
  const checks = [
    evaluateSkillFiles(homeDir),
    evaluateGitWorkstream(resolvedOptions.repo, resolvedOptions.expectedIssue),
    evaluatePythonRuntime(resolvedOptions.timeoutMs),
    ...runDelegateProbes(homeDir, resolvedOptions.timeoutMs),
  ];

  checks.push(resolvedOptions.liveGemini ? runLiveGemini(resolvedOptions) : skippedLiveCheck("gemini_live_smoke", "Gemini live smoke"));
  checks.push(resolvedOptions.liveClaude ? runLiveClaude(resolvedOptions) : skippedLiveCheck("claude_live_smoke", "Claude live smoke"));

  const stackSummary = summarizeRequired(checks);
  const workflowCheck = runWorkflowMonitor(resolvedOptions, stackSummary.ready);
  checks.push(workflowCheck);
  const finalSummary = summarizeRequired(checks);
  const liveWarnings = checks
    .filter((item) => item.id.endsWith("_live_smoke") && item.status === "fail" && item.required === false)
    .map((item) => item.id);

  return {
    version: TOOL_VERSION,
    generatedAt: new Date().toISOString(),
    repo: {
      root: resolvedOptions.repo,
      expectedIssue: resolvedOptions.expectedIssue || "",
    },
    summary: {
      status: finalSummary.ready ? "pass" : "fail",
      ready: finalSummary.ready,
      stackReady: stackSummary.ready,
      workflowReady: workflowCheck.status === "pass" || workflowCheck.status === "skip",
      failed: finalSummary.failed,
      warnings: liveWarnings,
      nextStep: finalSummary.ready
        ? liveWarnings.length > 0
          ? "Agentic stack is usable; fix live delegate warnings before assigning work to those delegates."
          : "Agentic development stack is ready for this workstream."
        : "Fix failed checks or record the blocker before delegating more work.",
    },
    checks,
    privacy: {
      checkedSurfaces: [
        "delegate skill file presence",
        "CLI help/version probes",
        "Git branch metadata",
        "workflow-monitor metadata",
        "optional live smoke credential availability from an empty temp directory",
      ],
      omittedSurfaces: [
        "clinical database contents",
        "mail contents",
        "docs/private contents",
        "delegate transcript contents",
        "Git diff contents inside workflow-monitor",
      ],
      defaultExternalModelCalls: false,
      externalModelCalls: [
        resolvedOptions.liveGemini ? "gemini" : "",
        resolvedOptions.liveClaude ? "claude" : "",
      ].filter(Boolean),
      reportOutputPolicy: "probe stdout/stderr omitted by default; parsed probe data is allowlisted",
      livePromptShape: "static ok-token prompt only; no repo cwd",
    },
  };
}

function formatTextReport(report) {
  const lines = [
    `MediFlow agentic stack readiness: ${report.summary.status}`,
    `Repo: ${report.repo.root}`,
  ];
  if (report.repo.expectedIssue) lines.push(`Expected issue: ${report.repo.expectedIssue}`);
  if (report.summary.warnings?.length) lines.push(`Warnings: ${report.summary.warnings.join(", ")}`);
  lines.push("");

  for (const item of report.checks) {
    const suffix = item.required === false ? " optional" : "";
    lines.push(`- ${item.status.toUpperCase()} ${item.label}${suffix}`);
    if (item.id === "git_workstream") {
      lines.push(`  branch: ${item.branch}`);
      if (item.reasons?.length) lines.push(`  reason: ${item.reasons.join(" ")}`);
    }
    if (item.id === "workflow_monitor" && item.status !== "skip") {
      lines.push(`  monitor: ${item.monitorStatus || "unknown"}`);
      if (item.flags?.length) lines.push(`  flags: ${item.flags.join(", ")}`);
    }
    if (item.status === "fail" && item.command?.stderr) {
      lines.push(`  stderr: ${item.command.stderr.split(/\r?\n/).slice(0, 3).join(" ")}`);
    }
    if (item.status === "fail" && item.command?.error) {
      lines.push(`  error: ${item.command.error}`);
    }
    if (item.status === "fail" && item.command?.timedOut) {
      lines.push("  error: command timed out");
    }
    if (item.status === "fail" && item.missing?.length) {
      lines.push(`  missing: ${item.missing.join(", ")}`);
    }
  }

  lines.push("");
  lines.push(report.summary.nextStep);
  return lines.join("\n");
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === "help") {
      usage();
      return;
    }

    const report = buildReadinessReport(options);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatTextReport(report));
    }

    process.exitCode = report.summary.ready ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] === SCRIPT_PATH) {
  main();
}
