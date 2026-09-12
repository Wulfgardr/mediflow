/* @Codex — remote content, ORIGINAL source-set lease and final owner CAS. */
import 'server-only';
import { createDocumentSynthesisSourceSetLease } from './document-synthesis-source-set-lease';
import { digestDocumentSynthesisClaimCitations } from './document-synthesis-claim-citations-digest';
import { createDocumentSynthesisOrdinaryTaskProfile, readOrdinaryTaskProfile, readOrdinaryDocumentEnvelope } from '../../chatgpt-execution/ordinary-task-profile';
import { executeOwnedOrdinaryProfile, ordinaryResultMetadata } from '../../chatgpt-product/ordinary-flow';
export async function executeDocumentSynthesisChatGpt(configuration: unknown, sourceSet: unknown, current: () => boolean): Promise<unknown> {
    const lease = createDocumentSynthesisSourceSetLease(configuration);
    try {
        const issued = lease.issue(); const execution = issued && lease.beginExecution(issued);
        const input = execution && lease.takeProviderInput(execution);
        if (!execution || !input || !current()) return null;
        const profile = createDocumentSynthesisOrdinaryTaskProfile(sourceSet);
        if (readOrdinaryTaskProfile(profile).prompt !== input.prompt) return null;
        const result = await executeOwnedOrdinaryProfile('document_synthesis', profile, current);
        const envelopeToken = readOrdinaryDocumentEnvelope(result.output);
        if (!envelopeToken || !current()) return null;
        const validation = lease.validateProviderEnvelope(Object.freeze({ executionToken: execution, envelopeToken }));
        if (validation.status !== 'available') return null;
        const digest = digestDocumentSynthesisClaimCitations(validation);
        if (!digest) return null;
        const remote = ordinaryResultMetadata(result);
        // Compute immutable publication before consume; the last step is the
        // same source/selection/review-context CAS as the local path.
        const publication = Object.freeze({ schemaVersion: 'mediflow.document-synthesis.publication.v1',
            output: validation.output, citations: validation.citations, claims: validation.claims,
            receipt: Object.freeze({ schemaVersion: 'mediflow.document-synthesis.publication-receipt.v1', capability: 'document_synthesis',
                outputSha256: validation.outputSha256, claimCitationsDigestSha256: digest, sourceSetDigestSha256: validation.sourceSetDigestSha256,
                providerBindingReceipt: remote.receipt, reviewOnly: true, applyPolicy: 'none', writesPerformed: 0 }),
            provenance: Object.freeze({ schemaVersion: 'mediflow.document-synthesis.publication-provenance.v1', capability: 'document_synthesis',
                sourceSetAuthority: 'application_host', inputDigestScope: 'ordered_normalized_provider_projection_set',
                citationSupport: 'provider_declared_host_membership_and_locator_validated', modelCausality: 'not_established', fabricProvenance: remote.provenance }) });
        return current() && lease.consume(execution) ? publication : null;
    } finally { lease.dispose(); }
}
