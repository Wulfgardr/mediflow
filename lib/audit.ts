import crypto from 'crypto';
import { and, desc, eq, gte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { hasValidLocalApiToken } from './local-api-auth';
import { auditEvents } from './schema';
import type { ServerSession } from './server-session';

/* @Codex */
export const AUDIT_SCHEMA_VERSION = 1 as const;

/* @Codex */
export const AUDIT_EVENT_TYPES = [
    'auth.login.succeeded',
    'auth.login.failed',
    'auth.logout',
    'patient.created',
    'patient.updated',
    'patient.deleted',
    'patient.restored',
    'checkup.created',
    'checkup.updated',
    'checkup.deleted',
    'entry.created',
    'entry.updated',
    'entry.deleted',
    'therapy.created',
    'therapy.updated',
    'therapy.deleted',
    'observation.created',
    'observation.updated',
    'observation.deleted',
    'settings.updated',
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
export type AuditOutcome = 'success' | 'failure' | 'denied';
export type AuditActorType = 'user' | 'system';
export type AuditSubjectType = 'session' | 'patient' | 'checkup' | 'entry' | 'therapy' | 'observation' | 'settings';
export type AuditSourceSurface = 'web' | 'native' | 'api' | 'job';
export type AuditAuthContext = 'session' | 'local-token' | 'anonymous';

export type AuditContext = {
    actorType: AuditActorType;
    actorRef: string;
    sourceSurface: AuditSourceSurface;
    authContext: AuditAuthContext;
};

/* @Codex */
export const AUDIT_SOURCE_SURFACE_HEADER = 'x-mediflow-source-surface';

export type AuditRedactedMetadata = {
    changedFields?: string[];
    resourceVersion?: number;
    counts?: number;
    flags?: string[];
    reasonCode?: string;
};

type AuditWriteInput = {
    eventType: AuditEventType;
    outcome: AuditOutcome;
    actorType: AuditActorType;
    actorRef: string;
    subjectType: AuditSubjectType;
    subjectRef?: string | null;
    sourceSurface: AuditSourceSurface;
    occurredAt?: Date;
    requestId?: string | null;
    redactedMetadata?: AuditRedactedMetadata | null;
};

/* @Codex */
export type AuditRequestWriteInput = {
    eventType: AuditEventType;
    outcome?: AuditOutcome;
    subjectType: AuditSubjectType;
    subjectRef?: string | null;
    redactedMetadata?: AuditRedactedMetadata | null;
};

type AuditListFilters = {
    limit?: number;
    eventType?: AuditEventType;
    outcome?: AuditOutcome;
    subjectType?: AuditSubjectType;
    actorRef?: string;
    occurredAfter?: Date;
};

export type AuditRecord = {
    schemaVersion: number;
    eventId: string;
    eventType: AuditEventType;
    occurredAt: string;
    outcome: AuditOutcome;
    actorType: AuditActorType;
    actorRef: string;
    subjectType: AuditSubjectType;
    subjectRef: string | null;
    sourceSurface: AuditSourceSurface;
    requestId: string | null;
    redactedMetadata: AuditRedactedMetadata | null;
    createdAt: string | null;
};

export type AuditSummary = {
    totalEvents: number;
    distinctActors: number;
    outcomes: Record<AuditOutcome, number>;
    sourceSurfaces: Record<AuditSourceSurface, number>;
    subjectTypes: Record<AuditSubjectType, number>;
    topEventTypes: Array<{ eventType: AuditEventType; count: number }>;
    isTruncated: boolean;
};

/* @Codex */
export function auditSourceSurfaceFromRequest(
    request: Request | null | undefined,
    fallback: AuditSourceSurface
): AuditSourceSurface {
    const value = request?.headers.get(AUDIT_SOURCE_SURFACE_HEADER)?.trim().toLowerCase();
    switch (value) {
        case 'web':
        case 'native':
        case 'api':
        case 'job':
            return value;
        default:
            return fallback;
    }
}

/* @Codex */
export function auditContextFromSession(session: ServerSession | null | undefined): AuditContext {
    if (session?.authChannel === 'native') {
        return {
            actorType: 'user',
            actorRef: session.userId,
            sourceSurface: 'native',
            authContext: 'local-token',
        };
    }

    if (session?.authChannel === 'system' || session?.id === 'local-api') {
        return {
            actorType: 'system',
            actorRef: 'local-api',
            sourceSurface: 'api',
            authContext: 'local-token',
        };
    }

    return {
        actorType: 'user',
        actorRef: session?.userId || 'anonymous',
        sourceSurface: 'web',
        authContext: session?.userId ? 'session' : 'anonymous',
    };
}

/* @Codex */
export function auditContextFromRequest(
    request: Request,
    session: ServerSession | null | undefined
): AuditContext {
    if (hasValidLocalApiToken(request)) {
        if (session?.userId && session.id !== 'local-api') {
            return {
                actorType: 'user',
                actorRef: session.userId,
                sourceSurface: 'native',
                authContext: 'local-token',
            };
        }

        return {
            actorType: 'system',
            actorRef: 'local-api',
            sourceSurface: 'api',
            authContext: 'local-token',
        };
    }

    return auditContextFromSession(session);
}

/* @Codex */
export function withAuditContextMetadata(
    context: AuditContext,
    metadata: AuditRedactedMetadata | null | undefined
): AuditRedactedMetadata | null {
    return sanitizeAuditMetadata({
        ...(metadata ?? {}),
        flags: [...(metadata?.flags ?? []), `auth:${context.authContext}`],
    });
}

/* @Codex */
export function hashAuditRef(value: string): string {
    const normalized = value.trim().toLowerCase();
    const digest = crypto.createHash('sha256').update(normalized).digest('hex');
    return `sha256:${digest.slice(0, 16)}`;
}

/* @Codex */
export function requestIdFromRequest(request: Request): string | null {
    const value = request.headers.get('x-request-id')?.trim();
    return normalizeToken(value);
}

/* @Codex */
export function buildAuditWriteInputFromRequest(
    request: Request,
    session: ServerSession | null | undefined,
    input: AuditRequestWriteInput
): AuditWriteInput {
    const context = auditContextFromRequest(request, session);
    return {
        eventType: input.eventType,
        outcome: input.outcome ?? 'success',
        actorType: context.actorType,
        actorRef: context.actorRef,
        subjectType: input.subjectType,
        subjectRef: input.subjectRef ?? null,
        sourceSurface: context.sourceSurface,
        requestId: requestIdFromRequest(request),
        redactedMetadata: withAuditContextMetadata(context, input.redactedMetadata),
    };
}

/* @Codex */
export async function safeWriteAuditEventFromRequest(
    request: Request,
    session: ServerSession | null | undefined,
    input: AuditRequestWriteInput,
    errorLabel = '[MediFlow] Audit write failed:'
): Promise<void> {
    try {
        await writeAuditEvent(buildAuditWriteInputFromRequest(request, session, input));
    } catch (error) {
        console.error(errorLabel, error);
    }
}

/* @Codex */
export function sanitizeAuditMetadata(value: AuditRedactedMetadata | null | undefined): AuditRedactedMetadata | null {
    if (!value) return null;

    const changedFields = sanitizeTokenList(value.changedFields);
    const flags = sanitizeTokenList(value.flags);
    const reasonCode = normalizeToken(value.reasonCode);
    const resourceVersion = normalizeCount(value.resourceVersion);
    const counts = normalizeCount(value.counts);

    const sanitized: AuditRedactedMetadata = {};
    if (changedFields.length > 0) sanitized.changedFields = changedFields;
    if (flags.length > 0) sanitized.flags = flags;
    if (reasonCode) sanitized.reasonCode = reasonCode;
    if (resourceVersion !== null) sanitized.resourceVersion = resourceVersion;
    if (counts !== null) sanitized.counts = counts;

    return Object.keys(sanitized).length > 0 ? sanitized : null;
}

/* @Codex */
export function listChangedFields(body: Record<string, unknown>, excluded: string[] = []): string[] {
    const excludedKeys = new Set(excluded);
    return sanitizeTokenList(
        Object.entries(body)
            .filter(([key, value]) => !excludedKeys.has(key) && value !== undefined)
            .map(([key]) => key),
    );
}

/* @Codex */
export function classifyPatientMutationEvent(previousIsArchived: boolean | null, nextIsArchived: boolean | undefined): AuditEventType {
    if (previousIsArchived === true && nextIsArchived === false) {
        return 'patient.restored';
    }
    return 'patient.updated';
}

/* @Codex */
export async function writeAuditEvent(input: AuditWriteInput): Promise<string> {
    const { dbServer } = await import('./db-server');
    const eventId = uuidv4();
    const occurredAt = input.occurredAt ?? new Date();
    const redactedMetadata = sanitizeAuditMetadata(input.redactedMetadata);

    await dbServer.insert(auditEvents).values({
        eventId,
        schemaVersion: AUDIT_SCHEMA_VERSION,
        eventType: input.eventType,
        occurredAt,
        outcome: input.outcome,
        actorType: input.actorType,
        actorRef: input.actorRef,
        subjectType: input.subjectType,
        subjectRef: input.subjectRef ?? null,
        sourceSurface: input.sourceSurface,
        requestId: input.requestId ?? null,
        redactedMetadata: redactedMetadata ? JSON.stringify(redactedMetadata) : null,
        createdAt: new Date(),
    });

    return eventId;
}

/* @Codex */
export async function listAuditEvents(filters: AuditListFilters = {}): Promise<AuditRecord[]> {
    const { dbServer } = await import('./db-server');
    const limit = normalizeLimit(filters.limit);
    const clauses = [];

    if (filters.eventType) clauses.push(eq(auditEvents.eventType, filters.eventType));
    if (filters.outcome) clauses.push(eq(auditEvents.outcome, filters.outcome));
    if (filters.subjectType) clauses.push(eq(auditEvents.subjectType, filters.subjectType));
    if (filters.actorRef) clauses.push(eq(auditEvents.actorRef, filters.actorRef));
    if (filters.occurredAfter) clauses.push(gte(auditEvents.occurredAt, filters.occurredAfter));

    const whereClause = clauses.length > 1 ? and(...clauses) : clauses[0];
    const rows = whereClause
        ? await dbServer.select().from(auditEvents).where(whereClause).orderBy(desc(auditEvents.occurredAt)).limit(limit)
        : await dbServer.select().from(auditEvents).orderBy(desc(auditEvents.occurredAt)).limit(limit);

    return rows.map((row) => ({
        schemaVersion: row.schemaVersion,
        eventId: row.eventId,
        eventType: row.eventType as AuditEventType,
        occurredAt: toIsoString(row.occurredAt) ?? new Date(0).toISOString(),
        outcome: row.outcome as AuditOutcome,
        actorType: row.actorType as AuditActorType,
        actorRef: row.actorRef,
        subjectType: row.subjectType as AuditSubjectType,
        subjectRef: row.subjectRef ?? null,
        sourceSurface: row.sourceSurface as AuditSourceSurface,
        requestId: row.requestId ?? null,
        redactedMetadata: parseRedactedMetadata(row.redactedMetadata),
        createdAt: toIsoString(row.createdAt),
    }));
}

/* @Codex */
export function summarizeAuditEvents(records: AuditRecord[], isTruncated = false): AuditSummary {
    const outcomes: Record<AuditOutcome, number> = {
        success: 0,
        failure: 0,
        denied: 0,
    };
    const sourceSurfaces: Record<AuditSourceSurface, number> = {
        web: 0,
        native: 0,
        api: 0,
        job: 0,
    };
    const subjectTypes: Record<AuditSubjectType, number> = {
        session: 0,
        patient: 0,
        checkup: 0,
        entry: 0,
        therapy: 0,
        observation: 0,
        settings: 0,
    };
    const eventTypeCounts = new Map<AuditEventType, number>();
    const actors = new Set<string>();

    for (const record of records) {
        outcomes[record.outcome] += 1;
        sourceSurfaces[record.sourceSurface] += 1;
        subjectTypes[record.subjectType] += 1;
        eventTypeCounts.set(record.eventType, (eventTypeCounts.get(record.eventType) ?? 0) + 1);
        actors.add(record.actorRef);
    }

    const topEventTypes = Array.from(eventTypeCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 5)
        .map(([eventType, count]) => ({ eventType, count }));

    return {
        totalEvents: records.length,
        distinctActors: actors.size,
        outcomes,
        sourceSurfaces,
        subjectTypes,
        topEventTypes,
        isTruncated,
    };
}

function sanitizeTokenList(values: unknown): string[] {
    if (!Array.isArray(values)) return [];

    const deduped = new Set<string>();
    for (const value of values) {
        const normalized = normalizeToken(value);
        if (normalized) deduped.add(normalized);
    }
    return Array.from(deduped);
}

function normalizeToken(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 80);
    return normalized.length > 0 ? normalized : null;
}

function normalizeCount(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const normalized = Math.trunc(value);
    return normalized >= 0 ? normalized : null;
}

function normalizeLimit(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 50;
    const normalized = Math.trunc(value);
    if (normalized <= 0) return 50;
    return Math.min(normalized, 200);
}

function parseRedactedMetadata(value: string | null): AuditRedactedMetadata | null {
    if (!value) return null;
    try {
        return sanitizeAuditMetadata(JSON.parse(value));
    } catch {
        return null;
    }
}

function toIsoString(value: Date | string | number | null): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
