/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    issueCapabilityAttestation,
    verifyCapabilityAttestation,
    type CapabilityAttestation,
    type CapabilityAttestationClaims,
    type CapabilityAttestationFailure,
    type ExpectedCapabilityBinding,
} from './capability-attestation.ts';
import { assessAiLaneReadiness } from './readiness.ts';
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const NOW = new Date('2030-01-02T00:00:00.000Z');
const BASE_CLAIMS: CapabilityAttestationClaims = {
    schemaVersion: 'mediflow.ai.capability-attestation.v1',
    lane: 'patient_insight',
    modelDigest: DIGEST_A,
    authorityPlane: 'clinical_application',
    issuer: 'synthetic-test-issuer',
    evidenceRef: 'local:synthetic/capability-case-pack',
    issuedAt: '2030-01-01T00:00:00.000Z',
    expiresAt: '2030-01-03T00:00:00.000Z',
};
const VERIFIED_EVIDENCE_REFS = new Set([BASE_CLAIMS.evidenceRef]);
const BASE_BINDING: ExpectedCapabilityBinding = {
    lane: 'patient_insight', modelDigest: DIGEST_A, authorityPlane: 'clinical_application',
};
function attest(overrides: Partial<CapabilityAttestationClaims> = {}): CapabilityAttestation {
    return issueCapabilityAttestation({ ...BASE_CLAIMS, ...overrides });
}
test('rende ready solo l attestazione integra per la stessa lane, digest e plane', () => {
    const readiness = assessAiLaneReadiness({
        binding: BASE_BINDING, attestation: attest(), now: NOW,
        locallyVerifiedEvidenceRefs: VERIFIED_EVIDENCE_REFS,
    });
    assert.equal(readiness.status, 'ready');
});
type RejectCase = {
    name: string; reason: CapabilityAttestationFailure; candidate?: unknown;
    binding?: ExpectedCapabilityBinding; now?: Date;
    evidence?: ReadonlySet<string> | null;
    issueClaims?: CapabilityAttestationClaims;
    readiness?: boolean;
};
const valid = attest();
function descriptorPair(descriptor: PropertyDescriptor) {
    const issueClaims = { ...BASE_CLAIMS };
    const candidate = { ...valid };
    Object.defineProperty(issueClaims, 'lane', descriptor);
    Object.defineProperty(candidate, 'lane', descriptor);
    return { issueClaims, candidate };
}
let accessorReads = 0;
const accessor = descriptorPair({
    enumerable: true,
    get: () => accessorReads++ === 0 ? 'patient_insight' : 'treatment_reasoning',
});
const nonEnumerable = descriptorPair({ enumerable: false, value: 'patient_insight' });
const revoked = Proxy.revocable(valid, {});
revoked.revoke();
const throwingProxy = new Proxy(valid, { ownKeys: () => { throw new Error('synthetic reflection failure'); } });
const REJECT_CASES: RejectCase[] = [
    { name: 'lane diversa', reason: 'lane_mismatch', binding: { ...BASE_BINDING, lane: 'smart_import' } },
    { name: 'plane engineering nel piano clinico', reason: 'authority_plane_mismatch', candidate: attest({ authorityPlane: 'engineering_operator' }) },
    { name: 'digest diverso', reason: 'model_digest_mismatch', binding: { ...BASE_BINDING, modelDigest: DIGEST_B } },
    { name: 'attestazione scaduta', reason: 'expired', candidate: attest({ expiresAt: NOW.toISOString() }) },
    { name: 'rappresentazione manomessa', reason: 'integrity_mismatch', candidate: { ...valid, issuer: 'tampered-synthetic-issuer' } },
    { name: 'evidenceRef non verificato', reason: 'evidence_unverified', evidence: null },
    { name: 'now non valido', reason: 'invalid_time_window', now: new Date('invalid') },
    { name: 'lane runtime sconosciuta', reason: 'invalid_claims', candidate: { ...valid, lane: 'exfiltration_lane' } },
    { name: 'plane runtime sconosciuto', reason: 'invalid_claims', candidate: { ...valid, authorityPlane: 'unknown_plane' } },
    { name: 'signature non stringa', reason: 'invalid_claims', candidate: { ...valid, signature: 42 } },
    { name: 'proprieta inattesa', reason: 'invalid_claims', candidate: { ...valid, unexpected: 'synthetic' } },
    { name: 'non ancora valida', reason: 'not_yet_valid', now: new Date('2029-12-31T00:00:00.000Z') },
    { name: 'finestra temporale non valida', reason: 'invalid_time_window', candidate: { ...valid, expiresAt: valid.issuedAt } },
    { name: 'accessor dinamico', reason: 'invalid_claims', ...accessor },
    { name: 'claim obbligatoria non enumerabile', reason: 'invalid_claims', ...nonEnumerable },
    { name: 'Proxy revocata', reason: 'invalid_claims', candidate: revoked.proxy, readiness: true },
    { name: 'Proxy ownKeys che lancia', reason: 'invalid_claims', candidate: throwingProxy, readiness: true },
];
for (const scenario of REJECT_CASES) {
    test(`rifiuta ${scenario.name}`, () => {
        const result = verifyCapabilityAttestation(
            scenario.candidate ?? valid, scenario.binding ?? BASE_BINDING, scenario.now ?? NOW,
            scenario.evidence === null ? undefined : scenario.evidence ?? VERIFIED_EVIDENCE_REFS,
        );
        assert.deepEqual(result, { valid: false, reason: scenario.reason });
        if (scenario.issueClaims) assert.throws(() => issueCapabilityAttestation(scenario.issueClaims!));
        if (scenario.name === 'accessor dinamico') assert.equal(accessorReads, 0);
        if (scenario.readiness) {
            const readiness = assessAiLaneReadiness({ binding: BASE_BINDING,
                attestation: scenario.candidate as CapabilityAttestation, now: NOW });
            assert.deepEqual(readiness, { status: 'blocked', binding: BASE_BINDING, reason: 'invalid_claims' });
        }
    });
}
test('issuer rifiuta enum runtime sconosciuti', () => {
    assert.throws(() => attest({ lane: 'exfiltration_lane' as never }));
    assert.throws(() => attest({ authorityPlane: 'unknown_plane' as never }));
});
test('senza attestazione resta fail-closed e mai ready', () => {
    const readiness = assessAiLaneReadiness({ binding: BASE_BINDING, now: NOW });
    assert.deepEqual(readiness, { status: 'blocked', binding: BASE_BINDING, reason: 'attestation_absent' });
});
test('readiness congela risultato e snapshot del binding', () => {
    const binding = { ...BASE_BINDING };
    const readiness = assessAiLaneReadiness({
        binding, attestation: valid, now: NOW,
        locallyVerifiedEvidenceRefs: VERIFIED_EVIDENCE_REFS,
    });
    binding.lane = 'smart_import';
    assert.equal(readiness.binding.lane, 'patient_insight');
    assert.equal(Object.isFrozen(readiness), true);
    assert.equal(Object.isFrozen(readiness.binding), true);
    assert.throws(() => Object.assign(readiness, { status: 'blocked' }));
    assert.throws(() => Object.assign(readiness.binding, { lane: 'smart_import' }));
});
