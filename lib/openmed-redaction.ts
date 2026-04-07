/* @Codex */
export const REDACTION_VERSION = 'redaction.v1' as const;
export const OPENMED_REDACTION_SETTINGS_KEYS = [
    'openmedUrl',
    'openmedRedactionLang',
    'openmedRedactionMethod',
    'openmedRedactionConfidenceThreshold',
] as const;

export const REDACTION_ACTIONS = ['extract', 'deidentify'] as const;
export type RedactionAction = (typeof REDACTION_ACTIONS)[number];

export type MediFlowPiiType =
    | 'person_name'
    | 'date'
    | 'national_id'
    | 'phone'
    | 'email'
    | 'street_address'
    | 'city'
    | 'state'
    | 'other';

export type OpenMedRedactionConfig = {
    baseUrl: string;
    defaultLanguage: string;
    defaultMethod: 'mask';
    defaultConfidenceThreshold: number;
};

export type SystemRedactionRequest = {
    action: RedactionAction;
    text: string;
    lang?: string;
    method?: 'mask';
    confidenceThreshold?: number;
};

export type RedactionEntity = {
    text: string;
    start: number | null;
    end: number | null;
    confidence: number | null;
    rawType: string | null;
    type: MediFlowPiiType;
    critical: boolean;
};

type OpenMedEntity = {
    text?: unknown;
    start?: unknown;
    end?: unknown;
    label?: unknown;
    confidence?: unknown;
};

const DEFAULT_BASE_URL = 'http://127.0.0.1:18080';
const DEFAULT_LANGUAGE = 'it';
const DEFAULT_METHOD = 'mask';
const DEFAULT_THRESHOLD = 0.5;
const CRITICAL_TYPES = new Set<MediFlowPiiType>([
    'person_name',
    'date',
    'national_id',
    'phone',
    'email',
    'street_address',
]);

export function resolveOpenMedRedactionConfig(input: {
    baseUrl?: string | null;
    defaultLanguage?: string | null;
    defaultMethod?: string | null;
    defaultConfidenceThreshold?: string | number | null;
}, env = process.env): OpenMedRedactionConfig {
    return {
        baseUrl: normalizeString(env.OPENMED_BASE_URL) ?? normalizeString(input.baseUrl) ?? DEFAULT_BASE_URL,
        defaultLanguage: normalizeString(input.defaultLanguage) ?? DEFAULT_LANGUAGE,
        defaultMethod: DEFAULT_METHOD,
        defaultConfidenceThreshold: normalizeThreshold(
            env.OPENMED_REDACTION_CONFIDENCE_THRESHOLD ?? input.defaultConfidenceThreshold,
            DEFAULT_THRESHOLD,
        ),
    };
}

export function parseSystemRedactionRequest(input: unknown): { ok: true; value: SystemRedactionRequest } | { ok: false; error: string } {
    if (!input || typeof input !== 'object') {
        return { ok: false, error: 'JSON body required.' };
    }

    const body = input as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';
    if (!REDACTION_ACTIONS.includes(action as RedactionAction)) {
        return { ok: false, error: 'Invalid action. Use extract or deidentify.' };
    }

    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
        return { ok: false, error: 'Text is required.' };
    }

    const lang = normalizeString(body.lang);
    const method = normalizeString(body.method);
    if (method && method !== DEFAULT_METHOD) {
        return { ok: false, error: 'Invalid method. Only mask is supported in this slice.' };
    }

    const confidenceThreshold = body.confidenceThreshold === undefined
        ? undefined
        : normalizeThreshold(body.confidenceThreshold, Number.NaN);
    if (confidenceThreshold !== undefined && Number.isNaN(confidenceThreshold)) {
        return { ok: false, error: 'Invalid confidenceThreshold. Use a number between 0 and 1.' };
    }

    return {
        ok: true,
        value: {
            action: action as RedactionAction,
            text,
            ...(lang ? { lang } : {}),
            ...(method ? { method: DEFAULT_METHOD } : {}),
            ...(confidenceThreshold !== undefined ? { confidenceThreshold } : {}),
        },
    };
}

