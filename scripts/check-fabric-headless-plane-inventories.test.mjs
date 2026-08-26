/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validatePlaneInventories } from './check-fabric-headless-plane-inventories.mjs';

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const clone = (value) => structuredClone(value);
const fabric = json('docs/capability-mapping/fabric-plane-inventory.v1.json');
const headless = json('docs/capability-mapping/headless-plane-inventory.v1.json');

test('accepts the separate, referential P1 plane inventories', () => {
  assert.doesNotThrow(() => validatePlaneInventories());
});

test('rejects coverage, frozen-reference, and semantic-identity drift', () => {
  const missing = clone(headless);
  missing.semanticSource.expectedCount = 65;
  assert.throws(() => validatePlaneInventories(fabric, missing), /66/);
  const drift = clone(fabric);
  drift.source.gitBlob = '0'.repeat(40);
  assert.throws(() => validatePlaneInventories(drift, headless), /blob/);
  const transport = clone(headless);
  transport.rowPolicy.identityKind = 'aip_transport';
  assert.throws(() => validatePlaneInventories(fabric, transport), /semantic identity/);
  const aipAsSemantic = clone(headless);
  aipAsSemantic.semanticSource.ref = 'b25ace437fda8d89b402c63cba2adb38295f188c:docs/capability-mapping/nodes/aip-inventory.v1.json';
  aipAsSemantic.semanticSource.gitBlob = '3c455efc7194c2bffc32b3bc74933290c1522126';
  assert.throws(() => validatePlaneInventories(fabric, aipAsSemantic), /semantic source/);
  const surfaceAsSemantic = clone(headless);
  surfaceAsSemantic.semanticSource.ref = 'b25ace437fda8d89b402c63cba2adb38295f188c:docs/capability-mapping/nodes/web-surfaces.v1.json';
  surfaceAsSemantic.semanticSource.gitBlob = 'cd59f78a0c2bdadf4780604ef04c738c3eeb3cfe';
  assert.throws(() => validatePlaneInventories(fabric, surfaceAsSemantic), /semantic source/);
});

test('rejects authority unions, apply, transport choices, and silent fallback', () => {
  for (const [key, value, pattern] of [
    ['authority', ['manual_only', 'clinical_application'], /closed row policy/],
    ['applyPolicy', 'apply', /closed row policy/],
    ['provider', 'caller_selected', /closed row policy/],
    ['fallback', 'implicit', /closed row policy/],
  ]) {
    const hostile = clone(headless);
    hostile.rowPolicy[key] = value;
    assert.throws(() => validatePlaneInventories(fabric, hostile), pattern);
  }
  const fabricUnion = clone(fabric);
  fabricUnion.rowPolicy.authority = ['fabric_only_not_headless', 'not_grantable'];
  assert.throws(() => validatePlaneInventories(fabricUnion, headless), /Fabric row policy/);
  const headlessUnion = clone(headless);
  headlessUnion.rowPolicy.stage = ['unresolved', 'integrated'];
  assert.throws(() => validatePlaneInventories(fabric, headlessUnion), /closed row policy/);
});

test('rejects SQL, PIN, route, or surface identities and collapsed relations', () => {
  for (const identityKind of ['sql', 'pin', 'route', 'surface']) {
    const hostile = clone(headless);
    hostile.rowPolicy.identityKind = identityKind;
    assert.throws(() => validatePlaneInventories(fabric, hostile), /semantic identity/);
  }
  const collapsed = clone(fabric);
  collapsed.relations.expectedCount = 0;
  assert.throws(() => validatePlaneInventories(collapsed, headless), /relations/);
  const extra = clone(headless);
  extra.unreviewedRuntimeClaim = true;
  assert.throws(() => validatePlaneInventories(fabric, extra), /unexpected contract/);
});
