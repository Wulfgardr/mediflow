/* @Codex */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLaunchAgentPlist,
  buildPlan,
  isLoopDue,
  loadConfig,
  readStatus,
  runScheduledOnce,
  validateConfig
} from './loop-orchestrator.mjs';

test('baseline loop orchestrator config validates', () => {
  const config = loadConfig();
  assert.deepEqual(validateConfig(config), []);
});

test('baseline contains required cadences', () => {
  const config = loadConfig();
  const byId = new Map(config.loops.map((loop) => [loop.id, loop]));

  assert.equal(byId.get('maintainer').cadence.frequency, 'daily');
  assert.equal(byId.get('forward-thinker').cadence.frequency, 'weekly');
  assert.equal(byId.get('loop-auditor').cadence.frequency, 'weekly');
  assert.equal(byId.get('loop-gardener').cadence.frequency, 'weekly');
  assert.equal(byId.get('risk-compliance').cadence.frequency, 'fortnightly');
});

test('guarded automerge keeps clinical hard stops explicit', () => {
  const config = loadConfig();
  const hardStops = config.guardedAutomerge.hardStopPaths.join('\n');

  assert.equal(config.guardedAutomerge.enabled, true);
  assert.ok(config.guardedAutomerge.requires.includes('No PHI/PII used'));
  assert.match(hardStops, /PIN/);
  assert.match(hardStops, /SISS\/FSE/);
  assert.match(hardStops, /real patient data/);
});

test('duplicate loop ids are rejected', () => {
  const config = loadConfig();
  const duplicate = {
    ...config,
    loops: [...config.loops, { ...config.loops[0] }]
  };

  assert.match(validateConfig(duplicate).join('\n'), /duplicate loop id: orchestrator/);
});

test('plan output is redacted operational metadata', () => {
  const config = loadConfig();
  const plan = buildPlan(config);

  assert.match(plan, /maintainer/);
  assert.match(plan, /forward-thinker/);
  assert.doesNotMatch(plan, /medical\.db/);
  assert.doesNotMatch(plan, /patient_id/i);
});

test('due calculation runs maintainer daily after local target time', () => {
  const config = loadConfig();
  const maintainer = config.loops.find((loop) => loop.id === 'maintainer');
  const now = new Date('2026-06-18T02:00:00.000Z');

  assert.equal(isLoopDue(maintainer, { loops: {} }, now), true);
  assert.equal(isLoopDue(maintainer, { loops: { maintainer: { lastRunAt: '2026-06-18T01:40:00.000Z' } } }, now), false);
});

test('LaunchAgent plist points to run-once and stable state paths', () => {
  const plist = buildLaunchAgentPlist({
    repo: '/tmp/mediflow',
    stateDir: '/tmp/mediflow-loop-state',
    configPath: '/tmp/mediflow/docs/loop-orchestrator.config.json',
    launchIntervalSeconds: 900,
    runnerPath: '/tmp/mediflow-loop-state/bin/loop-orchestrator.mjs'
  });

  assert.match(plist, /com\.mediflow\.loop-orchestrator/);
  assert.match(plist, /<string>run-once<\/string>/);
  assert.match(plist, /<string>--attention-exit-zero<\/string>/);
  assert.match(plist, /<integer>900<\/integer>/);
  assert.match(plist, /launchd\.out\.log/);
});

test('forced scheduled run writes local state and digest without clinical data', () => {
  const config = {
    ...loadConfig(),
    loops: loadConfig().loops.map((loop) => ({ ...loop, checks: [] }))
  };
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-loop-orchestrator-test-'));
  const summary = runScheduledOnce(config, {
    repo: process.cwd(),
    stateDir,
    force: true
  });
  const status = readStatus(stateDir);

  assert.equal(summary.status, 'ok');
  assert.ok(summary.dueLoops.includes('orchestrator'));
  assert.ok(summary.dueLoops.includes('maintainer'));
  assert.equal(status.latestDigestExists, true);
  const digest = fs.readFileSync(status.latestDigestPath, 'utf8');
  assert.match(digest, /no PHI\/PII/);
  assert.doesNotMatch(digest, /medical\.db/);
});

test('copied runner executes from paths with spaces', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow loop runner test '));
  const copiedRunner = path.join(stateDir, 'loop orchestrator copy.mjs');
  fs.copyFileSync(path.join(process.cwd(), 'scripts/loop-orchestrator.mjs'), copiedRunner);

  const result = spawnSync(process.execPath, [
    copiedRunner,
    'validate',
    '--config',
    path.join(process.cwd(), 'docs/loop-orchestrator.config.json')
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Loop orchestrator config: ok/);
});
