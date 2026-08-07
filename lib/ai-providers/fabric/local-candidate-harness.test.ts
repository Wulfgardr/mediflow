/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ClinicalInteractionError,
    advanceClinicalReview,
    createClinicalProposal,
    declareUncertainty,
} from './clinical-interaction.ts';
import {
    verifyLocalCandidateEnvelope,
    type LocalCandidateReviewedEnvelope,
} from './local-candidate-envelope.ts';
import {
    runLocalCandidateHarness,
} from './local-candidate-harness.ts';

test('lega routing, receipt, provenance e review del medico senza scrittura', () => {
    const report = runLocalCandidateHarness();

    assert.equal(report.classification, 'synthetic_contract_harness');
    assert.equal(report.decisions.localProcess.outcome, 'resolved');
    assert.equal(report.decisions.localProcess.receipt?.provider, 'ollama');
    assert.equal(report.decisions.homeBaseTrusted.outcome, 'resolved');
    assert.equal(report.reviewed.proposal.review, 'accepted');
    assert.equal(report.reviewed.writesPerformed, 0);
    assert.equal(verifyLocalCandidateEnvelope(report.reviewed), true);
    assert.equal(report.reviewed.routing.receipt, report.reviewed.provenance.receipt);
    assert.equal(
        report.reviewed.proposal.provenanceRef,
        report.reviewed.provenanceRef,
    );
    assert.equal(report.invariants.physicianReviewRequired, true);
    assert.equal(report.invariants.clinicalWriteAuthorized, false);
});

test('nega revoca, degrado, offline e reconnessione senza fallback', () => {
    const { decisions } = runLocalCandidateHarness();
    const expected = [
        [decisions.localProcessOffline, 'venue_offline'],
        [decisions.providerDegraded, 'provider_lifecycle_unavailable'],
        [decisions.providerRevoked, 'provider_lifecycle_unavailable'],
        [decisions.homeBaseRevoked, 'paired_trust_denied'],
        [decisions.homeBaseSessionExpired, 'paired_trust_denied'],
        [decisions.onDevice, 'venue_unknown'],
        [decisions.cloud, 'venue_offline'],
    ] as const;

    for (const [decision, denialCode] of expected) {
        assert.equal(decision.outcome, 'denied');
        assert.equal(decision.denialCode, denialCode);
        assert.equal(decision.receipt, null);
        assert.equal(decision.fallback, 'denied_by_contract');
    }
    assert.deepEqual(
        decisions.onDevice.observations,
        [{ venue: 'on_device', state: 'unknown', reason: 'not_implemented' }],
    );
    assert.deepEqual(
        decisions.cloud.observations,
        [{ venue: 'cloud', state: 'offline', reason: 'egress_profile_closed' }],
    );
});

test('mantiene il core deterministico disponibile senza provider AI', () => {
    const report = runLocalCandidateHarness();

    assert.equal(report.decisions.nonAiCore.outcome, 'resolved');
    assert.equal(report.decisions.nonAiCore.receipt?.provider, 'in_house');
    assert.equal(report.decisions.nonAiCore.receipt?.model, null);
    assert.equal(report.invariants.coreNonAiAvailable, true);
    assert.equal(report.invariants.egressGateOpen, false);
    assert.equal(report.invariants.pairedExecutionGranted, false);
    assert.equal(report.invariants.allFallbacksDenied, true);
});

test('rifiuta accettazione applicativa e envelope con provenance scollegata', () => {
    const report = runLocalCandidateHarness();
    const pending = createClinicalProposal({
        capability: report.reviewed.provenance.capability,
        provenanceRef: report.reviewed.provenanceRef,
        uncertainty: declareUncertainty('medium'),
        completeness: {
            unreadableFields: [],
            missingFields: [],
        },
        pendingWork: [],
    });
    const previewed = advanceClinicalReview(pending, {
        type: 'preview',
        actor: 'physician',
    });

    assert.throws(
        () => advanceClinicalReview(previewed, {
            type: 'accept',
            actor: 'application',
            uncertaintyAcknowledged: true,
        }),
        (error) => error instanceof ClinicalInteractionError
            && error.code === 'actor_forbidden',
    );
    assert.equal(verifyLocalCandidateEnvelope({
        ...report.reviewed,
        provenanceRef: 'synthetic-forged-provenance',
    } as LocalCandidateReviewedEnvelope), false);
});

test('il report e congelato e non serializza endpoint, token o payload', () => {
    const report = runLocalCandidateHarness();
    const serialized = JSON.stringify(report);
    const keys = new Set<string>();
    const collectKeys = (value: unknown): void => {
        if (Array.isArray(value)) {
            for (const item of value) collectKeys(item);
            return;
        }
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            keys.add(key);
            collectKeys(child);
        }
    };
    collectKeys(report);

    assert.equal(Object.isFrozen(report), true);
    assert.equal(Object.isFrozen(report.provider), true);
    assert.equal(Object.isFrozen(report.decisions), true);
    assert.equal(Object.isFrozen(report.invariants), true);
    assert.equal(serialized.includes('127.0.0.1'), false);
    assert.equal(keys.has('endpoint'), false);
    assert.equal(keys.has('token'), false);
    assert.equal(keys.has('payload'), false);
    assert.equal(keys.has('secret'), false);
});
