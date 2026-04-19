/* @Codex */
import type { SissAction, SissTransport } from './siss-adapter';
/* @Codex */
import {
    normalizeSissPatientTaxCode,
    requiresSissPatientFiscalCode,
    type SissPatientContextAction,
    type SissPatientContextHandoffResult,
} from './siss-patient-context-shared';

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

function describeSissAction(action: SissPatientContextAction): {
    title: string;
    message: string;
} {
    switch (action) {
        case 'menu.open':
            return {
                title: 'Menu SISS',
                message: 'Menu SISS pronto dalla sessione browser attiva.',
            };
        case 'prescription.create':
            return {
                title: 'Modulo Prescrittivo Regionale',
                message: 'Webapp ufficiale del Modulo Prescrittivo Regionale pronta. Il codice fiscale verra copiato in locale prima dell\'apertura della sessione SISS.',
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

    if (input.action === 'menu.open') {
        /* @Codex */
        const { createSissCorrelationId, SISS_PORTAL_URLS } = await import('./siss-adapter');
        const actionDescriptor = describeSissAction(input.action);
        return {
            status: 'handoff',
            action: input.action,
            title: actionDescriptor.title,
            mode: 'portal-handoff',
            handoffUrl: SISS_PORTAL_URLS['menu.open'],
            clipboardText: null,
            correlationId: createSissCorrelationId(),
            message: actionDescriptor.message,
        };
    }

    const fiscalCode = normalizeSissPatientTaxCode(input.patientTaxCode);
    if (requiresSissPatientFiscalCode(input.action) && !fiscalCode) {
        throw new SissPatientContextError('Codice fiscale mancante o non valido nel profilo paziente.', {
            code: 'SISS_PATIENT_NOT_READY',
            status: 400,
        });
    }

    const actionDescriptor = describeSissAction(input.action);
    /* @Codex */
    let sissAdapterModule: typeof import('./siss-adapter') | null = null;

    try {
        /* @Codex */
        sissAdapterModule = await import('./siss-adapter');
        const result = await sissAdapterModule.executeSissAdapterRequest(
            {
                action: input.action as SissAction,
                fiscalCode: fiscalCode!,
            },
            {
                transport: deps.transport ?? sissAdapterModule.createSissPortalHandoffTransport(),
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
            clipboardText: fiscalCode!,
            correlationId: result.correlationId,
            message: actionDescriptor.message,
        };
    } catch (error) {
        if (error instanceof SissPatientContextError) {
            throw error;
        }

        if (sissAdapterModule && error instanceof sissAdapterModule.SissAdapterError) {
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
