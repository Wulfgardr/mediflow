#!/usr/bin/env node
/* @Codex */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TOOL_VERSION = 1;
const DEFAULT_MODEL = "batiai/gemma4-e4b:q4";
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const LAUNCH_AGENT_LABEL = "com.mediflow.workflow-monitor";
const MAX_SNAPSHOTS_JSONL_BYTES = 10 * 1024 * 1024;

function defaultStateDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "MediFlow", "workflow-monitor");
  }
  return path.join(os.homedir(), ".mediflow", "workflow-monitor");
}

function usage() {
  console.log(`MediFlow local workflow monitor

Usage:
  npm run workflow-monitor -- --once [--json] [--write] [--check lint=pass]
  npm run workflow-monitor -- watch [--interval-seconds 300] [--quiet]
  npm run workflow-monitor -- status [--json]
  npm run workflow-monitor -- install-launch-agent [--launch-interval-seconds 300]
  npm run workflow-monitor -- uninstall-launch-agent

Privacy boundary:
  Reads Git metadata only: branch, status paths, changed path names and explicit check results.
  Does not read diff contents, SQLite, docs/private contents, mail, attachments or patient data.

Options:
  --repo <path>                         Repo root. Defaults to cwd.
  --state-dir <path>                    Snapshot directory. Defaults to Application Support.
  --expected-issue <WUL-123>            Optional guard for the intended issue.
  --check <name=pass|fail|skip>         Repeatable verification hints.
  --model-mode <off|auto|always>        Local Ollama digest mode. Defaults to env or off.
  --model <ollama-model>                Defaults to ${DEFAULT_MODEL}.
  --ollama-url <url>                    Defaults to ${DEFAULT_OLLAMA_URL}.
  --quiet                               Suppress ordinary output.
`);
}

export function parseArgs(argv) {
  const args = [...argv];
  let command = "once";
  if (args[0] && !args[0].startsWith("-")) {
    command = args.shift();
  }

  const options = {
    command,
    repo: process.cwd(),
    stateDir: process.env.MEDIFLOW_WORKFLOW_MONITOR_STATE_DIR || defaultStateDir(),
    expectedIssue: process.env.MEDIFLOW_WORKFLOW_MONITOR_EXPECTED_ISSUE || "",
    checks: {},
    json: false,
    quiet: false,
    write: false,
    intervalSeconds: 300,
    launchIntervalSeconds: 300,
    modelMode: process.env.MEDIFLOW_WORKFLOW_MONITOR_MODEL_MODE || "off",
    model: process.env.MEDIFLOW_WORKFLOW_MONITOR_MODEL || DEFAULT_MODEL,
    ollamaUrl: process.env.MEDIFLOW_WORKFLOW_MONITOR_OLLAMA_URL || DEFAULT_OLLAMA_URL,
    bootstrap: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--help" || arg === "-h") {
      options.command = "help";
    } else if (arg === "--once") {
      options.command = "once";
    } else if (arg === "--repo") {
      options.repo = requireValue(arg, next);
      index += 1;
    } else if (arg === "--state-dir") {
      options.stateDir = requireValue(arg, next);
      index += 1;
    } else if (arg === "--expected-issue") {
      options.expectedIssue = requireValue(arg, next);
      index += 1;
    } else if (arg === "--check") {
      const parsed = parseCheck(requireValue(arg, next));
      if (!parsed) throw new Error("--check must use name=pass|fail|skip");
      options.checks[parsed.name] = parsed.status;
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "--write") {
      options.write = true;
    } else if (arg === "--interval-seconds") {
      options.intervalSeconds = Math.max(15, Number.parseInt(requireValue(arg, next), 10) || 300);
      index += 1;
    } else if (arg === "--launch-interval-seconds") {
      options.launchIntervalSeconds = Math.max(60, Number.parseInt(requireValue(arg, next), 10) || 300);
      index += 1;
    } else if (arg === "--model-mode") {
      options.modelMode = requireValue(arg, next);
      index += 1;
    } else if (arg === "--model") {
      options.model = requireValue(arg, next);
      index += 1;
    } else if (arg === "--ollama-url") {
      options.ollamaUrl = requireValue(arg, next);
      index += 1;
    } else if (arg === "--no-bootstrap") {
      options.bootstrap = false;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!["off", "auto", "always"].includes(options.modelMode)) {
    throw new Error("--model-mode must be off, auto or always");
  }

  return options;
}

