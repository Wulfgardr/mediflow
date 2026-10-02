import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout } from 'node:timers/promises';
import test from 'node:test';
import { waitForNextDevTelemetry } from './wait-next-dev-telemetry.mjs';

const require = createRequire(import.meta.url);
const helper = path.join(import.meta.dirname, 'wait-next-dev-telemetry.mjs');

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-next-teardown-')));
  const dist = path.join(root, '.next-network-smoke', 'dev');
  fs.mkdirSync(dist, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, dist };
}

test('empty or absent telemetry queue completes without touching unrelated files', async (t) => {
  const { dist } = fixture(t);
  const unrelated = path.join(dist, 'retain.json');
  fs.writeFileSync(unrelated, 'owned unrelated fixture');
  await waitForNextDevTelemetry(dist);
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'owned unrelated fixture');
  await waitForNextDevTelemetry(path.join(dist, 'absent'));
});

for (const telemetryDisabled of [false, true]) {
  test(`pinned Next detached flush completes before deletion (disabled=${telemetryDisabled})`, async (t) => {
    const { root, dist } = fixture(t);
    fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
    fs.writeFileSync(path.join(root, 'next.config.mjs'), "export default { distDir: '.next-network-smoke', agentRules: false };\n");
    const preload = path.join(root, 'owned-gate.cjs');
    const release = path.join(root, 'release');
    const gate = path.join(root, 'gate');
    fs.writeFileSync(preload, `
      const fs = require('node:fs');
      globalThis.fetch = () => { throw new Error('Outbound fetch forbidden in synthetic fixture'); };
      if (process.argv[1]?.endsWith('/telemetry/detached-flush.js')) {
        const read = fs.readFileSync;
        fs.readFileSync = function(file, ...args) {
          const value = read.call(this, file, ...args);
          if (String(file).includes('/dev/_events_')) {
            fs.writeFileSync(${JSON.stringify(gate)}, 'events read');
            const deadline = Date.now() + 4000;
            while (!fs.existsSync(${JSON.stringify(release)}) && Date.now() < deadline) {
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
            }
          }
          return value;
        };
      }
    `);
    const environment = { ...process.env, CI: '1', NODE_OPTIONS: `--require=${preload}` };
    if (telemetryDisabled) environment.NEXT_TELEMETRY_DISABLED = '1';
    else delete environment.NEXT_TELEMETRY_DISABLED;
    delete environment.NEXT_TELEMETRY_DEBUG;
    const producer = spawnSync(process.execPath, ['--eval', `
      const { Telemetry } = require(${JSON.stringify(require.resolve('next/dist/telemetry/storage'))});
      const telemetry = new Telemetry({distDir: ${JSON.stringify(dist)}});
      telemetry.record({eventName: 'OWNED_SYNTHETIC_TEARDOWN', payload: {}}, true);
      telemetry.flushDetached('dev', ${JSON.stringify(root)});
      process.exit(0);
    `], { env: environment, encoding: 'utf8', timeout: 5000 });
    assert.equal(producer.status, 0, producer.stderr);
    assert.equal(fs.readdirSync(dist).filter((name) => /^_events_\d+\.json$/.test(name)).length, 1);
    let completed = false;
    const waiting = waitForNextDevTelemetry(dist, { timeoutMs: 5000 }).then(() => { completed = true; });
    try {
      const deadline = performance.now() + 3000;
      while (!fs.existsSync(gate) && performance.now() < deadline) await setTimeout(10);
      assert.ok(fs.existsSync(gate), 'actual pinned detached worker must reach the write boundary');
      // Model rm traversing the cache while the worker has read its receipt.
      fs.rmSync(path.join(dist, 'cache'), { recursive: true, force: true });
      await setTimeout(30);
      assert.equal(completed, false, 'wait must not follow the already-exited producer');
    } finally {
      fs.writeFileSync(release, 'release owned worker');
      await waiting;
    }
    assert.ok(fs.existsSync(path.join(dist, 'cache')), 'the real detached worker recreated cache before completion');
    fs.rmSync(root, { recursive: true });
    await setTimeout(30);
    assert.equal(fs.existsSync(root), false, 'one removal after completion must stay removed');
  });
}

test('completion waits for every receipt from the exited launcher and server', async (t) => {
  const { dist } = fixture(t);
  const first = path.join(dist, '_events_123.json');
  const second = path.join(dist, '_events_456.json');
  fs.writeFileSync(first, 'first worker');
  fs.writeFileSync(second, 'second worker');
  let completed = false;
  const waiting = waitForNextDevTelemetry(dist, { timeoutMs: 1000, pollMs: 5 }).then(() => { completed = true; });
  try {
    await setTimeout(15);
    fs.unlinkSync(first);
    await setTimeout(15);
    assert.equal(completed, false);
  } finally {
    fs.unlinkSync(second);
    await waiting;
  }
});

test('stalled worker times out and retains its receipt and workspace', async (t) => {
  const { dist } = fixture(t);
  const receipt = path.join(dist, '_events_123.json');
  fs.writeFileSync(receipt, 'owned stalled-worker receipt');
  await assert.rejects(waitForNextDevTelemetry(dist, { timeoutMs: 30, pollMs: 5 }), /did not complete.*workspace retained/);
  assert.equal(fs.readFileSync(receipt, 'utf8'), 'owned stalled-worker receipt');
});

test('new shutdown receipt or unexpected entry fails without removal', async (t) => {
  const { dist } = fixture(t);
  fs.writeFileSync(path.join(dist, '_events_123.json'), 'initial');
  const waiting = waitForNextDevTelemetry(dist, { timeoutMs: 1000, pollMs: 10 });
  await setTimeout(25);
  fs.writeFileSync(path.join(dist, '_events_456.json'), 'late');
  await assert.rejects(waiting, /appeared after launcher shutdown/);
  assert.equal(fs.existsSync(path.join(dist, '_events_123.json')), true);
  fs.mkdirSync(path.join(dist, '_events_789.json'));
  await assert.rejects(waitForNextDevTelemetry(dist), /Unexpected Next telemetry entry/);
});

test('EXIT cleanup preserves test failure and stops before removal if the wait fails', async (t) => {
  const { root, dist } = fixture(t);
  const completed = spawnSync('bash', ['-c', 'set -euo pipefail; cleanup() { "$1" "$2" "$3"; rm -rf "$4"; }; trap \'cleanup "$node" "$helper" "$dist" "$root"\' EXIT; exit 7'], {
    env: { ...process.env, node: process.execPath, helper, dist, root }, encoding: 'utf8', timeout: 2000,
  });
  assert.equal(completed.status, 7, completed.stderr);
  assert.equal(fs.existsSync(root), false);
  fs.mkdirSync(dist, { recursive: true });
  fs.mkdirSync(path.join(dist, '_events_789.json'));
  const failed = spawnSync('bash', ['-c', 'set -euo pipefail; cleanup() { "$1" "$2" "$3"; rm -rf "$4"; }; trap \'cleanup "$node" "$helper" "$dist" "$root"\' EXIT; exit 7'], {
    env: { ...process.env, node: process.execPath, helper, dist, root }, encoding: 'utf8', timeout: 2000,
  });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /Unexpected Next telemetry entry/);
  assert.equal(fs.existsSync(root), true);
});
