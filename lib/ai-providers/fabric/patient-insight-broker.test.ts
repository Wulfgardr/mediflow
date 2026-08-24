/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createPatientInsightHostBoundary } from './patient-insight-host-boundary.ts';
import { PatientInsightBrokerError, createPatientInsightBroker, type PatientInsightBrokerHost } from './patient-insight-broker.ts';

const ref = (prefix: string) => `${prefix}_${'a'.repeat(32)}`;
const now = '2026-08-23T12:00:00.000Z';
const sources = () => ({ focus: { summary: 'synthetic follow-up' }, conditions: [{ label: 'synthetic condition' }], activeTherapies: [{ label: 'synthetic therapy' }], recentEvents: [{ summary: 'synthetic review' }] });
const boundary = () => createPatientInsightHostBoundary({
    binding: { leaseRef: ref('lsr'), patientRef: ref('ptr'), selectionEpoch: 7 },
    receipt: { schemaVersion: 'mediflow.patient-insight.host-receipt.v1', reference: ref('receipt'), capability: 'patient_insight', authority: 'host_service', writesPerformed: 0, applyPolicy: 'none' },
    provenance: { schemaVersion: 'mediflow.patient-insight.host-provenance.v1', reference: ref('provenance'), capability: 'patient_insight', receiptRef: ref('receipt') },
});
const state = (overrides: Partial<{ selectionEpoch: number; revision: number; freshnessToken: string; revoked: boolean }> = {}) => Object.freeze({
    selectionEpoch: 7, revision: 3, freshnessToken: 'fresh_token_0123456789abcdef', revoked: false, ...overrides,
});
function host(overrides: Partial<PatientInsightBrokerHost> = {}) {
    let current = state(); let sequence = 0;
    const value = Object.freeze({
        readCurrentness: () => Object.freeze({ selectionEpoch: current.selectionEpoch, revision: current.revision, freshnessToken: current.freshnessToken, isRevoked: () => current.revoked }),
        readSources: sources, boundary: boundary(), clock: () => now,
        entropy: () => Uint8Array.from({ length: 16 }, (_, index) => (sequence += 1) + index), ...overrides,
    });
    return { value, setCurrentness: (next: typeof current) => { current = next; } };
}
const reject = (action: () => unknown, code: string) => assert.throws(action, (error) => error instanceof PatientInsightBrokerError && error.code === code && error.message === `Patient Insight broker denied: ${code}` && !/synthetic|condition/i.test(error.message));

test('issues unique opaque handles and consumes only the accepted frozen review proposal', () => {
    const fixture = host(); const broker = createPatientInsightBroker(fixture.value); const first = broker.issue(); const second = broker.issue();
    assert.match(first, /^pib_[0-9a-f]{32}$/u); assert.notEqual(first, second); assert.doesNotMatch(first, /synthetic|patient|condition/i);
    const accepted = broker.consume({ handle: first });
    assert.deepEqual(Object.keys(accepted), ['status', 'writesPerformed', 'applyPolicy', 'receiptReference', 'provenanceReference', 'proposal']);
    assert.equal(accepted.status, 'available'); assert.equal(accepted.writesPerformed, 0); assert.equal(accepted.applyPolicy, 'none');
    assert.equal(accepted.proposal.reviewOnly, true); assert.equal(Object.isFrozen(accepted), true); assert.equal(Object.isFrozen(accepted.proposal), true);
    reject(() => broker.consume({ handle: first }), 'handle_replayed');
});

test('stages an opaque reservation, publishes exactly once, and keeps the legacy issue boundary', () => {
    const broker = createPatientInsightBroker(host().value); const reservation = broker.stage();
    assert.equal(Object.getPrototypeOf(reservation), null); assert.equal(Object.isFrozen(reservation), true); assert.deepEqual(Reflect.ownKeys(reservation), []);
    const handle = broker.publish(reservation); assert.match(handle, /^pib_[0-9a-f]{32}$/u);
    reject(() => broker.publish(reservation), 'reservation_missing'); reject(() => broker.abort(reservation), 'reservation_missing');
    assert.equal(broker.consume({ handle }).status, 'available'); reject(() => broker.consume({ handle }), 'handle_replayed');
    const legacy = broker.issue(); assert.match(legacy, /^pib_[0-9a-f]{32}$/u);
});

