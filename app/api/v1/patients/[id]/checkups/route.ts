// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { checkups } from '@/lib/schema';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/server-auth';
import type { CheckupSummary } from '@/lib/api/v1/types';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import {
    checkupStatusFilterValues,
    normalizeCheckupStatus,
    parseCheckupStatus,
} from '@/lib/status-normalization';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseLimit(value: string | null): number | null {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return null;
    return Math.min(parsed, 100);
}

/* @Codex */
function parseDateParam(value: string | null): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id } = await params;
        const { searchParams } = new URL(request.url);
        const limit = parseLimit(searchParams.get('limit'));
        const status = searchParams.get('status')?.trim();
        /* @Codex */
        const statusFilterValues = status ? checkupStatusFilterValues(status) : null;
        const dateFrom = parseDateParam(searchParams.get('dateFrom'));
        const dateTo = parseDateParam(searchParams.get('dateTo'));

        const filters = [eq(checkups.patientId, id)];
        /* @Codex */
        if (statusFilterValues) filters.push(inArray(checkups.status, statusFilterValues));
        if (dateFrom) filters.push(gte(checkups.date, dateFrom));
        if (dateTo) filters.push(lte(checkups.date, dateTo));
        const whereClause = filters.length > 1 ? and(...filters) : filters[0];

        const rows = limit
            ? await dbServer.select().from(checkups).where(whereClause).orderBy(desc(checkups.date)).limit(limit)
            : await dbServer.select().from(checkups).where(whereClause).orderBy(desc(checkups.date));

        const result: CheckupSummary[] = rows.map((checkup) => ({
            id: checkup.id,
            patientId: checkup.patientId,
            date: toIsoString(checkup.date) ?? new Date(0).toISOString(),
            title: checkup.title,
            notes: checkup.notes ?? null,
            status: normalizeCheckupStatus(checkup.status),
            source: checkup.source ?? null,
            createdAt: toIsoString(checkup.createdAt)
        }));

        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/patients/[id]/checkups error:', error);
        return NextResponse.json({ error: 'Failed to fetch checkups' }, { status: 500 });
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        /* @Codex */
        const auditSession = await requireLocalApiActorSession(request);
        const { id } = await params;
        const body = await request.json();
        /* @Codex */
        const auditBody = body as Record<string, unknown>;
        /* @Codex */
        const normalizedStatus = body.status === undefined ? 'pending' : parseCheckupStatus(body.status);
        if (body.status !== undefined && !normalizedStatus) {
            return NextResponse.json({ error: 'Invalid checkup status' }, { status: 400 });
        }
        const newId = body.id || uuidv4();

        await dbServer.insert(checkups).values({
            id: newId,
            patientId: id,
            date: new Date(body.date),
            title: body.title,
            /* @Codex */
            notes: body.notes ?? null,
            status: normalizedStatus ?? 'pending',
            /* @Codex */
            source: body.source ?? 'manual',
            createdAt: new Date()
        });

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            auditSession,
            {
                eventType: 'checkup.created',
                subjectType: 'checkup',
                subjectRef: String(newId),
                redactedMetadata: {
                    changedFields: listChangedFields(auditBody, ['id']),
                },
            },
            '[MediFlow] Checkup audit write failed:',
        );

        return NextResponse.json({ id: newId }, { status: 201 });
    } catch (error) {
        console.error('API POST /api/v1/patients/[id]/checkups error:', error);
        return NextResponse.json({ error: 'Failed to create checkup' }, { status: 500 });
    }
}
