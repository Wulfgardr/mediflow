/* @Codex */
import type { FabricCapabilityDescriptor, GenerativeCapabilityId } from './contract';

const GENERATIVE_VENUES = Object.freeze(['local_process', 'home_base'] as const);

function descriptor(
    id: GenerativeCapabilityId,
    operation: FabricCapabilityDescriptor['operation'],
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
        killSwitch,
        contractSchema,
        entryPoint,
    });
}

export const GENERATIVE_CAPABILITY_DESCRIPTORS: Readonly<
    Record<GenerativeCapabilityId, FabricCapabilityDescriptor>
> = Object.freeze({
    patient_insight: descriptor('patient_insight', 'synthesis', 'aiPatientInsightKillSwitch',
        'mediflow.ai.extract.v1', 'lib/ai-summary-service.ts'),
    smart_import: descriptor('smart_import', 'extraction', 'aiSmartImportKillSwitch',
        'mediflow.ai.extract.v1', 'app/api/patients/[id]/smart-import/route.ts'),
    document_synthesis: descriptor('document_synthesis', 'synthesis', 'aiDocumentSynthesisKillSwitch',
        'mediflow.ai.extract.v1', 'lib/domain/documents/document-synthesis-service.ts'),
    ocr: descriptor('ocr', 'ocr', 'aiOcrKillSwitch', null, 'app/api/ocr/extract/route.ts'),
    treatment_reasoning: descriptor('treatment_reasoning', 'reasoning',
        'aiTreatmentReasoningKillSwitch', 'mediflow.treatment_reasoning.v1',
        'lib/treatment-reasoning-service.ts'),
});
