/* @Codex */
import {
    createSissPortalHandoffTransport,
    executeSissAdapterRequest,
    SissAdapterError,
    type SissAction,
    type SissTransport,
    type SissTransportMode,
} from './siss-adapter';

/* @Codex */
export const SISS_PATIENT_CONTEXT_ACTIONS = ['menu.open', 'prescription.create', 'fse.lookup', 'registry.lookup'] as const;
export type SissPatientContextAction = (typeof SISS_PATIENT_CONTEXT_ACTIONS)[number];

/* @Codex */
export type SissPatientContextHandoffResult = {
    status: 'handoff';
    action: SissPatientContextAction;
    title: string;
    mode: SissTransportMode;
    handoffUrl: string;
    correlationId: string;
    message: string;
};

/* @Codex */
export class SissPatientContextError extends Error {
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
        this.name = 'SissPatientContextError';
        this.code = options.code;
        this.status = options.status;
        this.correlationId = options.correlationId ?? null;
    }
}

function isPatientContextAction(value: string): value is SissPatientContextAction {
    return SISS_PATIENT_CONTEXT_ACTIONS.includes(value as SissPatientContextAction);
}

/* @Codex */
export function resolveSissPatientContextAction(value: unknown): SissPatientContextAction | null {
    return typeof value === 'string' && isPatientContextAction(value) ? value : null;
}

function describeSissAction(action: SissPatientContextAction): {
    title: string;
    message: string;
} {
    switch (action) {
        case 'menu.open':
            return {
                title: 'Menu SISS',
                message: 'Menu SISS pronto. Il codice fiscale verra copiato in locale prima dell\'apertura del portale.',
            };
        case 'prescription.create':
            return {
                title: 'Prescrizione',
                message: 'Flusso prescrittivo SISS pronto. Il codice fiscale verra copiato in locale prima dell\'apertura del portale.',
            };
        case 'fse.lookup':
            return {
                title: 'FSE',
                message: 'Flusso FSE pronto. Il codice fiscale verra copiato in locale prima dell\'apertura del portale.',
            };
        case 'registry.lookup':
            return {
                title: 'Anagrafe',
                message: 'Flusso anagrafe SISS pronto. Il codice fiscale verra copiato in locale prima dell\'apertura del portale.',
            };
    }
}

/* @Codex */
export async function createSissPatientContextHandoff(
    input: {
        patientId: string;
        patientTaxCode: string | null | undefined;
        action: SissPatientContextAction;
    },
    deps: {
        transport?: SissTransport;
    } = {},
): Promise<SissPatientContextHandoffResult> {
    if (!input.patientId.trim()) {
        throw new SissPatientContextError('Paziente non valido per la richiesta SISS.', {
            code: 'SISS_PATIENT_NOT_READY',
            status: 400,
        });
    }

    if (!input.patientTaxCode?.trim()) {
        throw new SissPatientContextError('Codice fiscale mancante nel profilo paziente.', {
            code: 'SISS_PATIENT_NOT_READY',
            status: 400,
        });
    }

    const actionDescriptor = describeSissAction(input.action);

    try {
        const result = await executeSissAdapterRequest(
            {
                action: input.action as SissAction,
                fiscalCode: input.patientTaxCode,
            },
            {
                transport: deps.transport ?? createSissPortalHandoffTransport(),
            },
        );

        const handoffUrl = result.handoffUrl?.trim() ?? '';
        if (!handoffUrl) {
            throw new SissPatientContextError('Handoff SISS incompleto: URL mancante.', {
                code: 'SISS_HANDOFF_FAILED',
                status: 502,
                correlationId: result.correlationId,
            });
        }

        return {
            status: 'handoff',
            action: input.action,
            title: actionDescriptor.title,
            mode: result.mode,
            handoffUrl,
            correlationId: result.correlationId,
            message: actionDescriptor.message,
        };
    } catch (error) {
        if (error instanceof SissPatientContextError) {
            throw error;
        }

        if (error instanceof SissAdapterError) {
            throw new SissPatientContextError(error.message, {
                code: 'SISS_HANDOFF_FAILED',
                status: resolveSissPatientContextStatus(error.status),
                correlationId: error.correlationId,
            });
        }

        throw new SissPatientContextError('Errore inatteso nel flusso SISS.', {
            code: 'SISS_HANDOFF_FAILED',
            status: 500,
        });
    }
}

function resolveSissPatientContextStatus(status: number | null): number {
    if (!status || status < 400) return 502;
    return status;
}
