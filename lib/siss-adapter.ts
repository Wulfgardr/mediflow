/* @Codex */
import { randomUUID } from 'node:crypto';
import { sanitizeAuditMetadata, type AuditRedactedMetadata } from './security/audit';
/* @Codex */
import { SISS_ACTIONS, type SissAction } from './siss-actions';
/* @Codex */
import { SISS_ACTION_URLS } from './siss-urls';

/* @Codex */
export const SISS_ERROR_CODES = [
    'SISS_INVALID_INPUT',
    'SISS_AUTH_REQUIRED',
    'SISS_DENIED',
    'SISS_RATE_LIMITED',
    'SISS_UNAVAILABLE',
    'SISS_UPSTREAM',
    'SISS_CONFIGURATION',
] as const;
export type SissErrorCode = (typeof SISS_ERROR_CODES)[number];

/* @Codex */
export const SISS_TRANSPORT_MODES = ['portal-handoff', 'certified-api'] as const;
export type SissTransportMode = (typeof SISS_TRANSPORT_MODES)[number];

/* @Codex */
export const SISS_PORTAL_URLS: Record<SissAction, string> = SISS_ACTION_URLS;

/* @Codex */
export type SissTransportRequest = {
    action: SissAction;
    fiscalCode: string;
    correlationId: string;
    attempt: number;
};

/* @Codex */
export type SissTransportResponse =
    | {
        ok: true;
        status: number;
        mode: SissTransportMode;
        handoffUrl?: string | null;
        externalRequestId?: string | null;
        flags?: string[];
    }
    | {
        ok: false;
        status?: number | null;
        code?: SissErrorCode | null;
        message?: string | null;
        retryable?: boolean | null;
        externalRequestId?: string | null;
        flags?: string[];
    };

/* @Codex */
export type SissTransport = (request: SissTransportRequest) => Promise<SissTransportResponse>;

/* @Codex */
export type SissAdapterRequest = {
    action: SissAction;
    fiscalCode: string;
    correlationId?: string | null;
    maxAttempts?: number;
};

/* @Codex */
export type SissAdapterResult = {
    action: SissAction;
    mode: SissTransportMode;
    correlationId: string;
    attempts: number;
    status: number;
    handoffUrl: string | null;
    externalRequestId: string | null;
    auditMetadata: AuditRedactedMetadata | null;
};

type SissAdapterDeps = {
    transport: SissTransport;
    sleep?: (ms: number) => Promise<void>;
    createCorrelationId?: () => string;
};

/* @Codex */
export class SissAdapterError extends Error {
    readonly code: SissErrorCode;
    readonly retryable: boolean;
    readonly status: number | null;
    readonly correlationId: string;
    readonly attempts: number;
    readonly externalRequestId: string | null;
    readonly auditMetadata: AuditRedactedMetadata | null;

    constructor(
        message: string,
        options: {
            code: SissErrorCode;
            retryable: boolean;
            status?: number | null;
            correlationId: string;
            attempts: number;
            externalRequestId?: string | null;
            auditMetadata: AuditRedactedMetadata | null;
        },
    ) {
        super(message);
        this.name = 'SissAdapterError';
        this.code = options.code;
        this.retryable = options.retryable;
        this.status = options.status ?? null;
        this.correlationId = options.correlationId;
        this.attempts = options.attempts;
        this.externalRequestId = options.externalRequestId ?? null;
        this.auditMetadata = options.auditMetadata;
    }
}

/* @Codex */
export async function executeSissAdapterRequest(
    input: SissAdapterRequest,
    deps: SissAdapterDeps,
): Promise<SissAdapterResult> {
    const action = normalizeAction(input.action);
    const correlationId = normalizeCorrelationId(input.correlationId, deps.createCorrelationId ?? createSissCorrelationId);
    const fiscalCode = normalizeFiscalCode(input.fiscalCode);
    const maxAttempts = normalizeAttempts(input.maxAttempts);
    const sleep = deps.sleep ?? defaultSleep;

    if (!fiscalCode) {
        throw createSissAdapterError({
            code: 'SISS_INVALID_INPUT',
            message: 'Codice fiscale non valido per la richiesta SISS.',
            retryable: false,
            correlationId,
            attempts: 0,
            action,
        });
    }

    let lastError: SissAdapterError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const response = await deps.transport({
                action,
                fiscalCode,
                correlationId,
                attempt,
            });

            if (response.ok) {
                return {
                    action,
                    mode: response.mode,
                    correlationId,
                    attempts: attempt,
                    status: response.status,
                    handoffUrl: response.handoffUrl ?? null,
                    externalRequestId: response.externalRequestId ?? null,
                    auditMetadata: buildSissAuditMetadata({
                        action,
                        attempts: attempt,
                        outcome: 'success',
                        mode: response.mode,
                        retryable: false,
                        extraFlags: response.flags,
                    }),
                };
            }

            lastError = createSissAdapterError({
                code: resolveSissErrorCode(response.status, response.code),
                message: response.message ?? defaultSissErrorMessage(resolveSissErrorCode(response.status, response.code)),
                retryable: resolveSissRetryable(response.status, response.retryable, response.code),
                status: response.status ?? null,
                correlationId,
                attempts: attempt,
                externalRequestId: response.externalRequestId ?? null,
                action,
                extraFlags: response.flags,
            });
        } catch (error) {
            lastError = createSissAdapterError({
                code: 'SISS_UNAVAILABLE',
                message: error instanceof Error && error.message ? error.message : defaultSissErrorMessage('SISS_UNAVAILABLE'),
                retryable: true,
                correlationId,
                attempts: attempt,
                action,
                extraFlags: ['transport:exception'],
            });
        }

        if (!lastError.retryable || attempt >= maxAttempts) {
            throw lastError;
        }

        await sleep(calculateSissRetryDelayMs(attempt));
    }

    throw lastError ?? createSissAdapterError({
        code: 'SISS_UPSTREAM',
        message: defaultSissErrorMessage('SISS_UPSTREAM'),
        retryable: false,
        correlationId,
        attempts: maxAttempts,
        action,
    });
}

