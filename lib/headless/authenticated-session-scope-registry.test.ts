/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTHENTICATED_SESSION_SCOPE_MAX_CAPTURES_V1,
  createAuthenticatedSessionScopeRegistryV1,
} from './authenticated-session-scope-registry.ts';

const NOW = 1_800_000_000_000;
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;

function record<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, value));
}

function opaque(): object {
  return Object.freeze(Object.create(null)) as object;
}

function selection(overrides: Record<string, unknown> = {}) {
  return record({
    status: 'available', patientId: 'patient.synthetic.scope', ambulatoryId: 'ambulatory.synthetic.scope',
    generation: 3, revocationGeneration: 4, selectionEpoch: 5, restartGeneration: 6,
    expiresAt: NOW + 10_000, ...overrides,
  });
}

function harness() {
  let current = selection();
  const hashInputs: string[] = [];
  const nonces = ['scope_nonce_0000000000000001', 'scope_nonce_0000000000000002'];
  const registry = createAuthenticatedSessionScopeRegistryV1(record({
    now: () => NOW,
    nextNonce: () => nonces.shift(),
    hashRef: (value: string) => { hashInputs.push(value); return hashInputs.length === 1 ? DIGEST_A : DIGEST_B; },
    readHostSelection: () => current,
  }));
  return { registry, hashInputs, setSelection: (value: ReturnType<typeof selection>) => { current = value; } };
}

test('captures only opaque activation data and resolves the host selection from a bound execution', () => {
  const value = harness();
  const ticket = value.registry.capture();
  const activation = value.registry.activation(ticket);
  assert.deepEqual({ ...activation }, {
    scopeDigest: DIGEST_A, generation: 3, revocationGeneration: 4, selectionEpoch: 5,
    restartGeneration: 6, expiresAt: NOW + 10_000,
  });
  assert.doesNotMatch(JSON.stringify(activation), /patient|ambulatory/u);
  assert.equal(value.hashInputs.length, 1);
  assert.doesNotMatch(value.hashInputs[0]!, /patient\.synthetic|ambulatory\.synthetic/u);

  const owner = opaque();
  const session = value.registry.bindOwner(ticket, owner);
  const execution = opaque();
  assert.equal(value.registry.bindExecution(session, owner, execution), true);
  const resolved = value.registry.resolveExecution(execution);
  assert.deepEqual({ ...resolved! }, {
    status: 'available', patientId: 'patient.synthetic.scope', ambulatoryId: 'ambulatory.synthetic.scope',
    scopeDigest: DIGEST_A, generation: 3, revocationGeneration: 4, selectionEpoch: 5,
    restartGeneration: 6, expiresAt: NOW + 10_000,
  });
  assert.equal(Object.getPrototypeOf(resolved), null);
  assert.equal(Object.isFrozen(resolved), true);
});

test('fails closed when any host-owned selection dimension changes or expires', () => {
  const mutations = [
    { patientId: 'patient.synthetic.changed' }, { ambulatoryId: 'ambulatory.synthetic.changed' },
    { generation: 7 }, { revocationGeneration: 8 }, { selectionEpoch: 9 }, { restartGeneration: 10 },
    { expiresAt: NOW },
  ];
  for (const mutation of mutations) {
    const value = harness();
    const ticket = value.registry.capture();
    const owner = opaque();
    const session = value.registry.bindOwner(ticket, owner);
    const execution = opaque();
    value.registry.bindExecution(session, owner, execution);
    value.setSelection(selection(mutation));
    assert.equal(value.registry.resolveExecution(execution), null);
    assert.equal(value.registry.bindExecution(session, owner, opaque()), false);
  }
});

test('isolates sessions and invalidates every execution on revoke or restart', () => {
  const value = harness();
  const leftTicket = value.registry.capture();
  const leftOwner = opaque();
  const left = value.registry.bindOwner(leftTicket, leftOwner);
  const rightTicket = value.registry.capture();
  const rightOwner = opaque();
  const right = value.registry.bindOwner(rightTicket, rightOwner);
  const leftExecution = opaque();
  const rightExecution = opaque();
  assert.equal(value.registry.bindExecution(left, rightOwner, leftExecution), false);
  assert.equal(value.registry.bindExecution(left, leftOwner, leftExecution), true);
  assert.equal(value.registry.bindExecution(right, rightOwner, rightExecution), true);
  assert.equal(value.registry.bindExecution(right, rightOwner, leftExecution), false);
  assert.equal(value.registry.revoke(left), true);
  assert.equal(value.registry.revoke(left), false);
  assert.equal(value.registry.resolveExecution(leftExecution), null);
  assert.equal(value.registry.resolveExecution(rightExecution)?.scopeDigest, DIGEST_B);
  value.registry.restart();
  assert.equal(value.registry.resolveExecution(rightExecution), null);
});

test('rejects replayed tickets, forged handles and hostile boundary values without reading them', () => {
  const value = harness();
  const ticket = value.registry.capture();
  value.registry.bindOwner(ticket, opaque());
  assert.throws(() => value.registry.bindOwner(ticket, opaque()), (error: unknown) =>
    (error as { code?: unknown }).code === 'ticket_invalid');
  assert.throws(() => value.registry.activation(ticket), (error: unknown) =>
    (error as { code?: unknown }).code === 'ticket_invalid');
  let reads = 0;
  const hostile = new Proxy({}, { get() { reads += 1; throw new Error('must not read'); } });
  assert.throws(() => value.registry.bindOwner(hostile, opaque()), (error: unknown) =>
    (error as { code?: unknown }).code === 'ticket_invalid');
  assert.equal(value.registry.bindExecution(hostile, hostile, hostile), false);
  assert.equal(value.registry.resolveExecution(hostile), null);
  assert.equal(reads, 0);
});

test('denies resolution when a trusted selection callback revokes or restarts reentrantly', () => {
  for (const action of ['revoke', 'restart'] as const) {
    let reads = 0;
    let session: object;
    let registry: ReturnType<typeof createAuthenticatedSessionScopeRegistryV1>;
    registry = createAuthenticatedSessionScopeRegistryV1(record({
      now: () => NOW,
      nextNonce: () => 'scope_nonce_0000000000000001',
      hashRef: () => DIGEST_A,
      readHostSelection: () => {
        reads += 1;
        if (reads === 2) {
          try { action === 'revoke' ? registry.revoke(session) : registry.restart(); } catch { /* observed */ }
        }
        return selection();
      },
    }));
    const ticket = registry.capture();
    const owner = opaque();
    session = registry.bindOwner(ticket, owner);
    const execution = opaque();
    registry.bindExecution(session, owner, execution);
    assert.equal(registry.resolveExecution(execution), null);
  }
});

test('bounds captured digest retention and fails closed at capacity', () => {
  let sequence = 0;
  const registry = createAuthenticatedSessionScopeRegistryV1(record({
    now: () => NOW,
    nextNonce: () => `scope_nonce_${String(sequence).padStart(16, '0')}`,
    hashRef: () => `sha256:${(sequence++).toString(16).padStart(64, '0')}`,
    readHostSelection: () => selection(),
  }));
  for (let index = 0; index < AUTHENTICATED_SESSION_SCOPE_MAX_CAPTURES_V1; index += 1) registry.capture();
  assert.throws(() => registry.capture(), (error: unknown) =>
    (error as { code?: unknown }).code === 'capacity_exceeded');
});
