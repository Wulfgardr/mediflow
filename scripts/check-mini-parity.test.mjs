// @Codex
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateMiniParity } from './check-mini-parity.mjs';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const source = readJson('docs/apple-parity-matrix.json');
const schema = readJson('packages/mini/contracts/mini-parity.schema.json');
const valid = readJson('packages/mini/contracts/mini-parity.json');
const changed = (mutate) => { const copy = structuredClone(valid); mutate(copy); return copy; };

test('accetta schema, binding canonico e metrica correnti', () => {
  assert.deepEqual(validateMiniParity(valid, schema, source), []);
});

test('rifiuta campi schema ignoti e sourceRow duplicati', () => {
  const candidate = changed((manifest) => {
    manifest.untrustedGrant = {};
    manifest.capabilities[1].sourceRow = 1;
  });
  assert.ok(validateMiniParity(candidate, schema, source).some((error) => error.includes('unexpected untrustedGrant')));
  assert.ok(validateMiniParity(candidate, schema, source).some((error) => error.includes('duplicate sourceRow')));
});

test('rifiuta binding, comandi, reason e metrica forgiati', () => {
  const candidate = changed((manifest) => {
    manifest.capabilities[0].webCapability = 'forged';
    manifest.capabilities[0].miniCommands = ['apply'];
    manifest.capabilities[0].reason = 'CALLER_ASSERTED';
    manifest.metric.parityPercent = 100;
  });
  const errors = validateMiniParity(candidate, schema, source);
  for (const fragment of ['canonical binding drift', 'command drift', 'reason drift', 'metric: recomputation drift']) {
    assert.ok(errors.some((error) => error.includes(fragment)), fragment);
  }
});