function requireValue(flag, value) {
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseCheck(value) {
  const match = String(value).match(/^([^=]+)=(pass|fail|skip)$/i);
  if (!match) return null;
  return { name: match[1].trim(), status: match[2].toLowerCase() };
}

function runGit(repoRoot, args, fallback = "", options = {}) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) return fallback;
  return options.trim === false ? result.stdout : result.stdout.trim();
}

function collectGitSnapshot(repoRoot) {
  const root = path.resolve(repoRoot);
  const branch = runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"], "unknown");
  const upstream = runGit(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], "");
  const statusOutput = runGit(root, ["status", "--porcelain=v1"], "", { trim: false });
  const statusFiles = parsePorcelainStatus(statusOutput);
  const mainDiffOutput = runGit(root, ["diff", "--name-only", "main...HEAD"], "");
  const mainDiffFiles = mainDiffOutput ? mainDiffOutput.split(/\r?\n/).filter(Boolean) : [];
  const branchIssue = inferIssueId(branch);
  const mainRef = runGit(root, ["rev-parse", "--verify", "main"], "");
  const headRef = runGit(root, ["rev-parse", "--verify", "HEAD"], "");

  return {
    root,
    branch,
    branchIssue,
    upstream,
    onMain: branch === "main",
    headRef: shortSha(headRef),
    mainRef: shortSha(mainRef),
    statusFiles,
    mainDiffFiles,
  };
}

export function parsePorcelainStatus(output) {
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      const rawPath = line.slice(3);
      const normalizedPath = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() : rawPath;
      return {
        status,
        path: normalizedPath,
      };
    });
}

function inferIssueId(value) {
  const match = String(value || "").match(/\b(WUL-\d+)\b/i);
  return match ? match[1].toUpperCase() : "";
}

function shortSha(value) {
  return value ? value.slice(0, 12) : "";
}

function hashPath(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function classifyPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  const categories = [];
  let sensitive = false;
  let sensitiveReason = "";

  if (lower.startsWith("docs/private/") || lower.includes("/docs/private/")) {
    sensitive = true;
    sensitiveReason = "private-docs";
    categories.push("private");
  }
  if (/(^|\/)(certs?|certificates|secrets|\.ssh|farmaci|exports?|private-data|patient-data)(\/|$)/i.test(normalized)) {
    sensitive = true;
    sensitiveReason ||= "sensitive-directory";
    categories.push("private");
  }
  if (/(^|\/)\.env($|\.)/.test(lower) || lower.includes("secret") || lower.includes("token")) {
    sensitive = true;
    sensitiveReason ||= "secret-like";
    categories.push("secret");
  }
  if (/(^|\/)medical\.db$|\.sqlite$|\.sqlite3$|\.db$/i.test(normalized)) {
    sensitive = true;
    sensitiveReason ||= "database";
    categories.push("database");
  }
  if (/\.(pdf|png|jpe?g|heic|tiff?|docx|xlsx|p7m)$/i.test(normalized)) {
    sensitive = true;
    sensitiveReason ||= "document-artifact";
    categories.push("document-artifact");
  }
  if (/\.(pem|key|p12|pfx|crt|cer|zip|7z|rar|tar|tgz|tar\.gz)$/i.test(normalized)) {
    sensitive = true;
    sensitiveReason ||= "secret-or-archive-artifact";
    categories.push("document-artifact");
  }

  if (lower.startsWith("docs/adr/")) categories.push("adr");
  if (lower === "architecture.md") categories.push("architecture");
  if (lower === "security.md") categories.push("security");
  if (lower.includes("/api/v1/") || lower.startsWith("app/api/v1/")) categories.push("api-v1");
  if (lower === "lib/schema.ts" || lower.startsWith("drizzle/")) categories.push("schema");
  if (lower.startsWith("scripts/")) categories.push("tooling");
  if (lower.endsWith(".test.ts") || lower.endsWith(".test.mjs") || lower.includes("-test.")) categories.push("test");
  if (lower.endsWith(".md")) categories.push("docs");
  if (lower === "package.json" || lower === "package-lock.json") categories.push("package");

  return {
    path: normalized,
    displayPath: sensitive ? `[redacted:${sensitiveReason}:${hashPath(normalized)}]` : normalized,
    sensitive,
    sensitiveReason,
    categories: [...new Set(categories)],
  };
}

