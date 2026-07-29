/* @Codex */
import {
    advanceClinicalReview,
    createClinicalProposal,
    declareUncertainty,
    type ClinicalProposal,
} from './clinical-interaction';
import type {
    CandidateRoutingDecision,
    CandidateRoutingResult,
} from './candidate-router';
import type { FabricProvenanceRecord } from './contract';
import { buildProvenanceRecord } from './resolver';

export type LocalCandidateReviewedEnvelope = Readonly<{
    routing: CandidateRoutingDecision;
    provenanceRef: string;
    provenance: FabricProvenanceRecord;
    proposal: ClinicalProposal;
    writesPerformed: 0;
}>;

function provenanceRefFor(
    requestId: string,
    provenance: FabricProvenanceRecord,
): string {
    return [
        'mediflow.ai.provenance.v1',
        requestId,
        provenance.capability,
        provenance.venue,
        provenance.provider,
    ].join(':');
}

export function buildReviewedCandidateEnvelope(
    routingResult: CandidateRoutingResult,
    requestId: string,
): LocalCandidateReviewedEnvelope {
    if (routingResult.decision.outcome !== 'resolved' || routingResult.resolution === null) {
        throw new Error(`Synthetic Fabric scenario did not resolve: ${requestId}`);
    }
    const provenance = buildProvenanceRecord(
        routingResult.resolution,
        ['context_minimization'],
    );
    const provenanceRef = provenanceRefFor(requestId, provenance);
    const proposal = createClinicalProposal({
        capability: provenance.capability,
        provenanceRef,
        uncertainty: declareUncertainty('medium'),
        completeness: {
            unreadableFields: [],
            missingFields: [],
        },
        pendingWork: [{
            kind: 'manual_review',
            sourceRef: {
                type: 'synthetic_candidate',
                id: requestId,
            },
        }],
    });
    const previewed = advanceClinicalReview(proposal, {
        type: 'preview',
        actor: 'physician',
    });
    const accepted = advanceClinicalReview(previewed, {
        type: 'accept',
        actor: 'physician',
        uncertaintyAcknowledged: true,
    });

    return Object.freeze({
        routing: routingResult.decision,
        provenanceRef,
        provenance,
        proposal: accepted,
        writesPerformed: 0,
    });
}

export function verifyLocalCandidateEnvelope(
    envelope: LocalCandidateReviewedEnvelope,
): boolean {
    return envelope.routing.outcome === 'resolved'
        && envelope.routing.receipt !== null
        && envelope.routing.receipt === envelope.provenance.receipt
        && envelope.routing.capability === envelope.provenance.capability
        && envelope.provenanceRef === provenanceRefFor(
            envelope.routing.requestId,
            envelope.provenance,
        )
        && envelope.proposal.capability === envelope.provenance.capability
        && envelope.proposal.provenanceRef === envelope.provenanceRef
        && envelope.proposal.review === 'accepted'
        && envelope.writesPerformed === 0;
}
