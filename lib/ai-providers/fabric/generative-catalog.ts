/* @Codex */
import type { FabricCapabilityDescriptor, GenerativeCapabilityId } from './contract';

const GENERATIVE_VENUES = Object.freeze(['local_process', 'home_base'] as const);
const NO_VENUES = Object.freeze([] as const);

function descriptor(
    id: GenerativeCapabilityId,
    operation: FabricCapabilityDescriptor['operation'],
    availabilityDisposition: FabricCapabilityDescriptor['availabilityDisposition'],
    killSwitch: string,
    contractSchema: string | null,
    entryPoint: string,
): FabricCapabilityDescriptor {
    return Object.freeze({
        id,
        class: 'generative',
        operation,
        authorityPlane: 'clinical_application',
        dataClass: 'clinical',
        venues: GENERATIVE_VENUES,
        egressProfileId: 'local_only',
        review: 'review_first',
        availabilityDisposition,
        killSwitch,
        contractSchema,
        entryPoint,
    });
}

export const GENERATIVE_CAPABILITY_DESCRIPTORS: Readonly<
    Record<GenerativeCapabilityId, FabricCapabilityDescriptor>
> = Object.freeze({
    patient_insight: descriptor('patient_insight', 'synthesis', 'proposal_only', 'aiPatientInsightKillSwitch',
        'mediflow.ai.extract.v1', 'lib/ai-summary-service.ts'),
    smart_import: descriptor('smart_import', 'extraction', 'proposal_only', 'aiSmartImportKillSwitch',
        'mediflow.ai.extract.v1', 'app/api/ai/smart-import/preview/route.ts'),
    document_synthesis: descriptor('document_synthesis', 'synthesis', 'proposal_only', 'aiDocumentSynthesisKillSwitch',
        'mediflow.ai.extract.v1', 'lib/domain/documents/document-synthesis-service.ts'),
    ocr: Object.freeze({
        id: 'ocr',
        class: 'generative',
        operation: 'ocr',
        authorityPlane: 'clinical_application',
        dataClass: 'clinical',
        venues: NO_VENUES,
        egressProfileId: 'local_only',
        review: 'review_first',
        availabilityDisposition: 'unavailable',
        killSwitch: null,
        contractSchema: null,
        entryPoint: null,
    }),
    treatment_reasoning: descriptor('treatment_reasoning', 'reasoning', 'proposal_only',
        'aiTreatmentReasoningKillSwitch', 'mediflow.treatment_reasoning.v1',
        'lib/treatment-reasoning-service.ts'),
});
