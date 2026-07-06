/* @Codex */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildLaunchAgentPlist,
  checksSidecarPath,
  evaluateSnapshot,
  globalRunnerPath,
  parseArgs,
  parsePorcelainStatus,
  persistDeclaredChecks,
  readChecksSidecar,
  removePersistedDeclaration,
  resolveChecksWithProvenance,
  resolveEffectiveChecks,
  sanitizePersistedChecks,
  selectPersistedDeclaration,
  upsertPersistedDeclaration,
} from "./codex-workflow-monitor.mjs";

function snapshot(overrides = {}) {
  return {
    root: "/tmp/mediflow",
    branch: "codex/wul-283-local-workflow-monitor",
    branchIssue: "WUL-283",
    upstream: "",
    onMain: false,
    headRef: "abc123",
    mainRef: "def456",
    statusFiles: [],
    mainDiffFiles: [],
    ...overrides,
  };
}

test("continues on a clean issue branch", () => {
  const verdict = evaluateSnapshot(snapshot(), { expectedIssue: "WUL-283" });

  assert.equal(verdict.decision.status, "continue");
  assert.equal(verdict.decision.severity, "low");
  assert.deepEqual(verdict.decision.flags, []);
  assert.equal(verdict.privacy.diffContentRead, false);
});

test("accepts --once as the documented command flag", () => {
  const options = parseArgs(["--once", "--json", "--expected-issue", "WUL-283"]);

  assert.equal(options.command, "once");
  assert.equal(options.json, true);
  assert.equal(options.expectedIssue, "WUL-283");
});

test("rejects missing flag values instead of swallowing the next option", () => {
  assert.throws(
    () => parseArgs(["--interval-seconds", "--json"]),
    /--interval-seconds requires a value/
  );
});

test("preserves leading-space porcelain status paths", () => {
  const files = parsePorcelainStatus(" M docs/README.md\n?? scripts/new-tool.mjs\n");

  assert.deepEqual(files, [
    { status: " M", path: "docs/README.md" },
    { status: "??", path: "scripts/new-tool.mjs" },
  ]);
});

test("blocks when the expected issue does not match the branch issue", () => {
  const verdict = evaluateSnapshot(
    snapshot({
      branch: "codex/wul-277-service-prescriptions",
      branchIssue: "WUL-277",
      mainDiffFiles: ["scripts/codex-workflow-monitor.mjs"],
    }),
    { expectedIssue: "WUL-283" }
  );

  assert.equal(verdict.decision.status, "blocked");
  assert.equal(verdict.decision.severity, "high");
  assert.ok(verdict.decision.flags.includes("expected_issue_mismatch"));
  assert.equal(verdict.decision.nextStep, "Stop edits and switch to the dedicated issue branch.");
});

test("keeps the highest-priority next step when later checks also fire", () => {
  const mismatchVerdict = evaluateSnapshot(
    snapshot({
      branch: "codex/wul-277-service-prescriptions",
      branchIssue: "WUL-277",
      mainDiffFiles: ["scripts/codex-workflow-monitor.mjs"],
    }),
    { expectedIssue: "WUL-284" }
  );

  assert.equal(mismatchVerdict.decision.status, "blocked");
  assert.ok(mismatchVerdict.decision.flags.includes("tests_not_declared"));
  assert.equal(mismatchVerdict.decision.nextStep, "Stop edits and switch to the dedicated issue branch.");

  const sensitiveVerdict = evaluateSnapshot(
    snapshot({
      branch: "codex/wul-284-workflow-monitor-hardening",
      branchIssue: "WUL-284",
      statusFiles: [
        { status: " M", path: "docs/private/smoke/example.md" },
        { status: " M", path: "scripts/codex-workflow-monitor.mjs" },
      ],
    }),
    { expectedIssue: "WUL-284" }
  );

  assert.equal(sensitiveVerdict.decision.status, "blocked");
  assert.ok(sensitiveVerdict.decision.flags.includes("tests_not_declared"));
  assert.equal(
    sensitiveVerdict.decision.nextStep,
    "Stop and inspect the scope manually before writing or sharing artifacts."
  );
});