test('aborts every staged record and releases fixed entropy for a retry', () => {
    const fixed = Uint8Array.from({ length: 16 }, (_, index) => index); const broker = createPatientInsightBroker(host({ entropy: () => fixed }).value);
    const first = broker.stage(); broker.abort(first);
    const retry = broker.stage(); assert.notEqual(retry, first); const handle = broker.publish(retry); assert.equal(handle, `pib_${'000102030405060708090a0b0c0d0e0f'}`);
    assert.equal(broker.consume({ handle }).proposal.reviewOnly, true); reject(() => broker.consume({ handle }), 'handle_replayed');
    const afterConsume = broker.publish(broker.stage()); assert.notEqual(afterConsume, handle); reject(() => broker.consume({ handle }), 'handle_replayed'); assert.equal(broker.consume({ handle: afterConsume }).status, 'available');
});

test('retains a stage on denial so abort is complete and no denial or throw leaves a live reservation', () => {
    const fixed = Uint8Array.from({ length: 16 }, (_, index) => index); const fixture = host({ entropy: () => fixed }); const broker = createPatientInsightBroker(fixture.value);
    const denied = broker.stage(); fixture.setCurrentness(state({ revision: 4 })); reject(() => broker.publish(denied), 'revision_stale'); broker.abort(denied);
    fixture.setCurrentness(state()); const afterDenial = broker.stage(); broker.abort(afterDenial);
    const afterThrow = broker.stage(); try { throw new Error('synthetic P4 denial'); } catch { broker.abort(afterThrow); }
    assert.equal(Object.getPrototypeOf(broker.stage()), null);
});

test('rejects fixed entropy only while its reservation or handle remains live', () => {
    const fixed = Uint8Array.from({ length: 16 }, (_, index) => index); const broker = createPatientInsightBroker(host({ entropy: () => fixed }).value);
    const staged = broker.stage(); reject(() => broker.stage(), 'handle_collision'); broker.abort(staged);
    const retry = broker.stage(); reject(() => broker.publish(staged), 'reservation_missing'); const handle = broker.publish(retry); reject(() => broker.stage(), 'handle_collision');
    assert.match(handle, /^pib_[0-9a-f]{32}$/u);
});

test('rejects forged, cross-broker, duplicate, accessor, Proxy, symbol, and thenable lifecycle inputs without reads', () => {
    const first = createPatientInsightBroker(host().value); const second = createPatientInsightBroker(host().value); const reservation = first.stage();
    const forged = Object.freeze(Object.create(null));
    reject(() => second.publish(reservation), 'reservation_missing'); reject(() => second.abort(reservation), 'reservation_missing'); reject(() => first.publish(forged), 'reservation_missing');
    const accessor = Object.create(null) as Record<string, unknown>; Object.defineProperty(accessor, 'reservation', { enumerable: true, get() { throw new Error('synthetic accessor'); } }); Object.freeze(accessor);
    let proxyReads = 0; const proxy = new Proxy(Object.freeze(Object.create(null)), { get() { proxyReads += 1; throw new Error('synthetic proxy'); }, ownKeys() { proxyReads += 1; throw new Error('synthetic proxy'); } });
    for (const value of [Object.freeze({}), Object.freeze(Object.assign(Object.create(null), { extra: true })), Object.freeze(Object.assign(Object.create(null), { [Symbol('synthetic')]: true })), accessor, proxy]) {
        reject(() => first.publish(value), 'input_invalid'); reject(() => first.abort(value), 'input_invalid');
    }
    assert.equal(proxyReads, 0);
    let thenReads = 0; Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { thenReads += 1; throw new Error('ambient then'); } });
    try { first.abort(reservation); } finally { delete (Object.prototype as Record<string, unknown>).then; }
    assert.equal(thenReads, 0); reject(() => first.publish(reservation), 'reservation_missing'); reject(() => first.abort(reservation), 'reservation_missing');
});

test('fails closed on lifecycle reentry without publishing or reserving a partial result', () => {
    const fixture = host({ clock: () => { broker.stage(); return now; } }); const broker = createPatientInsightBroker(fixture.value);
    reject(() => broker.stage(), 'operation_reentered');
});

