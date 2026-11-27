import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkSeatbeltProfiles, inspectSeatbeltSource } from './check-seatbelt-profiles.mjs';
import { SEATBELT_PROFILE_MODULE, pythonExecutablesForSandbox, seatbeltProfile } from './seatbelt-profile.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('repository passes the Seatbelt profile guard', () => {
  const result = checkSeatbeltProfiles(ROOT_DIR);
  assert.deepEqual(result.findings, []);
  assert.ok(result.profileFiles >= 7);
});

test('rejects a new Seatbelt profile or sandbox-exec call that leaves program launch open', () => {
  const rawSandboxExec = "spawn('/usr/bin/sandbox-exec', ['-p', '(version 1) (allow default) (deny network*)', bin]);";
  assert.equal(inspectSeatbeltSource('lib/new-worker.ts', rawSandboxExec).length, 1);

  const missingLsopen = "const p = '(version 1) (allow default) (deny network*) (deny process-exec) (deny appleevent-send)';";
  assert.equal(inspectSeatbeltSource('lib/new-worker.ts', missingLsopen).length, 1);

  const missingAppleEvents = "const p = '(version 1) (allow default) (deny network*) (deny process-exec) (deny lsopen)';";
  assert.equal(inspectSeatbeltSource('lib/new-worker.ts', missingAppleEvents).length, 1);

  const missingProcessExec = "const p = '(version 1) (allow default) (deny network*) (deny lsopen) (deny appleevent-send)';";
  assert.equal(inspectSeatbeltSource('lib/new-worker.ts', missingProcessExec).length, 1);

  const permissiveSb = '(version 1)\n(allow default)\n(deny network*)\n';
  assert.equal(inspectSeatbeltSource('scripts/new.sb', permissiveSb).length, 1);
});

test('rejects deny-default profiles that allow lsopen, appleevent-send, or unrestricted process-exec', () => {
  for (const extra of ['(allow lsopen)', '(allow appleevent-send)', '(allow process-exec)', '(allow process-exec*)']) {
    const profile = `(version 1)\n(deny default)\n${extra}\n`;
    assert.equal(inspectSeatbeltSource('lib/custom-sandbox.ts', profile).length, 1, extra);
  }
});

test('rejects weakening the canonical helper or modifying local-voice-service without closing the escape', () => {
  const brokenHelper = 'export function seatbeltProfile() { return "(version 1) (allow default) (deny network*)"; }';
  assert.equal(inspectSeatbeltSource(SEATBELT_PROFILE_MODULE, brokenHelper).length, 1);

  const weakenedVoice = "export const LOCAL_VOICE_SANDBOX_PROFILE = '(version 1) (allow default) (deny network*) (deny file-write*)';";
  assert.equal(inspectSeatbeltSource('scripts/local-voice-service.mjs', weakenedVoice).length, 1);
});

test('accepts seatbeltProfile callers, deny-default profiles, and explicit closed profiles', () => {
  const helperCaller = "import { seatbeltProfile } from './seatbelt-profile.mjs';\nexport const p = seatbeltProfile({ rules: '(deny network*)', programs: ['/usr/bin/true'] });";
  assert.deepEqual(inspectSeatbeltSource('scripts/safe-worker.mjs', helperCaller), []);

  const denyDefault = '(version 1)\n(deny default)\n(allow process-exec (literal "/usr/bin/true"))\n';
  assert.deepEqual(inspectSeatbeltSource('scripts/safe.sb', denyDefault), []);

  const closedVoice = "export function localVoiceSandboxProfile(e) { return '(version 1) (allow default) (deny network*) (deny process-exec) (allow process-exec (literal \"/x\")) (deny lsopen) (deny appleevent-send)'; }";
  assert.deepEqual(inspectSeatbeltSource('scripts/local-voice-service.mjs', closedVoice), []);
});

test('seatbeltProfile rejects rules that override denials and rejects broad exec subpaths', () => {
  assert.throws(() => seatbeltProfile({ rules: '(allow lsopen)', programs: ['/usr/bin/true'] }), /seatbelt-rules/u);
  assert.throws(() => seatbeltProfile({ rules: '(allow process-exec)', programs: ['/usr/bin/true'] }), /seatbelt-rules/u);
  assert.throws(() => seatbeltProfile({ rules: '(deny network*)', programs: [] }), /seatbelt-programs/u);
  assert.throws(() => seatbeltProfile({ rules: '(deny network*)', programs: ['relative/bin'] }), /seatbelt-program-path/u);
  assert.throws(() => seatbeltProfile({ rules: '(deny network*)', programs: ['/usr/bin/xcrun'], programSubpaths: ['/usr/bin'] }), /seatbelt-broad-exec-subpath/u);
});

test('detects an unguarded .sb file added to a synthetic repository root', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-seatbelt-guard-'));
  try {
    fs.mkdirSync(path.join(directory, 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(ROOT_DIR, SEATBELT_PROFILE_MODULE), path.join(directory, SEATBELT_PROFILE_MODULE));
    assert.deepEqual(checkSeatbeltProfiles(directory).findings, []);
    fs.writeFileSync(path.join(directory, 'scripts', 'leaking.sb'), '(version 1)\n(allow default)\n(deny network*)\n');
    const result = checkSeatbeltProfiles(directory);
    assert.equal(result.findings.length, 1);
    assert.match(result.findings[0], /scripts\/leaking\.sb/u);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('pythonExecutablesForSandbox resolves pip sh-wrapped entry points with spaces and quotes', () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-py-shebang-')));
  try {
    const quotedDir = path.join(directory, "Application Support 'synthetic'");
    fs.mkdirSync(quotedDir, { recursive: true });
    const target = path.join(quotedDir, 'python-target');
    fs.writeFileSync(target, 'synthetic', { mode: 0o755 });
    const entry = path.join(quotedDir, 'pip');
    const shellAlias = path.join(directory, 'sh');
    fs.symlinkSync('/bin/sh', shellAlias);
    const escaped = target.replaceAll("'", "'\\''");
    for (const shell of ['/bin/sh', shellAlias]) {
      fs.writeFileSync(entry, `#!${shell}\n'''exec' '${escaped}' "$0" "$@"\n`, { mode: 0o755 });
      const resolved = pythonExecutablesForSandbox(entry);
      assert.deepEqual(resolved.toSorted(), [entry, fs.realpathSync(shell), target].toSorted());
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
