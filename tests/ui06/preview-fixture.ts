/* @Codex UI06: PRESENTATION FIXTURE ONLY. No generation, authentic receipts or clinical validation. */
import { parseDocumentSynthesisPreviewWire, type DocumentSynthesisPreviewWire } from '../../lib/ai-providers/fabric/document-synthesis-preview-wire';

const model = 'ui06-synthetic-model';
export const syntheticPreview: DocumentSynthesisPreviewWire = {
    schemaVersion: 'mediflow.document-synthesis.preview-wire.v1', status: 'available',
    publication: {
        output: { schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Riepilogo interamente inventato UI06.', qualityLevel: 'yellow' },
        citations: [{ label: 'S1', quote: 'Passaggio interamente inventato UI06.', startByte: 0, endByte: 36, quoteSha256: 'a'.repeat(64) }],
        receipt: {
            schemaVersion: 'mediflow.document-synthesis.publication-receipt.v1', capability: 'document_synthesis',
            outputSha256: 'b'.repeat(64), claimCitationsDigestSha256: Array(32).fill(0), sourceSetDigestSha256: Array(32).fill(0),
            providerBindingReceipt: { schemaVersion: 'mediflow.document-synthesis.provider-binding.v1', capability: 'document_synthesis', registryTask: 'reasoning', provider: 'ollama', model, venue: 'local_process', egress: 'none', fallback: 'none', runtimeReadiness: 'required' },
            reviewOnly: true, applyPolicy: 'none', writesPerformed: 0,
        },
        provenance: {
            schemaVersion: 'mediflow.document-synthesis.publication-provenance.v1', capability: 'document_synthesis',
            sourceSetAuthority: 'application_host', inputDigestScope: 'ordered_normalized_provider_projection_set',
            citationSupport: 'provider_declared_host_membership_and_locator_validated', modelCausality: 'not_established',
            fabricProvenance: {
                schemaVersion: 'mediflow.ai.fabric-provenance.v1', capability: 'document_synthesis', venue: 'local_process', provider: 'ollama', model,
                preprocessing: ['context_minimization'],
                receipt: { schemaVersion: 'mediflow.ai.fabric-resolution.v1', capability: 'document_synthesis', class: 'generative', venue: 'local_process', egressProfile: { id: 'local_only', version: 'mediflow.ai.egress-profile.v1', egress: 'none' }, provider: 'ollama', model, fallbackCount: 0 },
            },
        },
    },
};
// Validate the display DTO with the actual parser. This does not authenticate these invented receipts.
if (!parseDocumentSynthesisPreviewWire(syntheticPreview)) throw new Error('UI06 fixture does not match the display wire');