test('makes swallowed readSources reentry sticky before a stage can reserve or return', () => {
    const fixed = Uint8Array.from({ length: 16 }, (_, index) => index); let reenter = true;
    const fixture = host({ entropy: () => fixed, readSources: () => { if (reenter) { try { broker.stage(); } catch (error) { assert.equal((error as PatientInsightBrokerError).code, 'operation_reentered'); } } return sources(); } }); const broker = createPatientInsightBroker(fixture.value);
    reject(() => broker.stage(), 'operation_reentered'); reenter = false;
    const retry = broker.stage(); assert.equal(broker.publish(retry), `pib_${'000102030405060708090a0b0c0d0e0f'}`);
});

test('makes swallowed currentness reentry sticky at stage and releases the same entropy after reset', () => {
    const fixed = Uint8Array.from({ length: 16 }, (_, index) => index); let reenter = true;
    const fixture = host({ entropy: () => fixed, readCurrentness: () => { if (reenter) { try { broker.stage(); } catch (error) { assert.equal((error as PatientInsightBrokerError).code, 'operation_reentered'); } } return Object.freeze({ selectionEpoch: 7, revision: 3, freshnessToken: 'fresh_token_0123456789abcdef', isRevoked: () => false }); } }); const broker = createPatientInsightBroker(fixture.value);
    reject(() => broker.stage(), 'operation_reentered'); reenter = false;
    const retry = broker.stage(); assert.equal(broker.publish(retry), `pib_${'000102030405060708090a0b0c0d0e0f'}`);
});

test('makes swallowed currentness reentry sticky at publish without consuming its reservation', () => {
    const fixed = Uint8Array.from({ length: 16 }, (_, index) => index); let reenter = false; const lifecycle = { reservation: null as object | null };
    const fixture = host({ entropy: () => fixed, readCurrentness: () => { if (reenter && lifecycle.reservation) { try { broker.abort(lifecycle.reservation); } catch (error) { assert.equal((error as PatientInsightBrokerError).code, 'operation_reentered'); } } return Object.freeze({ selectionEpoch: 7, revision: 3, freshnessToken: 'fresh_token_0123456789abcdef', isRevoked: () => false }); } }); const broker = createPatientInsightBroker(fixture.value);
    lifecycle.reservation = broker.stage(); reenter = true; reject(() => broker.publish(lifecycle.reservation), 'operation_reentered'); reenter = false;
    broker.abort(lifecycle.reservation); const retry = broker.stage(); assert.equal(broker.publish(retry), `pib_${'000102030405060708090a0b0c0d0e0f'}`);
});

test('fails closed after selection, revision, freshness, or revocation changes', () => {
    for (const [next, code] of [[state({ selectionEpoch: 8 }), 'selection_changed'], [state({ revision: 4 }), 'revision_stale'], [state({ freshnessToken: 'fresh_token_abcdef0123456789' }), 'freshness_stale'], [state({ revoked: true }), 'revoked']] as const) {
        const fixture = host(); const broker = createPatientInsightBroker(fixture.value); const handle = broker.issue(); fixture.setCurrentness(next);
        reject(() => broker.consume({ handle }), code); reject(() => broker.consume({ handle }), 'handle_replayed');
    }
});

test('rejects hostile dependencies, host-reader failures, and later source mutation without leaking details', () => {
    const accessor = { ...host().value } as Record<string, unknown>; Object.defineProperty(accessor, 'clock', { enumerable: true, get() { throw new Error('synthetic accessor'); } }); Object.freeze(accessor);
    const sparse = [host().value]; sparse.length = 2;
    for (const value of [
        { ...host().value, extra: true }, Object.create(host().value), accessor, sparse, new Proxy(host().value, { ownKeys() { throw new Error('synthetic proxy'); } }),
    ]) reject(() => createPatientInsightBroker(value as never), 'input_invalid');
    const consumer = createPatientInsightBroker(host().value); const forgedHandle = `pib_${'a'.repeat(32)}`;
    const consumerAccessor: Record<string, unknown> = {}; Object.defineProperty(consumerAccessor, 'handle', { enumerable: true, get() { throw new Error('synthetic accessor'); } }); Object.freeze(consumerAccessor);
    for (const value of [{ handle: forgedHandle, extra: true }, { handle: forgedHandle, [Symbol('synthetic')]: true }, Object.create({ handle: forgedHandle }), consumerAccessor, new Proxy({ handle: forgedHandle }, { ownKeys() { throw new Error('synthetic proxy'); } })]) reject(() => consumer.consume(value), 'input_invalid');
    for (const value of [host({ clock: () => { throw new Error('raw clock'); } }), host({ entropy: () => new Uint8Array(15) }), host({ readCurrentness: () => { throw new Error('raw state'); } }), host({ readSources: () => { throw new Error('raw sources'); } })]) {
        const broker = createPatientInsightBroker(value.value); reject(() => broker.issue(), 'dependency_unavailable');
    }
    const input = sources(); const fixture = host({ readSources: () => input }); const broker = createPatientInsightBroker(fixture.value); const handle = broker.issue(); input.focus.summary = 'mutated';
    assert.equal(broker.consume({ handle }).proposal.promptFingerprint, 'pi_223cbf9d');
});