function summarizePaths(snapshot) {
  const paths = new Set();
  for (const file of snapshot.statusFiles || []) paths.add(file.path);
  for (const file of snapshot.mainDiffFiles || []) paths.add(file);

  const classified = [...paths].sort().map(classifyPath);
  const categoryCounts = {};
  for (const item of classified) {
    for (const category of item.categories) {
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    }
  }

  return {
    changedCount: classified.length,
    dirtyCount: snapshot.statusFiles?.length || 0,
    sensitiveCount: classified.filter((item) => item.sensitive).length,
    paths: classified.map((item) => item.displayPath),
    sensitiveReasons: [...new Set(classified.filter((item) => item.sensitive).map((item) => item.sensitiveReason))],
    categoryCounts,
    hasCodeChanges: classified.some((item) => !item.categories.includes("docs")),
    hasTests: classified.some((item) => item.categories.includes("test")),
    hasAdr: classified.some((item) => item.categories.includes("adr")),
    touchesArchitecture: classified.some((item) => item.categories.includes("architecture") || item.categories.includes("security")),
    touchesApiOrSchema: classified.some((item) => item.categories.includes("api-v1") || item.categories.includes("schema")),
  };
}

export function evaluateSnapshot(snapshot, options = {}) {
  const expectedIssue = String(options.expectedIssue || "").toUpperCase();
  const checks = options.checks || {};
  const pathSummary = summarizePaths(snapshot);
  const flags = [];
  const reasons = [];
  let severity = "low";
  let status = "continue";
  let nextStep = "Continue on the current workstream.";

  const raise = (nextSeverity, nextStatus, flag, reason, step) => {
    flags.push(flag);
    reasons.push(reason);
    if (severityRank(nextSeverity) > severityRank(severity)) severity = nextSeverity;
    if (statusRank(nextStatus) > statusRank(status)) status = nextStatus;
    if (step) nextStep = step;
  };

  if (expectedIssue && snapshot.branchIssue && snapshot.branchIssue !== expectedIssue) {
    raise(
      "high",
      "blocked",
      "expected_issue_mismatch",
      `Branch issue ${snapshot.branchIssue} does not match expected ${expectedIssue}.`,
      "Stop edits and switch to the dedicated issue branch."
    );
  }

  if (expectedIssue && !snapshot.branchIssue && pathSummary.changedCount > 0) {
    raise(
      "high",
      "blocked",
      "expected_issue_missing_from_branch",
      `Expected ${expectedIssue}, but the branch name does not carry an issue id.`,
      "Move the work to a codex/<issue-id>-<slug> branch before editing."
    );
  }

  if (!snapshot.branchIssue && pathSummary.changedCount > 0) {
    raise(
      "medium",
      "needs_codex",
      "issue_less_branch_with_changes",
      "Changed files are present on a branch without a Linear issue id.",
      "Create or select a Linear issue and branch before continuing."
    );
  }

  if (snapshot.onMain && pathSummary.dirtyCount > 0) {
    raise(
      "high",
      "blocked",
      "dirty_main",
      "The main branch has uncommitted changes.",
      "Move the changes to a dedicated branch before continuing."
    );
  }

  if (pathSummary.sensitiveCount > 0) {
    raise(
      "high",
      "blocked",
      "sensitive_paths_changed",
      `Sensitive/private-looking paths changed: ${pathSummary.sensitiveReasons.join(", ")}.`,
      "Stop and inspect the scope manually before writing or sharing artifacts."
    );
  }

  const failedChecks = Object.entries(checks).filter(([, value]) => value === "fail").map(([name]) => name);
  if (failedChecks.length > 0) {
    raise(
      "high",
      "blocked",
      "checks_failed",
      `Failed checks: ${failedChecks.join(", ")}.`,
      "Fix failed checks before handoff."
    );
  }

  const checkNames = Object.keys(checks);
  if (pathSummary.hasCodeChanges && checkNames.length === 0) {
    raise(
      "medium",
      "needs_codex",
      "tests_not_declared",
      "Code/tooling changed but no verification result was declared.",
      "Run the focused test or pass --check <name=pass|fail|skip>."
    );
  }

  if ((pathSummary.touchesArchitecture || pathSummary.touchesApiOrSchema) && !pathSummary.hasAdr) {
    raise(
      "medium",
      "needs_codex",
      "adr_may_be_required",
      "Architecture, security, API or schema paths changed without an ADR in the diff.",
      "Add or update an ADR before continuing if this is a durable decision."
    );
  }

  if (flags.length === 0) {
    reasons.push("No branch, privacy or verification drift detected from metadata.");
  }

  const verdict = {
    version: TOOL_VERSION,
    generatedAt: new Date().toISOString(),
    repo: {
      root: snapshot.root,
      branch: snapshot.branch,
      branchIssue: snapshot.branchIssue,
      upstream: snapshot.upstream,
      onMain: snapshot.onMain,
      headRef: snapshot.headRef,
      mainRef: snapshot.mainRef,
    },
    changeSummary: pathSummary,
    checks,
    decision: {
      status,
      severity,
      flags: [...new Set(flags)],
      reasons,
      nextStep,
    },
    privacy: {
      diffContentRead: false,
      clinicalDatabaseRead: false,
      mailRead: false,
      privateDocContentRead: false,
      modelInput: "redacted metadata summary only",
    },
  };

  verdict.changeSignature = buildChangeSignature(verdict);
  verdict.workflowSignature = buildWorkflowSignature(verdict);
  return verdict;
}

