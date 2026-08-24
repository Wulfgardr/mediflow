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

test('rejects callable Proxy dependencies and entropy results before any trap runs', () => {
    const callableProxy = (sideEffects: { value: number }): (() => boolean) => new Proxy(() => false, {
        apply() { sideEffects.value += 1; throw new Error('synthetic callable Proxy'); },
        get() { sideEffects.value += 1; throw new Error('synthetic callable Proxy'); },
    });
    for (const dependency of ['readCurrentness', 'readSources', 'clock', 'entropy'] as const) {
        const sideEffects = { value: 0 };
        reject(() => createPatientInsightBroker(host({ [dependency]: callableProxy(sideEffects) } as never).value), 'input_invalid');
        assert.equal(sideEffects.value, 0, `${dependency} Proxy must not run`);
    }
    const prepareSideEffects = { value: 0 };
    reject(() => createPatientInsightBroker(host({ boundary: Object.freeze({ prepare: callableProxy(prepareSideEffects) }) as never }).value), 'input_invalid');
    assert.equal(prepareSideEffects.value, 0, 'prepare Proxy must not run');

    const revokedSideEffects = { value: 0 };
    const revokedBroker = createPatientInsightBroker(host({
        readCurrentness: () => Object.freeze({ selectionEpoch: 7, revision: 3, freshnessToken: 'fresh_token_0123456789abcdef', isRevoked: callableProxy(revokedSideEffects) }),
    }).value);
    reject(() => revokedBroker.issue(), 'dependency_unavailable');
    assert.equal(revokedSideEffects.value, 0, 'isRevoked Proxy must not run');

    let entropyCalls = 0; const entropyResultSideEffects = { value: 0 };
    const entropyBroker = createPatientInsightBroker(host({
        entropy: () => { entropyCalls += 1; return new Proxy(new Uint8Array(16), { get() { entropyResultSideEffects.value += 1; throw new Error('synthetic entropy result Proxy'); } }); },
    }).value);
    reject(() => entropyBroker.issue(), 'dependency_unavailable');
    assert.equal(entropyCalls, 1, 'entropy is invoked exactly once');
    assert.equal(entropyResultSideEffects.value, 0, 'entropy Proxy result must not be reflected or read');
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
