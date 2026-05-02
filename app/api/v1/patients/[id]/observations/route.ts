/* @Codex */
import { NextResponse } from 'next/server';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { dbServer } from '@/lib/db-server';
import { observations } from '@/lib/schema';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/server-auth';
import type { ObservationSummary } from '@/lib/api/v1/types';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
/* @Codex */
import { normalizeObservationCreateInput } from '@/lib/api-v1-clinical-write-normalization';

/* @Codex */
function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* @Codex */
function parseDateParam(value: string | null): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* @Codex */
function parseLimit(value: string | null): number | null {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return null;
    return Math.min(parsed, 200);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id } = await params;
        const { searchParams } = new URL(request.url);
        const limit = parseLimit(searchParams.get('limit'));
        const code = searchParams.get('code')?.trim();
        const dateFrom = parseDateParam(searchParams.get('dateFrom'));
        const dateTo = parseDateParam(searchParams.get('dateTo'));

        const filters = [eq(observations.patientId, id)];
        if (code) filters.push(eq(observations.code, code));
        if (dateFrom) filters.push(gte(observations.observedAt, dateFrom));
        if (dateTo) filters.push(lte(observations.observedAt, dateTo));
        const whereClause = filters.length > 1 ? and(...filters) : filters[0];

        const rows = limit
            ? await dbServer.select().from(observations).where(whereClause).orderBy(desc(observations.observedAt)).limit(limit)
            : await dbServer.select().from(observations).where(whereClause).orderBy(desc(observations.observedAt));

        const result: ObservationSummary[] = rows.map((item) => ({
            id: item.id,
            patientId: item.patientId,
            codeSystem: item.codeSystem,
            code: item.code,
            display: item.display,
            unitSystem: item.unitSystem,
            unitCode: item.unitCode,
            value: item.value,
            notes: item.notes ?? null,
            observedAt: toIsoString(item.observedAt) ?? new Date(0).toISOString(),
            source: item.source ?? null,
            version: item.version,
            createdAt: toIsoString(item.createdAt),
            updatedAt: toIsoString(item.updatedAt),
            deletedAt: toIsoString(item.deletedAt),
            deletionReason: item.deletionReason ?? null,
        }));

        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/patients/[id]/observations error:', error);
        return NextResponse.json({ error: 'Failed to fetch observations' }, { status: 500 });
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        /* @Codex */
        const auditSession = await requireLocalApiActorSession(request);
        const { id } = await params;
        const body = await request.json() as Record<string, unknown>;

        const newId = typeof body.id === 'string' ? body.id : uuidv4();
        const normalized = normalizeObservationCreateInput(body, {
            id: newId,
            patientId: id,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        await dbServer.insert(observations).values(normalized.values);

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            auditSession,
            {
                eventType: 'observation.created',
                subjectType: 'observation',
                subjectRef: newId,
                redactedMetadata: {
                    changedFields: listChangedFields(body, ['id']),
                    resourceVersion: 1,
                },
            },
            '[MediFlow] Observation audit write failed:',
        );

        return NextResponse.json({ id: newId, version: 1 }, { status: 201 });
    } catch (error) {
        console.error('API POST /api/v1/patients/[id]/observations error:', error);
        return NextResponse.json({ error: 'Failed to create observation' }, { status: 500 });
    }
}