function severityRank(value) {
  return { low: 0, medium: 1, high: 2 }[value] ?? 0;
}

function statusRank(value) {
  return { continue: 0, needs_codex: 1, blocked: 2 }[value] ?? 0;
}

function buildChangeSignature(verdict) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        branch: verdict.repo.branch,
        branchIssue: verdict.repo.branchIssue,
        headRef: verdict.repo.headRef,
        mainRef: verdict.repo.mainRef,
        paths: verdict.changeSummary.paths,
        dirtyCount: verdict.changeSummary.dirtyCount,
        sensitiveCount: verdict.changeSummary.sensitiveCount,
      })
    )
    .digest("hex")
    .slice(0, 16);
}

function buildWorkflowSignature(verdict) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        branch: verdict.repo.branch,
        branchIssue: verdict.repo.branchIssue,
        paths: verdict.changeSummary.paths,
        dirtyCount: verdict.changeSummary.dirtyCount,
        sensitiveCount: verdict.changeSummary.sensitiveCount,
        checks: verdict.checks,
        decision: verdict.decision,
      })
    )
    .digest("hex")
    .slice(0, 16);
}

export function resolveEffectiveChecks(preliminaryVerdict, explicitChecks, previousVerdict = null) {
  if (Object.keys(explicitChecks || {}).length > 0) return explicitChecks;
  if (
    preliminaryVerdict.changeSummary.dirtyCount === 0
    && previousVerdict?.changeSignature === preliminaryVerdict.changeSignature
    && previousVerdict?.checks
  ) {
    return previousVerdict.checks;
  }
  return {};
}

function buildModelInput(verdict) {
  return {
    branch: verdict.repo.branch,
    branchIssue: verdict.repo.branchIssue,
    changedCount: verdict.changeSummary.changedCount,
    dirtyCount: verdict.changeSummary.dirtyCount,
    sensitiveCount: verdict.changeSummary.sensitiveCount,
    categories: verdict.changeSummary.categoryCounts,
    checks: verdict.checks,
    deterministicDecision: verdict.decision,
    privacyBoundary: verdict.privacy,
  };
}

