/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validateCapabilityMapping } from './check-capability-mapping.mjs';

const manifest = JSON.parse(readFileSync('docs/capability-mapping/source-manifest.v1.json', 'utf8'));
const basis = JSON.parse(readFileSync('docs/capability-mapping/mapping-basis.v1.json', 'utf8'));
const clone = (value) => structuredClone(value);

test('accepts the frozen M0 contracts', () => {
  assert.doesNotThrow(() => validateCapabilityMapping());
});

test('keeps all 66 Web/Mini rows lossless and authority-unresolved', () => {
  const records = JSON.parse(readFileSync('docs/capability-mapping/nodes/web-mini-crosswalk.v1.json', 'utf8')).records;
  assert.equal(records.length, 66);
  assert.ok(records.every((record) => record.authority === 'unresolved' && record.stage === 'unresolved'));
});

test('rejects source drift and apply', () => {
  const drift = clone(manifest);
  drift.sourceSets[0].recordCount += 1;
  assert.throws(() => validateCapabilityMapping(drift, basis), /source drift/);
  const unsafe = clone(basis);
  unsafe.applyPolicy = 'apply';
  assert.throws(() => validateCapabilityMapping(manifest, unsafe), /applyPolicy/);
});

test('rejects unknown mapping vocabulary and unjustified completion', () => {
  const unknown = clone(basis);
  unknown.relationKinds[0] = 'similar_to';
  assert.throws(() => validateCapabilityMapping(manifest, unknown), /relation kind vocabulary/);
  const incomplete = clone(basis);
  incomplete.populations.surfaces.records.push({ id: 'surface.v1', sourceIdentity: 'synthetic', description: 'synthetic hostile record', surface: 'test', stage: 'none', authority: 'unresolved', input: 'unresolved', output: 'unresolved', provider: 'unresolved', venue: 'unresolved', egress: 'unresolved', evidence: ['test'], terminalDisposition: 'unmapped' });
  incomplete.semanticBindingComplete = true;
  assert.throws(() => validateCapabilityMapping(manifest, incomplete), /semantic binding/);
});
