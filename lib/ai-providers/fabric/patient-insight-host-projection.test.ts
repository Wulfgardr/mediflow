/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createPatientInsightHostBoundary } from './patient-insight-host-boundary.ts';
import { createPatientInsightHostProjectionResolver } from './patient-insight-host-projection.ts';

const ref = (prefix: string) => `${prefix}_${'a'.repeat(32)}`;

function sources() {
    return {
        focus: { summary: 'synthetic follow-up' },
        conditions: [{ label: 'synthetic condition' }],
        activeTherapies: [{ label: 'synthetic therapy' }],
        recentEvents: [{ summary: 'synthetic review' }],
    };
}

test('maps canonical host sources to the minimized projection accepted by Patient Insight', () => {
    const resolver = createPatientInsightHostProjectionResolver();
    const input = sources();
    const projection = resolver.resolve(input);

    assert.deepEqual(projection, {
        schemaVersion: 'mediflow.patient-insight.projection.v1',
        clinicalFocus: 'synthetic follow-up',
        activeConditions: ['synthetic condition'],
        currentTherapies: ['synthetic therapy'],
        recentClinicalEvents: ['synthetic review'],
    });
    assert.ok(projection);
    assert.equal(Object.isFrozen(projection), true);
    assert.equal(Object.isFrozen(projection.activeConditions), true);

    const boundary = createPatientInsightHostBoundary({
        binding: { leaseRef: ref('lsr'), patientRef: ref('ptr'), selectionEpoch: 7 },
        receipt: { schemaVersion: 'mediflow.patient-insight.host-receipt.v1', reference: ref('receipt'), capability: 'patient_insight', authority: 'host_service', writesPerformed: 0, applyPolicy: 'none' },
        provenance: { schemaVersion: 'mediflow.patient-insight.host-provenance.v1', reference: ref('provenance'), capability: 'patient_insight', receiptRef: ref('receipt') },
    });
    assert.equal(boundary.prepare({ projection }).status, 'available');

    input.focus.summary = 'mutated';
    input.conditions[0].label = 'mutated';
    assert.deepEqual(projection, {
        schemaVersion: 'mediflow.patient-insight.projection.v1',
        clinicalFocus: 'synthetic follow-up',
        activeConditions: ['synthetic condition'],
        currentTherapies: ['synthetic therapy'],
        recentClinicalEvents: ['synthetic review'],
    });
});

test('fails closed for noncanonical, sensitive, authority, and hostile source input', () => {
    const resolver = createPatientInsightHostProjectionResolver();
    const accessor = sources();
    Object.defineProperty(accessor.focus, 'summary', { enumerable: true, get() { throw new Error('synthetic accessor'); } });
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
});

test('does not expose a provider, persistence, prompt, authority, or apply seam', () => {
    const source = readFileSync(new URL('./patient-insight-host-projection.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b(fetch|provider|persist|database|writeFile)\b/ui);
    assert.doesNotMatch(source, /prompt|authority|venue|egress|apply|fullName|taxCode/ui);
});