test("redacts sensitive paths and blocks the workflow", () => {
  const verdict = evaluateSnapshot(
    snapshot({
      statusFiles: [
        { status: " M", path: "docs/private/siss-live-inspections/live-map.md" },
        { status: "??", path: "exports/patient.pdf" },
        { status: "??", path: "certs/local-api.key" },
        { status: "??", path: "Farmaci/catalogo.xlsx" },
      ],
    }),
    { expectedIssue: "WUL-283" }
  );

  assert.equal(verdict.decision.status, "blocked");
  assert.ok(verdict.decision.flags.includes("sensitive_paths_changed"));
  assert.equal(verdict.changeSummary.sensitiveCount, 4);
  assert.ok(verdict.changeSummary.paths.every((item) => item.startsWith("[redacted:")));
});

test("carries expected issue into LaunchAgent runs when configured", () => {
  const options = parseArgs([
    "install-launch-agent",
    "--repo",
    "/tmp/mediflow",
    "--state-dir",
    "/tmp/mediflow-monitor",
    "--expected-issue",
    "WUL-283",
  ]);
  const plist = buildLaunchAgentPlist(options);

  assert.match(plist, /<string>--expected-issue<\/string>/);
  assert.match(plist, /<string>WUL-283<\/string>/);
});

test("can build LaunchAgent runs from a stable global runner path", () => {
  const options = parseArgs([
    "install-launch-agent",
    "--repo",
    "/tmp/mediflow",
    "--state-dir",
    "/tmp/mediflow-monitor",
    "--runner-path",
    "/tmp/mediflow-monitor/bin/codex-workflow-monitor.mjs",
  ]);
  const plist = buildLaunchAgentPlist(options);

  assert.equal(globalRunnerPath("/tmp/mediflow-monitor"), "/tmp/mediflow-monitor/bin/codex-workflow-monitor.mjs");
  assert.match(plist, /<string>\/tmp\/mediflow-monitor\/bin\/codex-workflow-monitor\.mjs<\/string>/);
});

test("asks for verification when tooling changes without declared checks", () => {
  const verdict = evaluateSnapshot(
    snapshot({
      mainDiffFiles: ["scripts/codex-workflow-monitor.mjs", "package.json"],
    }),
    { expectedIssue: "WUL-283" }
  );

  assert.equal(verdict.decision.status, "needs_codex");
  assert.equal(verdict.decision.severity, "medium");
  assert.ok(verdict.decision.flags.includes("tests_not_declared"));
});

test("accepts declared passing checks for tooling changes", () => {
  const verdict = evaluateSnapshot(
    snapshot({
      mainDiffFiles: ["scripts/codex-workflow-monitor.mjs", "scripts/codex-workflow-monitor.test.mjs"],
    }),
    {
      expectedIssue: "WUL-283",
      checks: {
        "test:workflow-monitor": "pass",
      },
    }
  );

  assert.equal(verdict.decision.status, "continue");
  assert.equal(verdict.decision.severity, "low");
});

test("reuses previous checks only for the same clean change signature", () => {
  const cleanVerdict = evaluateSnapshot(
    snapshot({
      headRef: "commit-a",
      mainDiffFiles: ["scripts/codex-workflow-monitor.mjs"],
    }),
    {}
  );
  const previous = {
    ...cleanVerdict,
    checks: {
      "test:workflow-monitor": "pass",
    },
  };

  assert.deepEqual(resolveEffectiveChecks(cleanVerdict, {}, previous), {
    "test:workflow-monitor": "pass",
  });

  const dirtyVerdict = evaluateSnapshot(
    snapshot({
      headRef: "commit-a",
      statusFiles: [{ status: " M", path: "scripts/codex-workflow-monitor.mjs" }],
      mainDiffFiles: ["scripts/codex-workflow-monitor.mjs"],
    }),
    {}
  );
  assert.deepEqual(resolveEffectiveChecks(dirtyVerdict, {}, previous), {});
});

