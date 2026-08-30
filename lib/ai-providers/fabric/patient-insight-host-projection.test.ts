/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPatientInsightHostBoundary } from './patient-insight-host-boundary.ts';
import { createPatientInsightHostProjectionResolver } from './patient-insight-host-projection.ts';
const ref = (prefix: string) => `${prefix}_${'a'.repeat(32)}`;
const context = () => ({
    binding: { leaseRef: ref('lsr'), patientRef: ref('ptr'), selectionEpoch: 7 },
    receipt: { schemaVersion: 'mediflow.patient-insight.host-receipt.v1', reference: ref('receipt'), capability: 'patient_insight', authority: 'host_service', writesPerformed: 0, applyPolicy: 'none' },
    provenance: { schemaVersion: 'mediflow.patient-insight.host-provenance.v1', reference: ref('provenance'), capability: 'patient_insight', receiptRef: ref('receipt') },
});
const expectedProjection = {
    schemaVersion: 'mediflow.patient-insight.projection.v1', clinicalFocus: 'synthetic follow-up',
    activeConditions: ['synthetic condition'], currentTherapies: ['synthetic therapy'],
    recentClinicalEvents: ['synthetic review'],
};
function sources() {
    return {
        focus: { summary: 'synthetic follow-up' },
        conditions: [{ label: 'synthetic condition' }],
        activeTherapies: [{ label: 'synthetic therapy' }],
        recentEvents: [{ summary: 'synthetic review' }],
    };
}
function observedProxy<T extends object>(target: T, throwing: boolean) {
    let traps = 0;
    const observe = <R>(value: R): R => { traps += 1; if (throwing) throw new Error('synthetic proxy trap'); return value; };
    return {
        value: new Proxy(target, {
            get: (value, key, receiver) => observe(Reflect.get(value, key, receiver)),
            getPrototypeOf: (value) => observe(Reflect.getPrototypeOf(value)),
            ownKeys: (value) => observe(Reflect.ownKeys(value)),
            getOwnPropertyDescriptor: (value, key) => observe(Reflect.getOwnPropertyDescriptor(value, key)),
        }),
        traps: () => traps,
    };
}
test('maps canonical host sources to the minimized projection accepted by Patient Insight', () => {
    const resolver = createPatientInsightHostProjectionResolver();
    const input = sources();
    const projection = resolver.resolve(input);
    assert.deepEqual(projection, expectedProjection);
    assert.ok(projection);
    assert.equal(Object.isFrozen(projection), true);
    assert.equal(Object.isFrozen(projection.activeConditions), true);
    const boundary = createPatientInsightHostBoundary(context());
    assert.equal(boundary.prepare({ projection }).status, 'available');
    input.focus.summary = 'mutated';
    input.conditions[0].label = 'mutated';
    assert.deepEqual(projection, expectedProjection);
});
test('rejects every proxied PI host record and array seam without reflection', () => {
    const resolver = createPatientInsightHostProjectionResolver();
    const sourceSeams = [
        () => { const target = sources(); return { target, run: (value: object) => resolver.resolve(value) }; },
        () => { const input = sources(); return { target: input.focus, run: (value: object) => resolver.resolve({ ...input, focus: value }) }; },
        () => { const input = sources(); return { target: input.conditions, run: (value: object) => resolver.resolve({ ...input, conditions: value }) }; },
        () => { const input = sources(); return { target: input.conditions[0], run: (value: object) => resolver.resolve({ ...input, conditions: [value] }) }; },
        () => { const input = sources(); return { target: input.activeTherapies, run: (value: object) => resolver.resolve({ ...input, activeTherapies: value }) }; },
        () => { const input = sources(); return { target: input.activeTherapies[0], run: (value: object) => resolver.resolve({ ...input, activeTherapies: [value] }) }; },
        () => { const input = sources(); return { target: input.recentEvents, run: (value: object) => resolver.resolve({ ...input, recentEvents: value }) }; },
        () => { const input = sources(); return { target: input.recentEvents[0], run: (value: object) => resolver.resolve({ ...input, recentEvents: [value] }) }; },
    ];
    const boundarySeams = [
        () => { const target = context(); return { target, run: (value: object) => assert.throws(() => createPatientInsightHostBoundary(value)) }; },
        ...(['binding', 'receipt', 'provenance'] as const).map((key) => () => { const input = context(); return { target: input[key], run: (value: object) => assert.throws(() => createPatientInsightHostBoundary({ ...input, [key]: value })) }; }),
        () => { const boundary = createPatientInsightHostBoundary(context()); const target = { projection: { schemaVersion: 'mediflow.patient-insight.projection.v1', clinicalFocus: 'synthetic follow-up', activeConditions: ['synthetic condition'], currentTherapies: ['synthetic therapy'], recentClinicalEvents: ['synthetic review'] } }; return { target, run: (value: object) => assert.equal(boundary.prepare(value).status, 'denied') }; },
        ...(['projection', 'activeConditions', 'currentTherapies', 'recentClinicalEvents'] as const).map((key) => () => { const boundary = createPatientInsightHostBoundary(context()); const request = { projection: { schemaVersion: 'mediflow.patient-insight.projection.v1', clinicalFocus: 'synthetic follow-up', activeConditions: ['synthetic condition'], currentTherapies: ['synthetic therapy'], recentClinicalEvents: ['synthetic review'] } }; const target = key === 'projection' ? request.projection : request.projection[key]; return { target, run: (value: object) => assert.equal(boundary.prepare(key === 'projection' ? { projection: value } : { projection: { ...request.projection, [key]: value } }).status, 'denied') }; }),
    ];
    for (const make of [...sourceSeams, ...boundarySeams]) for (const throwing of [false, true]) {
        const seam = make(); const proxy = observedProxy(seam.target, throwing); seam.run(proxy.value); assert.equal(proxy.traps(), 0);
    }
});
test('fails closed for noncanonical, sensitive, authority, and hostile source input', () => {
    const resolver = createPatientInsightHostProjectionResolver();
    let accessorReads = 0; const accessor = sources();
    Object.defineProperty(accessor.focus, 'summary', { enumerable: true, get() { accessorReads += 1; throw new Error('synthetic accessor'); } });
    const inherited = Object.create({ label: 'synthetic inherited' });
    const prototype = sources();
    prototype.conditions = [inherited];
    for (const value of [
        { ...sources(), prompt: 'caller prompt' },
        { ...sources(), fullName: 'Synthetic Name' },
        { ...sources(), taxCode: 'SYNTHETIC0000000' },
        { ...sources(), authority: 'physician' },
        { ...sources(), provider: 'caller-provider' },
        { ...sources(), venue: 'cloud' },
        { ...sources(), egress: 'enabled' },
        { ...sources(), apply: 'allowed' },
        { ...sources(), focus: { summary: 'synthetic follow-up', fullName: 'Synthetic Name' } },
        { ...sources(), conditions: [{ label: 'synthetic condition', taxCode: 'SYNTHETIC0000000' }] },
        accessor,
        prototype,
        Object.create(sources()),
    ]) assert.equal(resolver.resolve(value), null);
    assert.equal(accessorReads, 0);
});
test('does not read an ambient then getter at the PI host seams', () => {
    let reads = 0; const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } });
    try {
        const projection = createPatientInsightHostProjectionResolver().resolve(sources()); assert.ok(projection);
        assert.equal(createPatientInsightHostBoundary(context()).prepare({ projection }).status, 'available');
    } finally { if (prior) Object.defineProperty(Object.prototype, 'then', prior); else delete (Object.prototype as { then?: unknown }).then; }
    assert.equal(reads, 0);
});
test('does not expose a provider, persistence, prompt, authority, or apply seam', () => {
    const source = readFileSync(new URL('./patient-insight-host-projection.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b(fetch|provider|persist|database|writeFile)\b/ui);
    assert.doesNotMatch(source, /prompt|authority|venue|egress|apply|fullName|taxCode/ui);
});
