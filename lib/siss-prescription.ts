/* @Codex */
import {
    createSissPortalHandoffTransport,
    executeSissAdapterRequest,
    SissAdapterError,
    type SissTransport,
    type SissTransportMode,
} from './siss-adapter';

/* @Codex */
export type SissPrescriptionHandoffResult = {
    status: 'handoff';
    mode: SissTransportMode;
    handoffUrl: string;
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
    if (!input.patientId.trim()) {
        throw new SissPrescriptionError('Paziente non valido per la richiesta SISS.', {
            code: 'SISS_PATIENT_NOT_READY',
            status: 400,
        });
    }

    if (!input.patientTaxCode?.trim()) {
        throw new SissPrescriptionError('Codice fiscale mancante nel profilo paziente.', {
            code: 'SISS_PATIENT_NOT_READY',
            status: 400,
        });
    }

    try {
        const result = await executeSissAdapterRequest(
            {
                action: 'prescription.create',
                fiscalCode: input.patientTaxCode,
            },
            {
                transport: deps.transport ?? createSissPortalHandoffTransport(),
            },
        );

        const handoffUrl = result.handoffUrl?.trim() ?? '';
        if (!handoffUrl) {
            throw new SissPrescriptionError('Handoff SISS incompleto: URL mancante.', {
                code: 'SISS_HANDOFF_FAILED',
                status: 502,
                correlationId: result.correlationId,
            });
        }

        return {
            status: 'handoff',
            mode: result.mode,
            handoffUrl,
            correlationId: result.correlationId,
            message: 'Flusso SISS pronto. Il codice fiscale verra copiato in locale prima dell\'apertura del portale.',
        };
    } catch (error) {
        if (error instanceof SissPrescriptionError) {
            throw error;
        }

        if (error instanceof SissAdapterError) {
            throw new SissPrescriptionError(error.message, {
                code: 'SISS_HANDOFF_FAILED',
                status: resolveSissPrescriptionStatus(error.status),
                correlationId: error.correlationId,
            });
        }

        throw new SissPrescriptionError('Errore inatteso nel flusso SISS.', {
            code: 'SISS_HANDOFF_FAILED',
            status: 500,
        });
    }
}

function resolveSissPrescriptionStatus(status: number | null): number {
    if (!status || status < 400) return 502;
    return status;
}
