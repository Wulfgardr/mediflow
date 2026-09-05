import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  APPLICATION_OPERATION_DESCRIPTORS,
  resolveApplicationOperation,
} from './application-operation-registry';
import {
  resolveHeadlessCanonicalCapability,
} from './canonical-capability-catalog';

/* @Codex */
const expected = [
  ['anchor:web:web-01-anagrafica-paziente-lista-ricerca-view-create-update@1e35733c0218', 'patient search'],
  ['anchor:web:web-01-anagrafica-paziente-lista-ricerca-view-create-update@1e35733c0218', 'patient show'],
  ['anchor:web:web-04-nuova-voce-clinica-avanzata-s-o-a-p-allegati-ocr-sessione-visita@1e35733c0218', 'draft preview'],
  ['anchor:web:web-11-suggerimenti-follow-up-proiettati-da-documenti@1e35733c0218', 'open-loops'],
  ['anchor:web:web-39-blocco-sessione-immediato-stato-sessione@1e35733c0218', 'whoami'],
  ['anchor:web:web-63-get-api-v1-network-capabilities-api-v1-network-identity-api-v1-n@1e35733c0218', 'capabilities'],
] as const;
const descriptors = () => {
  const output = [] as (typeof APPLICATION_OPERATION_DESCRIPTORS)[number][];
  for (let index = 0; index < APPLICATION_OPERATION_DESCRIPTORS.length; index += 1) output.push(APPLICATION_OPERATION_DESCRIPTORS[index]!);
  return output;
};

test('binds only the six directly evidenced Mini commands to their exact canonical anchors', () => {
  assert.equal(APPLICATION_OPERATION_DESCRIPTORS.length, 6);
  assert.deepEqual(descriptors().map(({ anchorId, miniCommandId }) => [anchorId, miniCommandId]), expected);
  for (const descriptor of descriptors()) {
    assert.deepEqual({ ...descriptor.evidence }, {
      sourceCommit: '1e35733c0218eae67a1d6e158085aab7340bc26b',
      sourcePath: 'packages/mini/contracts/mini-parity.json',
      sourceBlob: 'ecde8213824a2e46e6ec3216ce63009366a1f373',
      sourceSha256: '8f84108732b7a8a9c1feb20cdedee17f4865044de98d8d997896f3a914d0e4d9',
      sourceSetSha256: '390bdc23aef4ff38e8a30eeb92820f6329de43a965cc5883769e475d98deaa94',
    });
    const canonical = resolveHeadlessCanonicalCapability(descriptor.anchorId);
    assert.ok(canonical);
    assert.equal(canonical.anchorId, descriptor.anchorId);
    assert.equal(descriptor.unresolved, canonical.unresolved);
    assert.equal(descriptor.manualDisposition, 'manual_only');
    assert.equal(descriptor.grantability, 'not_grantable');
    assert.equal(descriptor.applicationServiceRef, null);
  }
});

test('keeps every evidenced command unavailable while the operational contract is unresolved', () => {
  for (const descriptor of descriptors()) {
    assert.equal(descriptor.status, 'denied');
    assert.equal(descriptor.availability, 'unavailable');
    assert.equal(descriptor.manualDisposition, 'manual_only');
    assert.equal(descriptor.grantability, 'not_grantable');
    assert.equal(descriptor.operationId, null);
    assert.deepEqual(Array.from(descriptor.unresolved), [
      'operationId', 'capabilityId', 'applicationServiceRef', 'inputSchema', 'outputSchema', 'maximumStage',
      'authorityPolicy', 'sessionPolicy', 'casPolicy', 'idempotencyPolicy', 'limitPolicy', 'receiptPolicy',
      'fabricDependency',
    ]);
    assert.equal(descriptor.applicationServiceRef, null);
    assert.equal(descriptor.applyPolicy, 'none');
    assert.equal(descriptor.writesPerformed, 0);
    assert.equal(Object.isFrozen(descriptor), true);
    assert.equal(Object.getPrototypeOf(descriptor), null);
    assert.equal(Object.getPrototypeOf(descriptor.evidence), null);
    assert.equal(Object.getPrototypeOf(descriptor.unresolved), null);
  }
  assert.equal(Object.isFrozen(APPLICATION_OPERATION_DESCRIPTORS), true);
  assert.equal(Object.getPrototypeOf(APPLICATION_OPERATION_DESCRIPTORS), null);
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

test('does not inherit then or inspect hostile object inputs', () => {
  const known = resolveApplicationOperation(expected[0][0], expected[0][1]);
  let reads = 0;
  const hostile = new Proxy({}, { get() { reads += 1; throw new Error('must not read'); } });
  const accessor = Object.create(null) as object;
  Object.defineProperty(accessor, 'toString', { get() { reads += 1; return expected[0][0]; } });
  const thenable = Object.create(null) as object;
  Object.defineProperty(thenable, 'then', { get() { reads += 1; return undefined; } });
  const customPrototype = Object.create({ valueOf() { reads += 1; return expected[0][0]; } });
  for (const value of [hostile, accessor, thenable, customPrototype, { anchorId: expected[0][0] }, Symbol('command')]) {
    assert.equal(resolveApplicationOperation(value, value).reason, 'unknown_mini_command');
  }
  assert.equal(reads, 0);
  for (const value of [
    'web-01-anagrafica-paziente-lista-ricerca-view-create-update',
    expected[0][0].toUpperCase(),
    `${expected[0][0]}:extra`,
    'patient-search',
    'patient search ',
  ]) assert.equal(resolveApplicationOperation(value, 'patient search').reason, 'unknown_mini_command');
  assert.throws(() => { (known as unknown as { status: string }).status = 'allowed'; });
  const loader = fileURLToPath(new URL('../../scripts/register-strip-types-loader.mjs', import.meta.url));
  const registry = new URL('./application-operation-registry.ts', import.meta.url).href;
  const source = `import { APPLICATION_OPERATION_DESCRIPTORS as d, resolveApplicationOperation as r } from ${JSON.stringify(registry)}; let reads=0,traps=0,unhandled=0; process.on('unhandledRejection',()=>unhandled++); Object.defineProperty(Object.prototype,'then',{configurable:true,get(){reads++;}}); const p=new Proxy({}, {get(){traps++;throw Error()}}); const x=r('anchor:web:web-01-anagrafica-paziente-lista-ricerca-view-create-update@1e35733c0218','patient search'),y=r(p,p); if(Object.getPrototypeOf(d)||Object.getPrototypeOf(x)||Object.getPrototypeOf(x.descriptor)||Object.getPrototypeOf(x.descriptor.evidence)||Object.getPrototypeOf(x.descriptor.unresolved)||x.descriptor.manualDisposition!=='manual_only'||x.descriptor.grantability!=='not_grantable'||x.descriptor.applicationServiceRef!==null||y.descriptor||traps)process.exit(1); Promise.resolve(d).then(()=>{Promise.resolve(x).then(()=>{setImmediate(()=>process.exit(reads||unhandled?1:0));});});`;
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--import', loader, '--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stdout + child.stderr);
});
