import {
    buildPatientInsightPreviewRequest,
    type PatientInsightPreviewRequest,
} from './ai-providers/fabric/patient-insight-preview-contract';

type CaptureInput = Parameters<typeof buildPatientInsightPreviewRequest>[0];

/* A proposal is current only while a request made now would send the same
   sources it was generated from: same patient, same revision, same minimized
   profile, therapies and diary events. requestId and capturedAt never count. */
export function patientInsightSourceSignature(request: Pick<PatientInsightPreviewRequest, 'patientId' | 'patientRevision' | 'sources'>): string {
    return JSON.stringify([request.patientId, request.patientRevision, request.sources]);
}

export function currentPatientInsightSourceSignature(input: Omit<CaptureInput, 'requestId' | 'capturedAt'>): string | null {
    try {
        return patientInsightSourceSignature(buildPatientInsightPreviewRequest({
            ...input,
            requestId: 'pi_source_signature_probe',
            capturedAt: new Date(0).toISOString(),
        }));
    } catch {
        return null;
    }
}
