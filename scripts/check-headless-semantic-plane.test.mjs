/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateHeadlessSemanticPlane } from './check-headless-semantic-plane.mjs';

const plane = JSON.parse(readFileSync('docs/headless/semantic-plane.v1.json', 'utf8'));
const clone = (value) => structuredClone(value);

test('accepts the deny-only semantic Headless plane', () => {
  assert.doesNotThrow(() => validateHeadlessSemanticPlane());
});

test('rejects source, graph, and semantic-operation drift', () => {
  const source = clone(plane); source.sources.headlessInventory.gitBlob = '0'.repeat(40);
  assert.throws(() => validateHeadlessSemanticPlane(source), /source/);
  const graph = clone(plane); graph.flow[1] = 'transport_adapter';
  assert.throws(() => validateHeadlessSemanticPlane(graph), /flow/);
  const topology = clone(plane); topology.graphScope.pop();
  assert.throws(() => validateHeadlessSemanticPlane(topology), /flow/);
  const contract = clone(plane); contract.operationContract.requiredFields.pop();
  assert.throws(() => validateHeadlessSemanticPlane(contract), /operation/);
});

test('rejects planner authority, provider choice, write, and apply', () => {
  for (const [key, value] of [
    ['authority', 'planner_granted'], ['providerSelection', 'caller_selected'],
    ['venueSelection', 'caller_selected'], ['confirmation', 'planner_generated'],
  ]) {
    const hostile = clone(plane); hostile.plannerPolicy[key] = value;
    assert.throws(() => validateHeadlessSemanticPlane(hostile), /planner/);
  }
  const write = clone(plane); write.allowedOutcomes.push('write');
  assert.throws(() => validateHeadlessSemanticPlane(write), /outcome/);
  const apply = clone(plane); apply.applyPolicy = 'apply';
  assert.throws(() => validateHeadlessSemanticPlane(apply), /apply/);
});

test('rejects transport-defined semantics, SQL, SQLite, and unsafe receipts', () => {
  for (const identity of ['cli', 'rest', 'sql', 'sqlite', 'screen_automation']) {
    const hostile = clone(plane); hostile.semanticIdentity = identity;
    assert.throws(() => validateHeadlessSemanticPlane(hostile), /semantic identity/);
  }
  const route = clone(plane); route.transports.adapters = ['POST /api/agent'];
  assert.throws(() => validateHeadlessSemanticPlane(route), /transport/);
  const receipt = clone(plane); receipt.receipt.forbiddenFields.pop();
  assert.throws(() => validateHeadlessSemanticPlane(receipt), /receipt/);
});