test('rejects transparent Proxies before their traps or accessors are evaluated', () => {
    let reads = 0; const trapped = new Proxy(host().value, { get() { reads += 1; throw new Error('synthetic trap'); } });
    reject(() => createPatientInsightBroker(trapped), 'input_invalid'); assert.equal(reads, 0);
    reject(() => createPatientInsightBroker(new Proxy(host().value, {})), 'input_invalid');
    reject(() => createPatientInsightBroker(host({ boundary: new Proxy(boundary(), {}) }).value), 'input_invalid');
    const currentProxy = new Proxy(Object.freeze({ selectionEpoch: 7, revision: 3, freshnessToken: 'fresh_token_0123456789abcdef', isRevoked: () => false }), {});
    reject(() => createPatientInsightBroker(host({ readCurrentness: () => currentProxy }).value).issue(), 'dependency_unavailable');
    const valid = boundary().prepare({ projection: { schemaVersion: 'mediflow.patient-insight.projection.v1', clinicalFocus: 'synthetic follow-up', activeConditions: ['synthetic condition'], currentTherapies: ['synthetic therapy'], recentClinicalEvents: ['synthetic review'] } });
    const resultProxy = Object.freeze({ prepare: () => new Proxy(valid, {}) });
    const proposalProxy = Object.freeze({ prepare: () => Object.freeze({ ...valid, proposal: new Proxy(valid.status === 'available' ? valid.proposal : {}, {}) }) });
    reject(() => createPatientInsightBroker(host({ boundary: resultProxy as never }).value).issue(), 'proposal_invalid');
    reject(() => createPatientInsightBroker(host({ boundary: proposalProxy as never }).value).issue(), 'proposal_invalid');
    const broker = createPatientInsightBroker(host().value); reject(() => broker.consume(new Proxy({ handle: `pib_${'a'.repeat(32)}` }, {})), 'input_invalid');
});

test('rejects non-enumerable broker records at every caller-controlled record seam', () => {
    const hidden = (value: Record<string, unknown>, key: string) => {
        const clone = { ...value };
        Object.defineProperty(clone, key, { value: clone[key], enumerable: false });
        return Object.freeze(clone);
    };
    reject(() => createPatientInsightBroker(hidden({ ...host().value }, 'clock') as never), 'input_invalid');
    reject(() => createPatientInsightBroker(host({ boundary: hidden({ ...boundary() }, 'prepare') as never }).value), 'input_invalid');
    const hiddenCurrentness = hidden({ selectionEpoch: 7, revision: 3, freshnessToken: 'fresh_token_0123456789abcdef', isRevoked: () => false }, 'revision');
    reject(() => createPatientInsightBroker(host({ readCurrentness: () => hiddenCurrentness as never }).value).issue(), 'dependency_unavailable');
    const valid = boundary().prepare({ projection: { schemaVersion: 'mediflow.patient-insight.projection.v1', clinicalFocus: 'synthetic follow-up', activeConditions: ['synthetic condition'], currentTherapies: ['synthetic therapy'], recentClinicalEvents: ['synthetic review'] } });
    reject(() => createPatientInsightBroker(host({ boundary: Object.freeze({ prepare: () => hidden({ ...valid }, 'status') }) as never }).value).issue(), 'proposal_invalid');
    const available = valid.status === 'available' ? valid : assert.fail('expected available proposal');
    const hiddenProposal = hidden({ ...available.proposal }, 'reviewOnly');
    reject(() => createPatientInsightBroker(host({ boundary: Object.freeze({ prepare: () => Object.freeze({ ...available, proposal: hiddenProposal }) }) as never }).value).issue(), 'proposal_invalid');
    const broker = createPatientInsightBroker(host().value);
    reject(() => broker.consume(hidden({ handle: `pib_${'a'.repeat(32)}` }, 'handle')), 'input_invalid');
});