/* @Codex */
export function createSissPortalHandoffTransport(): SissTransport {
    return async ({ action }) => ({
        ok: true,
        status: 202,
        mode: 'portal-handoff',
        handoffUrl: SISS_PORTAL_URLS[action],
        flags: ['transport:portal'],
    });
}

/* @Codex */
export function createSissCorrelationId(): string {
    return `siss-${randomUUID()}`;
}

/* @Codex */
export function calculateSissRetryDelayMs(attempt: number): number {
    const normalized = Math.max(1, Math.trunc(attempt));
    return Math.min(250 * normalized, 1000);
}

/* @Codex */
export function buildSissAuditMetadata(input: {
    action: SissAction;
    attempts: number;
    outcome: 'success' | 'failure';
    retryable: boolean;
    mode?: SissTransportMode | null;
    errorCode?: SissErrorCode | null;
    extraFlags?: string[];
}): AuditRedactedMetadata | null {
    return sanitizeAuditMetadata({
        counts: Math.max(0, Math.trunc(input.attempts)),
        reasonCode: input.outcome === 'failure' ? input.errorCode ?? 'SISS_UPSTREAM' : undefined,
        flags: [
            'integration:siss',
            `action:${input.action}`,
            `outcome:${input.outcome}`,
            input.mode ? `mode:${input.mode}` : 'mode:unknown',
            input.attempts > 1 ? 'retry:yes' : 'retry:no',
            input.retryable ? 'retryable:yes' : 'retryable:no',
            ...(input.extraFlags ?? []),
        ],
    });
}

function normalizeAction(value: SissAction): SissAction {
    return SISS_ACTIONS.includes(value) ? value : 'prescription.create';
}

function normalizeCorrelationId(value: string | null | undefined, createCorrelationId: () => string): string {
    if (typeof value !== 'string') return createCorrelationId();
    const trimmed = value.trim();
    if (!trimmed) return createCorrelationId();
    const normalized = trimmed.replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 80);
    return normalized || createCorrelationId();
}

function normalizeFiscalCode(value: string): string | null {
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z0-9]{11,16}$/.test(normalized)) {
        return null;
    }
    return normalized;
}

function normalizeAttempts(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 2;
    const normalized = Math.trunc(value);
    if (normalized <= 0) return 2;
    return Math.min(normalized, 3);
}

function resolveSissErrorCode(status?: number | null, explicitCode?: SissErrorCode | null): SissErrorCode {
    if (explicitCode && SISS_ERROR_CODES.includes(explicitCode)) {
        return explicitCode;
    }

    switch (status) {
        case 400:
        case 422:
            return 'SISS_INVALID_INPUT';
        case 401:
            return 'SISS_AUTH_REQUIRED';
        case 403:
            return 'SISS_DENIED';
        case 429:
            return 'SISS_RATE_LIMITED';
        case 500:
        case 502:
        case 503:
        case 504:
            return 'SISS_UNAVAILABLE';
        default:
            return 'SISS_UPSTREAM';
    }
}

function resolveSissRetryable(
    status?: number | null,
    explicitRetryable?: boolean | null,
    explicitCode?: SissErrorCode | null,
): boolean {
    if (typeof explicitRetryable === 'boolean') {
        return explicitRetryable;
    }

    const code = resolveSissErrorCode(status, explicitCode);
    return code === 'SISS_RATE_LIMITED' || code === 'SISS_UNAVAILABLE' || code === 'SISS_UPSTREAM';
}

function defaultSissErrorMessage(code: SissErrorCode): string {
    switch (code) {
        case 'SISS_INVALID_INPUT':
            return 'Richiesta SISS non valida.';
        case 'SISS_AUTH_REQUIRED':
            return 'Autenticazione SISS richiesta prima di procedere.';
        case 'SISS_DENIED':
            return 'Richiesta SISS rifiutata dal servizio.';
        case 'SISS_RATE_LIMITED':
            return 'SISS ha richiesto di riprovare piu tardi.';
        case 'SISS_UNAVAILABLE':
            return 'Servizio SISS temporaneamente non disponibile.';
        case 'SISS_CONFIGURATION':
            return 'Configurazione adapter SISS non valida.';
        case 'SISS_UPSTREAM':
        default:
            return 'Errore upstream SISS.';
    }
}

function createSissAdapterError(input: {
    code: SissErrorCode;
    message: string;
    retryable: boolean;
    correlationId: string;
    attempts: number;
    action: SissAction;
    status?: number | null;
    externalRequestId?: string | null;
    extraFlags?: string[];
}): SissAdapterError {
    return new SissAdapterError(input.message, {
        code: input.code,
        retryable: input.retryable,
        status: input.status ?? null,
        correlationId: input.correlationId,
        attempts: input.attempts,
        externalRequestId: input.externalRequestId ?? null,
        auditMetadata: buildSissAuditMetadata({
            action: input.action,
            attempts: input.attempts,
            outcome: 'failure',
            retryable: input.retryable,
            errorCode: input.code,
            extraFlags: input.extraFlags,
        }),
    });
}

async function defaultSleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
