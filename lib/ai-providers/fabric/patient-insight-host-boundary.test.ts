/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildPatientInsightPrompt, createPatientInsightHostBoundary } from './patient-insight-host-boundary.ts';

const ref = (prefix: string) => `${prefix}_${'a'.repeat(32)}`;
const context = () => ({
    binding: { leaseRef: ref('lease'), patientRef: ref('patient'), selectionEpoch: 7 },
    receipt: { schemaVersion: 'mediflow.patient-insight.host-receipt.v1', reference: ref('receipt'), capability: 'patient_insight', authority: 'host_service', writesPerformed: 0, applyPolicy: 'none' },
    provenance: { schemaVersion: 'mediflow.patient-insight.host-provenance.v1', reference: ref('provenance'), capability: 'patient_insight', receiptRef: ref('receipt') },
});
const request = () => ({ projection: { schemaVersion: 'mediflow.patient-insight.projection.v1', clinicalFocus: 'synthetic follow-up', activeConditions: ['synthetic condition'], currentTherapies: ['synthetic therapy'], recentClinicalEvents: ['synthetic review'] } });

test('prepares a frozen review-only proposal from an allowlisted minimized projection', () => {
    const boundary = createPatientInsightHostBoundary(context()); const input = request(); const result = boundary.prepare(input);
    assert.equal(result.status, 'available'); if (result.status !== 'available') return;
    assert.equal(result.writesPerformed, 0); assert.equal(result.applyPolicy, 'none'); assert.equal(result.proposal.reviewOnly, true);
    assert.deepEqual([result.receiptReference, result.provenanceReference], [ref('receipt'), ref('provenance')]);
    assert.deepEqual(Object.keys(result), ['status', 'writesPerformed', 'applyPolicy', 'receiptReference', 'provenanceReference', 'proposal']);
    assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.proposal), true);
    assert.equal(buildPatientInsightPrompt(input.projection), buildPatientInsightPrompt(request().projection));
    input.projection.clinicalFocus = 'mutated'; input.projection.activeConditions[0] = 'mutated';
    assert.equal(result.proposal.promptFingerprint, 'pi_223cbf9d');
});

test('rejects free prompt, identity, patient, extra-key, accessor, and prototype inputs', () => {
    const boundary = createPatientInsightHostBoundary(context());
    const accessor = request(); Object.defineProperty(accessor.projection, 'clinicalFocus', { enumerable: true, get() { throw new Error('synthetic accessor'); } });
    const inherited = Object.create({ clinicalFocus: 'synthetic inherited' }); Object.assign(inherited, request().projection); delete inherited.clinicalFocus;
    for (const value of [
        { ...request(), prompt: 'caller prompt' }, { ...request(), callerIdentity: 'synthetic agent' }, { ...request(), patientId: 'synthetic-patient' },
        { projection: { ...request().projection, fullName: 'Synthetic Name' } }, { projection: { ...request().projection, taxCode: 'SYNTHETIC' } },
        { projection: { ...request().projection, extra: true } }, accessor, { projection: inherited },
    ]) assert.deepEqual(boundary.prepare(value), { status: 'denied', code: 'input_invalid', writesPerformed: 0, applyPolicy: 'none' });
});

test('rejects malformed host receipt, provenance, opaque binding, and authority unions', () => {
    const invalid = [
        { ...context(), receipt: { ...context().receipt, reference: 'receipt_short' } },
        { ...context(), receipt: { ...context().receipt, authority: 'host_service|physician' } },
        { ...context(), receipt: { ...context().receipt, applyPolicy: 'apply' } },
        { ...context(), provenance: { ...context().provenance, receiptRef: ref('other') } },
        { ...context(), binding: { ...context().binding, patientRef: 'Synthetic Name' } },
    ];
    for (const value of invalid) assert.throws(() => createPatientInsightHostBoundary(value));
});

test('contains no provider, persistence, free prompt, or apply path', () => {
    const source = readFileSync(new URL('./patient-insight-host-boundary.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b(fetch|provider|persist|database|writeFile)\b/ui);
    assert.doesNotMatch(source, /callerIdentity|patientId|fullName|taxCode/ui);
});