test("parses check persistence flags and the clear-checks command", () => {
  const options = parseArgs(["--once", "--check", "prepare-oss=pass", "--persist-checks"]);
  assert.equal(options.persistChecks, true);
  assert.equal(options.usePersistedChecks, true);

  const optOut = parseArgs(["--once", "--no-persisted-checks"]);
  assert.equal(optOut.persistChecks, false);
  assert.equal(optOut.usePersistedChecks, false);

  const clear = parseArgs(["clear-checks", "--repo", "/tmp/mediflow"]);
  assert.equal(clear.command, "clear-checks");
  assert.equal(clear.repo, "/tmp/mediflow");
});

test("applies persisted declarations only for a clean tree on the declared branch and HEAD", () => {
  const cleanVerdict = evaluateSnapshot(
    snapshot({ headRef: "commit-a", mainDiffFiles: ["scripts/codex-workflow-monitor.mjs"] }),
    {}
  );
  const declaration = {
    branch: "codex/wul-283-local-workflow-monitor",
    headRef: "commit-a",
    declaredAt: "2026-07-03T10:00:00.000Z",
    checks: { "prepare-oss": "pass" },
  };

  const persisted = resolveChecksWithProvenance(cleanVerdict, {}, null, declaration);
  assert.equal(persisted.source, "persisted");
  assert.equal(persisted.declaredAt, "2026-07-03T10:00:00.000Z");
  assert.deepEqual(persisted.checks, { "prepare-oss": "pass" });

  const cli = resolveChecksWithProvenance(cleanVerdict, { lint: "pass" }, null, declaration);
  assert.equal(cli.source, "cli");
  assert.deepEqual(cli.checks, { lint: "pass" });

  const staleHead = resolveChecksWithProvenance(cleanVerdict, {}, null, { ...declaration, headRef: "commit-b" });
  assert.equal(staleHead.source, "none");
  assert.deepEqual(staleHead.checks, {});

  const otherBranch = resolveChecksWithProvenance(cleanVerdict, {}, null, {
    ...declaration,
    branch: "codex/wul-999-other",
  });
  assert.equal(otherBranch.source, "none");

  const dirtyVerdict = evaluateSnapshot(
    snapshot({
      headRef: "commit-a",
      statusFiles: [{ status: " M", path: "scripts/codex-workflow-monitor.mjs" }],
      mainDiffFiles: ["scripts/codex-workflow-monitor.mjs"],
    }),
    {}
  );
  const dirty = resolveChecksWithProvenance(dirtyVerdict, {}, null, declaration);
  assert.equal(dirty.source, "none");
});

test("labels previous-snapshot reuse and keeps resolveEffectiveChecks compatible", () => {
  const cleanVerdict = evaluateSnapshot(
    snapshot({ headRef: "commit-a", mainDiffFiles: ["scripts/codex-workflow-monitor.mjs"] }),
    {}
  );
  const previous = { ...cleanVerdict, checks: { "test:workflow-monitor": "pass" } };

  const reused = resolveChecksWithProvenance(cleanVerdict, {}, previous, null);
  assert.equal(reused.source, "previous-snapshot");
  assert.deepEqual(reused.checks, { "test:workflow-monitor": "pass" });
  assert.deepEqual(resolveEffectiveChecks(cleanVerdict, {}, previous), reused.checks);
});

test("sanitizes persisted check payloads to valid name=status pairs", () => {
  assert.deepEqual(sanitizePersistedChecks(null), {});
  assert.deepEqual(sanitizePersistedChecks(["pass"]), {});
  assert.deepEqual(
    sanitizePersistedChecks({ "prepare-oss": "PASS", lint: "maybe", "  ": "pass", deploy: "skip" }),
    { "prepare-oss": "pass", deploy: "skip" }
  );
});

