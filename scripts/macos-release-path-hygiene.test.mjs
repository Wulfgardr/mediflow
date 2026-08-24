/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = path.resolve('scripts/macos-release-path-hygiene.mjs');
const server = "require('node:http').createServer((_, r) => r.end('ok')).listen(process.env.PORT, process.env.HOSTNAME);\n";

function fixture(payload = server) {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-path-hygiene-'));
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(app, 'Contents', 'Resources', 'WebRuntime'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'MediFlow'), 'synthetic executable');
  fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'WebRuntime', 'server.js'), payload);
  return app;
}

function run(args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

test('accepts a neutral source root', () => {
  const result = run(['--source-root', '/private/tmp/mediflow-source', '--check-source']);
  assert.equal(result.status, 0, result.stderr);
});

for (const sourceRoot of ['/Users/example/repo', os.homedir(), '/private/tmp/.codex/worktrees/repo']) {
  test(`fails closed for personal or Codex source root ${sourceRoot}`, () => {
    const result = run(['--source-root', sourceRoot, '--check-source']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsafe source root/);
  });
}

test('fails closed when shipped payload retains a personal marker', () => {
  const app = fixture(`${server}// ${os.homedir()}/repo\n`);
  try {
    const result = run(['--app', app, '--check']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /forbidden marker/);
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});

test('fails closed when shipped payload retains a known secret marker', () => {
  const app = fixture(`${server}// ghp_1234567890123456789012345678901234567890\n`);
  try {
    const result = run(['--app', app, '--check']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /GitHub token/);
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});

test('allows neutral build-root strings in the shipped payload', () => {
  const app = fixture(`${server}// /private/tmp/mediflow-source\n`);
  try {
    const result = run(['--app', app, '--check']);
    assert.equal(result.status, 0, result.stderr);
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});

test('fails closed when strip fails', () => {
  const app = fixture();
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-fake-strip-'));
  try {
    fs.writeFileSync(path.join(bin, 'strip'), '#!/bin/sh\nexit 7\n', { mode: 0o755 });
    const result = run(['--app', app, '--strip'], { PATH: `${bin}:${process.env.PATH}` });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /strip failed/);
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('smokes copied WebRuntime on loopback only', () => {
  const app = fixture();
  try {
    const result = run(['--app', app, '--smoke']);
    assert.equal(result.status, 0, result.stderr);
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});

test('fails closed for unexpected input', () => {
  const result = run(['--unexpected']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage:/);
});
