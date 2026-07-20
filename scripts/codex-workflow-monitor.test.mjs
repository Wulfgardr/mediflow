#!/usr/bin/env node
/* @Codex */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./codex-workflow-monitor.mjs', import.meta.url));

test('persists metadata-only checks for the exact clean branch and SHA', (t) => {
  const fixture = createFixture(t);

  const undeclared = runMonitor(fixture);
  assert.match(undeclared.stdout, /Decision: needs_codex \(medium\)/);
  assert.match(undeclared.stdout, /changed=1/);

  const declared = runMonitor(fixture, '--check=focused=pass', '--persist-checks');
  assert.equal(declared.status, 0, declared.stderr);
  assert.match(declared.stdout, /Decision: continue \(low\)/);
  assert.match(declared.stdout, /source=cli/);

  const scheduled = runMonitor(fixture);
  assert.match(scheduled.stdout, /source=sidecar/);
  assert.match(scheduled.stdout, /Decision: continue \(low\)/);

  const state = fs.readFileSync(path.join(fixture.stateDir, 'checks.json'), 'utf8');
  assert.doesNotMatch(state, /feature\.txt|fixture/);
  assert.match(state, /"branch": "codex\/test"/);
  assert.match(state, /"headSha": "[a-f0-9]{40}"/);

  fs.writeFileSync(path.join(fixture.repo, 'feature.txt'), 'second\n');
  git(fixture.repo, ['add', 'feature.txt']);
  git(fixture.repo, ['commit', '-m', 'second change']);
  const expired = runMonitor(fixture);
  assert.match(expired.stdout, /source=none/);
  assert.match(expired.stdout, /Decision: needs_codex \(medium\)/);

  runMonitor(fixture, '--check=focused=pass', '--persist-checks');
  runMonitor(fixture, 'clear-checks');
  assert.match(runMonitor(fixture).stdout, /source=none/);
});

test('rejects dirty persistence and withholds protected path names', (t) => {
  const fixture = createFixture(t);
  fs.writeFileSync(path.join(fixture.repo, 'dirty.txt'), 'dirty\n');

  const persist = runMonitor(fixture, '--check=focused=pass', '--persist-checks');
  assert.equal(persist.status, 1);
  assert.match(persist.stderr, /dirty worktree/);

  git(fixture.repo, ['checkout', 'main']);
  fs.writeFileSync(path.join(fixture.repo, 'medical.db'), 'synthetic marker only\n');
  git(fixture.repo, ['add', 'medical.db']);
  git(fixture.repo, ['commit', '-m', 'protected path']);
  git(fixture.repo, ['checkout', '-b', 'codex/protected']);
  fs.writeFileSync(path.join(fixture.repo, 'medical.db'), 'synthetic marker changed\n');
  git(fixture.repo, ['commit', '-am', 'protected delta']);
  const protectedResult = runMonitor(fixture);
  assert.match(protectedResult.stdout, /Decision: blocked \(high\)/);
  assert.doesNotMatch(protectedResult.stdout, /medical\.db/);
});

test('reports a clean main that is behind origin/main metadata', (t) => {
  const fixture = createFixture(t);
  git(fixture.repo, ['checkout', 'main']);
  git(fixture.repo, ['checkout', '-b', 'upstream']);
  fs.writeFileSync(path.join(fixture.repo, 'upstream.txt'), 'upstream\n');
  git(fixture.repo, ['add', 'upstream.txt']);
  git(fixture.repo, ['commit', '-m', 'upstream']);
  git(fixture.repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(fixture.repo, ['checkout', 'main']);

  const result = runMonitor(fixture);
  assert.match(result.stdout, /ahead=0 behind=1/);
  assert.match(result.stdout, /Decision: needs_codex \(medium\)/);
});

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-monitor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Synthetic Test']);
  git(repo, ['config', 'user.email', 'synthetic@example.invalid']);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  git(repo, ['add', 'base.txt']);
  git(repo, ['commit', '-m', 'base']);
  git(repo, ['branch', '-M', 'main']);
  git(repo, ['update-ref', 'refs/remotes/origin/main', 'main']);
  git(repo, ['checkout', '-b', 'codex/test']);
  fs.writeFileSync(path.join(repo, 'feature.txt'), 'first\n');
  git(repo, ['add', 'feature.txt']);
  git(repo, ['commit', '-m', 'feature']);
  return { repo, stateDir };
}

function runMonitor(fixture, ...args) {
  return spawnSync(process.execPath, [script, `--state-dir=${fixture.stateDir}`, ...args], {
    cwd: fixture.repo,
    encoding: 'utf8',
  });
}

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}