test("selects persisted declarations only for matching branch, HEAD and version", () => {
  const snap = snapshot({ headRef: "commit-a" });
  const fileData = {
    version: 1,
    declarations: {
      [snap.branch]: {
        headRef: "commit-a",
        declaredAt: "2026-07-03T10:00:00.000Z",
        checks: { "prepare-oss": "pass", bogus: "maybe" },
      },
    },
  };

  const entry = selectPersistedDeclaration(fileData, snap);
  assert.equal(entry.branch, snap.branch);
  assert.equal(entry.headRef, "commit-a");
  assert.deepEqual(entry.checks, { "prepare-oss": "pass" });

  assert.equal(selectPersistedDeclaration(fileData, snapshot({ headRef: "commit-b" })), null);
  assert.equal(
    selectPersistedDeclaration(fileData, snapshot({ branch: "codex/wul-999-other", headRef: "commit-a" })),
    null
  );
  assert.equal(selectPersistedDeclaration({ version: 99, declarations: {} }, snap), null);
  assert.equal(selectPersistedDeclaration(null, snap), null);
});

test("upserts and removes per-branch declarations without touching other branches", () => {
  const first = upsertPersistedDeclaration(null, {
    branch: "codex/wul-100-a",
    headRef: "commit-a",
    declaredAt: "2026-07-03T10:00:00.000Z",
    checks: { lint: "pass" },
  });
  const second = upsertPersistedDeclaration(first, {
    branch: "codex/wul-200-b",
    headRef: "commit-b",
    declaredAt: "2026-07-03T11:00:00.000Z",
    checks: { "prepare-oss": "pass" },
  });

  assert.deepEqual(Object.keys(second.declarations).sort(), ["codex/wul-100-a", "codex/wul-200-b"]);

  const { data, removed } = removePersistedDeclaration(second, "codex/wul-100-a");
  assert.equal(removed, true);
  assert.deepEqual(Object.keys(data.declarations), ["codex/wul-200-b"]);

  const missing = removePersistedDeclaration(data, "codex/wul-100-a");
  assert.equal(missing.removed, false);
});

