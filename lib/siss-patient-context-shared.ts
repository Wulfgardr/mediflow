/* @Codex */
import { SISS_ACTIONS, type SissAction } from './siss-actions';

/* @Codex */
export const SISS_PATIENT_CONTEXT_ACTIONS = SISS_ACTIONS;
export type SissPatientContextAction = SissAction;

/* @Codex */
export type SissPatientContextTransportMode = 'portal-handoff' | 'certified-api';

/* @Codex */
export type SissPatientContextHandoffResult = {
    status: 'handoff';
    action: SissPatientContextAction;
    title: string;
    mode: SissPatientContextTransportMode;
    handoffUrl: string;
    clipboardText: string | null;
    correlationId: string;
    message: string;
};

/* @Codex */
export type SissPatientContextActionState = {
    action: SissPatientContextAction;
    requiresFiscalCode: boolean;
    available: boolean;
    reason: string | null;
};

/* @Codex */
export type SissPatientContextSummary = {
    transportMode: 'portal-handoff';
    browserSessionRequired: true;
    certifiedApiAvailable: false;
    patientFiscalCodeReady: boolean;
    actionStates: SissPatientContextActionState[];
};

function isPatientContextAction(value: string): value is SissPatientContextAction {
    return SISS_PATIENT_CONTEXT_ACTIONS.includes(value as SissPatientContextAction);
}

/* @Codex */
export function resolveSissPatientContextAction(value: unknown): SissPatientContextAction | null {
    return typeof value === 'string' && isPatientContextAction(value) ? value : null;
}

/* @Codex */
export function requiresSissPatientFiscalCode(action: SissPatientContextAction): boolean {
    return action !== 'menu.open';
}

/* @Codex */
export function normalizeSissPatientTaxCode(value: string | null | undefined): string | null {
    const normalized = value?.trim().toUpperCase() ?? '';
    if (!/^[A-Z0-9]{11,16}$/.test(normalized)) {
        return null;
    }

    return normalized;
}

/* @Codex */
export function buildSissPatientContextSummary(input: {
    patientTaxCode: string | null | undefined;
}): SissPatientContextSummary {
    const patientFiscalCodeReady = normalizeSissPatientTaxCode(input.patientTaxCode) !== null;

    return {
        transportMode: 'portal-handoff',
        browserSessionRequired: true,
        certifiedApiAvailable: false,
        patientFiscalCodeReady,
        actionStates: SISS_PATIENT_CONTEXT_ACTIONS.map((action) => {
            const actionNeedsFiscalCode = requiresSissPatientFiscalCode(action);
            return {
                action,
                requiresFiscalCode: actionNeedsFiscalCode,
                available: actionNeedsFiscalCode ? patientFiscalCodeReady : true,
                reason: actionNeedsFiscalCode && !patientFiscalCodeReady
                    ? 'Richiede un codice fiscale valido nel profilo paziente.'
                    : null,
            };
        }),
    };
}