async function attachLocalModelDigest(verdict, options, previousVerdict = null) {
  if (options.modelMode === "off") return verdict;
  if (options.modelMode === "auto" && verdict.decision.severity === "low") {
    return {
      ...verdict,
      localModelDigest: {
        status: "skipped",
        reason: "auto mode runs only for medium/high risk verdicts",
      },
    };
  }
  if (
    options.modelMode === "auto"
    && previousVerdict?.workflowSignature === verdict.workflowSignature
    && previousVerdict?.localModelDigest
  ) {
    return {
      ...verdict,
      localModelDigest: {
        ...previousVerdict.localModelDigest,
        status: `cached-${previousVerdict.localModelDigest.status}`,
        cachedFrom: previousVerdict.generatedAt,
      },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${options.ollamaUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: options.model,
        stream: false,
        format: "json",
        options: { temperature: 0 },
        messages: [
          {
            role: "system",
            content: "You summarize local software workflow metadata. Return JSON only with keys risk, summary, nextStep. Do not ask to read private content.",
          },
          {
            role: "user",
            content: JSON.stringify(buildModelInput(verdict)),
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`);
    }
    const payload = await response.json();
    const raw = payload?.message?.content || "{}";
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { summary: String(raw).slice(0, 600) };
    }
    return {
      ...verdict,
      localModelDigest: {
        status: "ok",
        model: options.model,
        digest: parsed,
      },
    };
  } catch (error) {
    return {
      ...verdict,
      localModelDigest: {
        status: "unavailable",
        model: options.model,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function renderMarkdown(verdict) {
  const lines = [
    "# MediFlow Workflow Monitor",
    "",
    `Generated: ${verdict.generatedAt}`,
    `Branch: ${verdict.repo.branch || "unknown"}`,
    `Issue: ${verdict.repo.branchIssue || "none"}`,
    `Decision: ${verdict.decision.status} (${verdict.decision.severity})`,
    "",
    "## Reasons",
    ...verdict.decision.reasons.map((reason) => `- ${reason}`),
    "",
    "## Next Step",
    "",
    verdict.decision.nextStep,
    "",
    "## Change Summary",
    "",
    `- Changed paths: ${verdict.changeSummary.changedCount}`,
    `- Dirty paths: ${verdict.changeSummary.dirtyCount}`,
    `- Sensitive/private-looking paths: ${verdict.changeSummary.sensitiveCount}`,
    `- Categories: ${JSON.stringify(verdict.changeSummary.categoryCounts)}`,
    "",
    "## Privacy Boundary",
    "",
    "- Diff contents read: no",
    "- Clinical DB read: no",
    "- Mail/private document contents read: no",
  ];
  if (verdict.localModelDigest) {
    lines.push("", "## Local Model Digest", "", `Status: ${verdict.localModelDigest.status}`);
    if (verdict.localModelDigest.digest) {
      lines.push("", "```json", JSON.stringify(verdict.localModelDigest.digest, null, 2), "```");
    }
  }
  return `${lines.join("\n")}\n`;
}

function ensureStateDir(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
}

function writeSnapshot(verdict, stateDir) {
  ensureStateDir(stateDir);
  const json = `${JSON.stringify(verdict)}\n`;
  const lastPath = path.join(stateDir, "last.json");
  const snapshotsPath = path.join(stateDir, "snapshots.jsonl");
  const tmpPath = `${lastPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(verdict, null, 2));
  fs.renameSync(tmpPath, lastPath);
  if (
    fs.existsSync(snapshotsPath)
    && fs.statSync(snapshotsPath).size + Buffer.byteLength(json, "utf8") > MAX_SNAPSHOTS_JSONL_BYTES
  ) {
    fs.writeFileSync(snapshotsPath, json);
  } else {
    fs.appendFileSync(snapshotsPath, json);
  }
  fs.writeFileSync(path.join(stateDir, "last.md"), renderMarkdown(verdict));
}

function readLastSnapshot(stateDir) {
  const lastPath = path.join(stateDir, "last.json");
  if (!fs.existsSync(lastPath)) return null;
  return JSON.parse(fs.readFileSync(lastPath, "utf8"));
}

async function runOnce(options) {
  const snapshot = collectGitSnapshot(options.repo);
  const previousVerdict = options.write ? readLastSnapshot(options.stateDir) : null;
  const preliminaryVerdict = evaluateSnapshot(snapshot, {
    expectedIssue: options.expectedIssue,
    checks: {},
  });
  const effectiveChecks = resolveEffectiveChecks(preliminaryVerdict, options.checks, previousVerdict);
  let verdict = evaluateSnapshot(snapshot, {
    expectedIssue: options.expectedIssue,
    checks: effectiveChecks,
  });
  verdict = await attachLocalModelDigest(verdict, options, previousVerdict);

  if (options.write) {
    writeSnapshot(verdict, options.stateDir);
  }

  if (!options.quiet) {
    if (options.json) {
      console.log(JSON.stringify(verdict, null, 2));
    } else {
      process.stdout.write(renderMarkdown(verdict));
    }
  }

  return verdict;
}

async function runWatch(options) {
  const watchOptions = { ...options, write: true };
  while (true) {
    await runOnce(watchOptions);
    await new Promise((resolve) => setTimeout(resolve, watchOptions.intervalSeconds * 1000));
  }
}

function launchAgentPath() {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
}

function escapePlist(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

export function buildLaunchAgentPlist(options) {
  const scriptPath = fileURLToPath(import.meta.url);
  const args = [
    process.execPath,
    scriptPath,
    "once",
    "--repo",
    path.resolve(options.repo),
    "--state-dir",
    options.stateDir,
    "--write",
    "--quiet",
    "--model-mode",
    options.modelMode === "off" ? "auto" : options.modelMode,
    "--model",
    options.model,
    "--ollama-url",
    options.ollamaUrl,
  ];
  if (options.expectedIssue) {
    args.push("--expected-issue", options.expectedIssue);
  }

  const arrayItems = args.map((arg) => `    <string>${escapePlist(arg)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${arrayItems}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${options.launchIntervalSeconds}</integer>
  <key>StandardOutPath</key>
  <string>${escapePlist(path.join(options.stateDir, "launchd.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapePlist(path.join(options.stateDir, "launchd.err.log"))}</string>
</dict>
</plist>
`;
}

function runLaunchctl(args) {
  return spawnSync("launchctl", args, { encoding: "utf8" });
}

function installLaunchAgent(options) {
  if (process.platform !== "darwin") {
    throw new Error("launchd install is available only on macOS");
  }
  ensureStateDir(options.stateDir);
  fs.mkdirSync(path.dirname(launchAgentPath()), { recursive: true });
  fs.writeFileSync(launchAgentPath(), buildLaunchAgentPlist(options), "utf8");

  if (options.bootstrap) {
    const domain = `gui/${process.getuid()}`;
    runLaunchctl(["bootout", domain, launchAgentPath()]);
    const bootstrap = runLaunchctl(["bootstrap", domain, launchAgentPath()]);
    if (bootstrap.status !== 0) {
      throw new Error(bootstrap.stderr.trim() || "launchctl bootstrap failed");
    }
    runLaunchctl(["kickstart", "-k", `${domain}/${LAUNCH_AGENT_LABEL}`]);
  }

  return {
    label: LAUNCH_AGENT_LABEL,
    path: launchAgentPath(),
    stateDir: options.stateDir,
    intervalSeconds: options.launchIntervalSeconds,
  };
}

function uninstallLaunchAgent(options) {
  if (process.platform !== "darwin") {
    throw new Error("launchd uninstall is available only on macOS");
  }
  const domain = `gui/${process.getuid()}`;
  runLaunchctl(["bootout", domain, launchAgentPath()]);
  if (fs.existsSync(launchAgentPath())) fs.unlinkSync(launchAgentPath());
  return {
    label: LAUNCH_AGENT_LABEL,
    removed: true,
    path: launchAgentPath(),
    stateDir: options.stateDir,
  };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === "help") {
      usage();
      return;
    }
    if (options.command === "once") {
      await runOnce(options);
      return;
    }
    if (options.command === "watch") {
      await runWatch({ ...options, write: true });
      return;
    }
    if (options.command === "status") {
      const last = readLastSnapshot(options.stateDir);
      if (!last) {
        if (!options.quiet) console.log("No workflow-monitor snapshot yet.");
        return;
      }
      if (options.json) console.log(JSON.stringify(last, null, 2));
      else process.stdout.write(renderMarkdown(last));
      return;
    }
    if (options.command === "install-launch-agent") {
      const result = installLaunchAgent(options);
      if (!options.quiet) console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (options.command === "uninstall-launch-agent") {
      const result = uninstallLaunchAgent(options);
      if (!options.quiet) console.log(JSON.stringify(result, null, 2));
      return;
    }
    throw new Error(`Unknown command: ${options.command}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const currentModulePath = path.resolve(fileURLToPath(import.meta.url));
const entrypointPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (currentModulePath === entrypointPath) {
  await main();
}
