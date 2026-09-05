import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  HEADLESS_CANONICAL_CAPABILITY_DESCRIPTORS,
  resolveHeadlessCanonicalCapability,
} from './canonical-capability-catalog';

/* @Codex */
type Crosswalk = Readonly<{ records: readonly Readonly<{
  id: string;
  sourceIdentity: Readonly<{ sourceRow: number }>;
  sourceRecord: Readonly<{ webCapabilityId: string }>;
}>[] }>;

const crosswalk = JSON.parse(readFileSync(
  new URL('../../docs/capability-mapping/nodes/web-mini-crosswalk.v1.json', import.meta.url),
  'utf8',
)) as Crosswalk;
const descriptors = () => Array.from(HEADLESS_CANONICAL_CAPABILITY_DESCRIPTORS);
const sha256 = (values: readonly string[]) => createHash('sha256').update(values.join('\n')).digest('hex');

test('binds all 66 full canonical anchors and source rows to exact frozen evidence', () => {
  const expected = crosswalk.records.map(({ id, sourceIdentity }) => [id, sourceIdentity.sourceRow] as const);
  assert.equal(expected.length, 66);
  assert.equal(new Set(expected.map(([id]) => id)).size, 66);
  assert.deepEqual(descriptors().map(({ anchorId, sourceRow }) => [anchorId, sourceRow]), expected);
  assert.equal(expected[0]?.[0], 'anchor:web:web-01-anagrafica-paziente-lista-ricerca-view-create-update@1e35733c0218');
  assert.equal(expected[65]?.[0], 'anchor:web:web-66-governance-ai-parliament-dei-modelli-e-prontezza-al-rollout@1e35733c0218');
  assert.equal(sha256(expected.map(([id]) => id)), 'a185efd62172faf9ce5df1154c00cb41d9ae61d22b43c3bb42367dece9263976');
  assert.equal(sha256(crosswalk.records.map(({ sourceRecord }) => sourceRecord.webCapabilityId)), '4c0281982b197da52e73911ebd4874d0d60894607c8421fd9f89f81b98408d95');

  for (const descriptor of descriptors()) {
    assert.deepEqual({ ...descriptor.evidence }, {
      crosswalkRef: 'b25ace437fda8d89b402c63cba2adb38295f188c:docs/capability-mapping/nodes/web-mini-crosswalk.v1.json',
      crosswalkBlob: '79e8078c1b7ed244653a32d6fce2dd1ef83ff281',
      rosterSha256: 'a185efd62172faf9ce5df1154c00cb41d9ae61d22b43c3bb42367dece9263976',
      webCapabilitySha256: '4c0281982b197da52e73911ebd4874d0d60894607c8421fd9f89f81b98408d95',
    });
    assert.equal(Object.isFrozen(descriptor), true);
    assert.equal(Object.getPrototypeOf(descriptor), null);
    assert.equal(Object.isFrozen(descriptor.evidence), true);
    assert.equal(Object.getPrototypeOf(descriptor.evidence), null);
  }
  assert.equal(Object.isFrozen(HEADLESS_CANONICAL_CAPABILITY_DESCRIPTORS), true);
  assert.equal(Object.getPrototypeOf(HEADLESS_CANONICAL_CAPABILITY_DESCRIPTORS), null);
});

test('publishes referential descriptors only and leaves every operation field unresolved', () => {
  const unresolved = [
    'operationId', 'capabilityId', 'applicationServiceRef', 'inputSchema', 'outputSchema', 'maximumStage',
    'authorityPolicy', 'sessionPolicy', 'casPolicy', 'idempotencyPolicy', 'limitPolicy', 'receiptPolicy',
    'fabricDependency',
  ];
  for (const descriptor of descriptors()) {
    assert.equal(descriptor.schema, 'mediflow.headless.canonical-capability-descriptor.v1');
    assert.equal(descriptor.manualDisposition, 'manual_only');
    assert.equal(descriptor.grantability, 'not_grantable');
    assert.equal(descriptor.stage, 'unresolved');
    assert.deepEqual(Array.from(descriptor.unresolved), unresolved);
    assert.equal(descriptor.operationId, null);
    assert.equal(descriptor.applicationServiceRef, null);
    assert.equal(descriptor.applyPolicy, 'none');
    assert.equal(descriptor.writesPerformed, 0);
    assert.equal(Object.isFrozen(descriptor.unresolved), true);
    assert.equal(Object.getPrototypeOf(descriptor.unresolved), null);
  }
});

test('resolves full anchor identities exactly and rejects every inferred or hostile value without reads', () => {
  const first = descriptors()[0]!;
  assert.equal(resolveHeadlessCanonicalCapability(first.anchorId), first);
  for (const value of [
    'web-01', first.anchorId.toUpperCase(), ` ${first.anchorId}`, `${first.anchorId} `,
    first.anchorId.slice(0, -1), `${first.anchorId}:extra`, '', null, undefined, 1, true, Symbol('anchor'),
  ]) assert.equal(resolveHeadlessCanonicalCapability(value), null);

  let reads = 0;
  const accessor = Object.create(null) as object;
  Object.defineProperty(accessor, 'then', { get() { reads += 1; return undefined; } });
  const thenable = Object.create(null) as object;
  Object.defineProperty(thenable, 'then', { value() { reads += 1; } });
  const customPrototype = Object.create({ toString() { reads += 1; return first.anchorId; } });
  const proxy = new Proxy({}, {
    get() { reads += 1; throw new Error('must not read'); },
    getPrototypeOf() { reads += 1; throw new Error('must not inspect'); },
    ownKeys() { reads += 1; throw new Error('must not enumerate'); },
    getOwnPropertyDescriptor() { reads += 1; throw new Error('must not reflect'); },
  });
  for (const value of [accessor, thenable, customPrototype, proxy]) {
    assert.equal(resolveHeadlessCanonicalCapability(value), null);
  }
  assert.equal(reads, 0);
});

test('contains no executable, database, provider, route, or application-service dependency', () => {
  const source = readFileSync(new URL('./canonical-capability-catalog.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /(?:drizzle|dbServer|sqlite|providerSelection|venueSelection|execute\s*\(|fetch\s*\()/i);
  assert.doesNotMatch(source, /applicationServiceRef:\s*['"`]/);
  assert.doesNotMatch(source, /operationId:\s*['"`]/);
});
