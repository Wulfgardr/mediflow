/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPlan, loadConfig, validateConfig } from './loop-orchestrator.mjs';

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