test('requires a boolean revocation result and publishes no record for non-boolean values', () => {
    let thenReads = 0;
    const thenable = Object.create(null, { then: { enumerable: true, get() { thenReads += 1; return () => undefined; } } });
    for (const invalid of [0, 1, undefined, null, 'false', Object.freeze({}), Promise.resolve(false), thenable]) {
        let revoked: unknown = invalid; let entropyCalls = 0;
        const fixture = host({
            readCurrentness: () => Object.freeze({ selectionEpoch: 7, revision: 3, freshnessToken: 'fresh_token_0123456789abcdef', isRevoked: () => revoked as never }),
            entropy: () => { entropyCalls += 1; return new Uint8Array(16).fill(9); },
        });
        const broker = createPatientInsightBroker(fixture.value);
        reject(() => broker.issue(), 'dependency_unavailable');
        assert.equal(entropyCalls, 0);
        revoked = false;
        const handle = broker.issue();
        assert.equal(handle, `pib_${'09'.repeat(16)}`);
        assert.equal(entropyCalls, 1);
        assert.equal(broker.consume({ handle }).status, 'available');
    }
    assert.equal(thenReads, 0);
    const revoked = host({ readCurrentness: () => Object.freeze({ selectionEpoch: 7, revision: 3, freshnessToken: 'fresh_token_0123456789abcdef', isRevoked: () => true }) });
    reject(() => createPatientInsightBroker(revoked.value).issue(), 'revoked');
});

test('rechecks currentness after issue dependencies and orders consume clock before currentness', () => {
    let change = () => {}; let calls = 0;
    const clockFixture = host({ clock: () => { calls += 1; if (calls === 2) change(); return now; } }); change = () => clockFixture.setCurrentness(state({ revision: 4 }));
    const clockBroker = createPatientInsightBroker(clockFixture.value); const handle = clockBroker.issue(); reject(() => clockBroker.consume({ handle }), 'revision_stale');
    let reentrant = state();
    const revokedFixture = host({ readCurrentness: () => Object.freeze({ selectionEpoch: reentrant.selectionEpoch, revision: reentrant.revision, freshnessToken: reentrant.freshnessToken, isRevoked: () => { reentrant = state({ revision: 4 }); return false; } }) });
    reject(() => createPatientInsightBroker(revokedFixture.value).issue(), 'revision_stale');
});

test('publishes no handle residue after reentrant denial and ignores ambient then accessors', () => {
    let mutate = () => {};
    const fixture = host({
        readSources: () => { mutate(); return sources(); },
        entropy: () => new Uint8Array(16).fill(7),
    });
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    let reads = 0;
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } });
    try {
        const broker = createPatientInsightBroker(fixture.value);
        mutate = () => fixture.setCurrentness(state({ revision: 4 }));
        reject(() => broker.issue(), 'revision_stale');
        fixture.setCurrentness(state()); mutate = () => {};
        const handle = broker.issue();
        assert.equal(handle, `pib_${'07'.repeat(16)}`);
        assert.equal(broker.consume({ handle }).status, 'available');
    } finally {
        if (prior) Object.defineProperty(Object.prototype, 'then', prior);
        else delete (Object.prototype as { then?: unknown }).then;
    }
    assert.equal(reads, 0);
});

test('does not reach forbidden concerns or reuse the Smart Import broker', () => {
    const source = readFileSync(new URL('./patient-insight-broker.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /typed-projection-broker|smart-import|provider-lifecycle|fetch\(/u);
    assert.doesNotMatch(source, /database|persist|writeFile|patientRef|sessionRef|route|apply\(/ui);
    assert.match(source, /ABA[\s\S]*P4[\s\S]*HOLD/u);
});