export function buildOpenMedUpstreamCall(
    request: SystemRedactionRequest,
    config: OpenMedRedactionConfig,
): { pathname: '/pii/extract' | '/pii/deidentify'; payload: Record<string, unknown> } {
    const confidenceThreshold = request.confidenceThreshold ?? config.defaultConfidenceThreshold;
    const payload: Record<string, unknown> = {
        text: request.text,
        lang: request.lang ?? config.defaultLanguage,
        confidence_threshold: confidenceThreshold,
    };

    if (request.action === 'deidentify') {
        payload.method = request.method ?? config.defaultMethod;
    }

    return {
        pathname: request.action === 'extract' ? '/pii/extract' : '/pii/deidentify',
        payload,
    };
}

export function normalizeOpenMedResponse(
    request: SystemRedactionRequest,
    config: OpenMedRedactionConfig,
    body: unknown,
) {
    const payload = isRecord(body) ? body : {};
    const entitiesSource = request.action === 'extract' ? payload.entities : payload.pii_entities;
    const entities = normalizeOpenMedEntities(entitiesSource);
    const confidenceThreshold = request.confidenceThreshold ?? config.defaultConfidenceThreshold;

    return {
        version: REDACTION_VERSION,
        provider: 'openmed' as const,
        action: request.action,
        language: request.lang ?? config.defaultLanguage,
        method: request.action === 'deidentify' ? request.method ?? config.defaultMethod : null,
        confidenceThreshold,
        modelName: normalizeString(payload.model_name) ?? null,
        entityCount: entities.length,
        entities,
        redactedText: request.action === 'deidentify'
            ? (normalizeString(payload.deidentified_text) ?? null)
            : null,
    };
}

export function normalizeOpenMedHealth(body: unknown) {
    const payload = isRecord(body) ? body : {};
    return {
        status: normalizeString(payload.status) ?? 'unknown',
        version: normalizeString(payload.version) ?? null,
        profile: normalizeString(payload.profile) ?? null,
    };
}

export function normalizeOpenMedLabel(rawLabel: string | null | undefined): MediFlowPiiType {
    const label = normalizeLabel(rawLabel);
    switch (label) {
        case 'firstname':
        case 'lastname':
        case 'name':
        case 'person':
            return 'person_name';
        case 'date':
        case 'dateofbirth':
            return 'date';
        case 'nationalid':
        case 'codicefiscale':
        case 'ssn':
            return 'national_id';
        case 'phone':
        case 'phonenumber':
        case 'npi':
            return 'phone';
        case 'email':
            return 'email';
        case 'secondaryaddress':
        case 'streetaddress':
        case 'address':
            return 'street_address';
        case 'city':
            return 'city';
        case 'state':
            return 'state';
        default:
            return 'other';
    }
}

function normalizeOpenMedEntities(input: unknown): RedactionEntity[] {
    if (!Array.isArray(input)) return [];

    return input
        .map((entity) => normalizeOpenMedEntity(entity as OpenMedEntity))
        .filter((entity): entity is RedactionEntity => entity !== null);
}

function normalizeOpenMedEntity(entity: OpenMedEntity): RedactionEntity | null {
    const text = normalizeString(entity?.text);
    if (!text) return null;

    const type = normalizeOpenMedLabel(normalizeString(entity?.label));
    return {
        text,
        start: normalizeInteger(entity?.start),
        end: normalizeInteger(entity?.end),
        confidence: normalizeOptionalNumber(entity?.confidence),
        rawType: normalizeString(entity?.label) ?? null,
        type,
        critical: CRITICAL_TYPES.has(type),
    };
}

function normalizeString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function normalizeLabel(value: string | null | undefined): string {
    return (value ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function normalizeThreshold(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number(value)
            : Number.NaN;

    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        return fallback;
    }

    return Number(parsed.toFixed(3));
}

function normalizeInteger(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null;
    return value;
}

function normalizeOptionalNumber(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Number(value.toFixed(3));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
