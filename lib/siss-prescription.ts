/* @Codex */
import type { SissTransport, SissTransportMode } from './siss-adapter';
/* @Codex */
import { createSissPatientContextHandoff, SissPatientContextError } from './siss-patient-context';

/* @Codex */
export type SissPrescriptionHandoffResult = {
    status: 'handoff';
    mode: SissTransportMode;
    handoffUrl: string;
    clipboardText: string | null;
    correlationId: string;
    message: string;
};

/* @Codex */
export class SissPrescriptionError extends Error {
    readonly code: 'SISS_PATIENT_NOT_READY' | 'SISS_HANDOFF_FAILED';
    readonly status: number;
    readonly correlationId: string | null;

    constructor(
        message: string,
        options: {
            code: 'SISS_PATIENT_NOT_READY' | 'SISS_HANDOFF_FAILED';
            status: number;
            correlationId?: string | null;
        },
    ) {
        super(message);
        this.name = 'SissPrescriptionError';
        this.code = options.code;
        this.status = options.status;
        this.correlationId = options.correlationId ?? null;
    }
}

/* @Codex */
export async function createSissPrescriptionHandoff(
    input: {
        patientId: string;
        patientTaxCode: string | null | undefined;
    },
    deps: {
        transport?: SissTransport;
    } = {},
): Promise<SissPrescriptionHandoffResult> {
    try {
        const result = await createSissPatientContextHandoff(
            {
                patientId: input.patientId,
                patientTaxCode: input.patientTaxCode,
                action: 'prescription.create',
            },
            {
                transport: deps.transport,
            },
        );

        return {
            status: 'handoff',
            mode: result.mode,
            handoffUrl: result.handoffUrl,
            clipboardText: result.clipboardText,
            correlationId: result.correlationId,
            message: result.message,
        };
    } catch (error) {
        if (error instanceof SissPrescriptionError) {
            throw error;
        }

        if (error instanceof SissPatientContextError) {
            throw new SissPrescriptionError(error.message, {
                code: error.code,
                status: error.status,
                correlationId: error.correlationId,
            });
        }

        throw new SissPrescriptionError('Errore inatteso nel flusso SISS.', {
            code: 'SISS_HANDOFF_FAILED',
            status: 500,
        });
    }
}