test("persists CLI declarations to the sidecar only from a clean tree", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mediflow-monitor-sidecar-"));
  try {
    const snap = snapshot({ root: repoRoot, toplevel: repoRoot, headRef: "commit-a" });

    assert.deepEqual(persistDeclaredChecks(snap, {}), { status: "skipped", reason: "no-cli-checks" });
    assert.deepEqual(
      persistDeclaredChecks({ ...snap, statusFiles: [{ status: " M", path: "scripts/x.mjs" }] }, { lint: "pass" }),
      { status: "skipped", reason: "dirty-tree" }
    );
    assert.deepEqual(
      persistDeclaredChecks({ ...snap, branch: "main", onMain: true }, { lint: "pass" }),
      { status: "skipped", reason: "on-main" }
    );

    const written = persistDeclaredChecks(snap, { "prepare-oss": "pass" });
    assert.equal(written.status, "written");
    assert.equal(written.path, checksSidecarPath(repoRoot));

    const entry = selectPersistedDeclaration(readChecksSidecar(repoRoot), snap);
    assert.deepEqual(entry.checks, { "prepare-oss": "pass" });
    assert.equal(fs.readFileSync(path.join(repoRoot, ".codex", ".gitignore"), "utf8").trim(), "*");
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("treats missing, corrupted or oversized sidecar files as absent", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mediflow-monitor-guards-"));
  try {
    assert.equal(readChecksSidecar(repoRoot), null);

    fs.mkdirSync(path.join(repoRoot, ".codex"), { recursive: true });
    fs.writeFileSync(checksSidecarPath(repoRoot), "{ not json");
    assert.equal(readChecksSidecar(repoRoot), null);

    fs.writeFileSync(checksSidecarPath(repoRoot), `{"version":1,"padding":"${"x".repeat(70 * 1024)}"}`);
    assert.equal(readChecksSidecar(repoRoot), null);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

function runGitIn(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "monitor-test",
      GIT_AUTHOR_EMAIL: "monitor-test@example.com",
      GIT_COMMITTER_NAME: "monitor-test",
      GIT_COMMITTER_EMAIL: "monitor-test@example.com",
    },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function runMonitorCli(repoRoot, stateDir, extraArgs = []) {
  const scriptPath = fileURLToPath(new URL("./codex-workflow-monitor.mjs", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [scriptPath, "once", "--repo", repoRoot, "--state-dir", stateDir, "--json", "--model-mode", "off", ...extraArgs],
    {
      encoding: "utf8",
      env: { ...process.env, MEDIFLOW_WORKFLOW_MONITOR_EXPECTED_ISSUE: "" },
    }
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("scheduled runs reuse persisted declarations until a new commit lands", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mediflow-monitor-e2e-"));
  const repoRoot = path.join(base, "repo");
  const stateDir = path.join(base, "state");
  const scriptPath = fileURLToPath(new URL("./codex-workflow-monitor.mjs", import.meta.url));
  try {
    fs.mkdirSync(repoRoot, { recursive: true });
    runGitIn(repoRoot, ["init", "-q", "-b", "main"]);
    fs.writeFileSync(path.join(repoRoot, ".gitignore"), ".codex/\n");
    fs.writeFileSync(path.join(repoRoot, "README.md"), "base\n");
    runGitIn(repoRoot, ["add", "-A"]);
    runGitIn(repoRoot, ["commit", "-q", "-m", "base"]);
    runGitIn(repoRoot, ["checkout", "-q", "-b", "codex/wul-999-persisted-checks"]);
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "scripts", "example.mjs"), "export const value = 1;\n");
    runGitIn(repoRoot, ["add", "-A"]);
    runGitIn(repoRoot, ["commit", "-q", "-m", "tooling change"]);

    const undeclared = runMonitorCli(repoRoot, stateDir);
    assert.equal(undeclared.decision.status, "needs_codex");
    assert.ok(undeclared.decision.flags.includes("tests_not_declared"));
    assert.equal(undeclared.checksSource, "none");

    const declared = runMonitorCli(repoRoot, stateDir, ["--check", "prepare-oss=pass", "--persist-checks"]);
    assert.equal(declared.decision.status, "continue");
    assert.equal(declared.checksSource, "cli");
    assert.equal(declared.checksPersistence.status, "written");

    const scheduled = runMonitorCli(repoRoot, stateDir);
    assert.equal(scheduled.decision.status, "continue");
    assert.equal(scheduled.checksSource, "persisted");
    assert.deepEqual(scheduled.checks, { "prepare-oss": "pass" });
    assert.equal(scheduled.persistedChecks.headRef, scheduled.repo.headRef);

    const optedOut = runMonitorCli(repoRoot, stateDir, ["--no-persisted-checks"]);
    assert.equal(optedOut.decision.status, "needs_codex");
    assert.equal(optedOut.checksSource, "none");

    fs.appendFileSync(path.join(repoRoot, "scripts", "example.mjs"), "export const more = 2;\n");
    const dirty = runMonitorCli(repoRoot, stateDir);
    assert.equal(dirty.decision.status, "needs_codex");
    assert.equal(dirty.checksSource, "none");

    runGitIn(repoRoot, ["add", "-A"]);
    runGitIn(repoRoot, ["commit", "-q", "-m", "second tooling change"]);
    const expired = runMonitorCli(repoRoot, stateDir);
    assert.equal(expired.decision.status, "needs_codex");
    assert.equal(expired.checksSource, "none");

    const redeclared = runMonitorCli(repoRoot, stateDir, ["--check", "prepare-oss=pass", "--persist-checks"]);
    assert.equal(redeclared.checksPersistence.status, "written");
    const clearResult = spawnSync(
      process.execPath,
      [scriptPath, "clear-checks", "--repo", repoRoot],
      { encoding: "utf8" }
    );
    assert.equal(clearResult.status, 0, clearResult.stderr);
    assert.equal(JSON.parse(clearResult.stdout).removed, true);

    const cleared = runMonitorCli(repoRoot, stateDir);
    assert.equal(cleared.decision.status, "needs_codex");
    assert.equal(cleared.checksSource, "none");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
