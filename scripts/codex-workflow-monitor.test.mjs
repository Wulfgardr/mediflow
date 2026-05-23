/* @Codex */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLaunchAgentPlist,
  evaluateSnapshot,
  globalRunnerPath,
  parseArgs,
  parsePorcelainStatus,
  resolveEffectiveChecks,
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
