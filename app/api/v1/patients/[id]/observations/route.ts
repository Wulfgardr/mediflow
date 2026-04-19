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

/* @Codex */
function normalizeValue(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    return null;
}

/* @Codex */
function normalizeSource(value: unknown): 'manual' | 'ai_suggestion' {
    return value === 'ai_suggestion' ? 'ai_suggestion' : 'manual';
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
            createdAt: toIsoString(item.createdAt),
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
        const codeSystem = typeof body.codeSystem === 'string' ? body.codeSystem.trim().toUpperCase() : '';
        const code = typeof body.code === 'string' ? body.code.trim() : '';
        const display = typeof body.display === 'string' ? body.display.trim() : '';
        const unitSystem = typeof body.unitSystem === 'string' ? body.unitSystem.trim().toUpperCase() : '';
        const unitCode = typeof body.unitCode === 'string' ? body.unitCode.trim() : '';
        const value = normalizeValue(body.value);
        const observedAt = parseDateParam(typeof body.observedAt === 'string' ? body.observedAt : null);
        const notes = typeof body.notes === 'string' ? body.notes : null;
        const source = normalizeSource(body.source);

        if (!codeSystem || !code || !display || !unitSystem || !unitCode || !value || !observedAt) {
            return NextResponse.json({ error: 'Missing required observation fields' }, { status: 400 });
        }
        if (codeSystem !== 'LOINC' || unitSystem !== 'UCUM') {
            return NextResponse.json({ error: 'Only LOINC + UCUM observations are supported in this slice' }, { status: 400 });
        }

        const newId = typeof body.id === 'string' ? body.id : uuidv4();
        await dbServer.insert(observations).values({
            id: newId,
            patientId: id,
            codeSystem,
            code,
            display,
            unitSystem,
            unitCode,
            value,
            notes,
            observedAt,
            source,
            createdAt: new Date(),
        });

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
                },
            },
            '[MediFlow] Observation audit write failed:',
        );

        return NextResponse.json({ id: newId }, { status: 201 });
    } catch (error) {
        console.error('API POST /api/v1/patients/[id]/observations error:', error);
        return NextResponse.json({ error: 'Failed to create observation' }, { status: 500 });
    }
}
