import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPLICATION_OPERATION_DESCRIPTORS,
  resolveApplicationOperation,
} from './application-operation-registry';

/* @Codex */
const expected = [
  ['anchor:web:web-01-anagrafica-paziente-lista-ricerca-view-create-update@1e35733c0218', 'patient search'],
  ['anchor:web:web-01-anagrafica-paziente-lista-ricerca-view-create-update@1e35733c0218', 'patient show'],
  ['anchor:web:web-04-nuova-voce-clinica-avanzata-s-o-a-p-allegati-ocr-sessione-visita@1e35733c0218', 'draft preview'],
  ['anchor:web:web-11-suggerimenti-follow-up-proiettati-da-documenti@1e35733c0218', 'open-loops'],
  ['anchor:web:web-39-blocco-sessione-immediato-stato-sessione@1e35733c0218', 'whoami'],
  ['anchor:web:web-63-get-api-v1-network-capabilities-api-v1-network-identity-api-v1-n@1e35733c0218', 'capabilities'],
] as const;

test('binds only the six directly evidenced Mini commands to their exact canonical anchors', () => {
  assert.equal(APPLICATION_OPERATION_DESCRIPTORS.length, 6);
  assert.deepEqual(APPLICATION_OPERATION_DESCRIPTORS.map(({ anchorId, miniCommandId }) => [anchorId, miniCommandId]), expected);
  for (const descriptor of APPLICATION_OPERATION_DESCRIPTORS) {
    assert.deepEqual(descriptor.evidence, {
      sourceCommit: '1e35733c0218eae67a1d6e158085aab7340bc26b',
      sourcePath: 'packages/mini/contracts/mini-parity.json',
      sourceBlob: 'ecde8213824a2e46e6ec3216ce63009366a1f373',
      sourceSha256: '8f84108732b7a8a9c1feb20cdedee17f4865044de98d8d997896f3a914d0e4d9',
      sourceSetSha256: '390bdc23aef4ff38e8a30eeb92820f6329de43a965cc5883769e475d98deaa94',
    });
  }
});

test('keeps every evidenced command unavailable while the operational contract is unresolved', () => {
  for (const descriptor of APPLICATION_OPERATION_DESCRIPTORS) {
    assert.equal(descriptor.status, 'denied');
    assert.equal(descriptor.availability, 'unavailable');
    assert.equal(descriptor.operationId, null);
    assert.deepEqual(descriptor.unresolved, ['operational_id', 'input_schema', 'output_schema', 'stage', 'authority', 'revision', 'limits']);
    assert.equal(descriptor.applyPolicy, 'none');
    assert.equal(descriptor.writesPerformed, 0);
    assert.equal(Object.isFrozen(descriptor), true);
  }
});

test('denies by default and never derives an anchor from a command-like value', () => {
  const known = resolveApplicationOperation(expected[0][0], 'patient search');
  assert.equal(known.status, 'denied');
  assert.equal(known.reason, 'operational_contract_unresolved');
  assert.equal(known.descriptor?.anchorId, expected[0][0]);
  for (const value of ['Patient Search', 'patient-search', 'unknown', '', { toString: () => 'patient search' }, null]) {
    const result = resolveApplicationOperation(expected[0][0], value);
    assert.equal(result.status, 'denied');
    assert.equal(result.reason, 'unknown_mini_command');
    assert.equal(result.descriptor, null);
  }
  assert.equal(resolveApplicationOperation('similar-anchor', 'patient search').reason, 'unknown_mini_command');
});
