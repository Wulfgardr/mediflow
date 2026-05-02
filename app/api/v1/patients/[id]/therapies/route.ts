// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { therapies } from '@/lib/schema';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/server-auth';
import type { TherapySummary } from '@/lib/api/v1/types';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { normalizeTherapyCreateInput } from '@/lib/api-v1-clinical-write-normalization';
/* @Codex */
import {
    normalizeTherapyStatus,
    therapyStatusFilterValues,
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
        const statusFilterValues = status ? therapyStatusFilterValues(status) : null;
        const dateFrom = parseDateParam(searchParams.get('dateFrom'));
        const dateTo = parseDateParam(searchParams.get('dateTo'));

        const filters = [eq(therapies.patientId, id)];
        /* @Codex */
        if (statusFilterValues) filters.push(inArray(therapies.status, statusFilterValues));
        if (dateFrom) filters.push(gte(therapies.startDate, dateFrom));
        if (dateTo) filters.push(lte(therapies.startDate, dateTo));
        const whereClause = filters.length > 1 ? and(...filters) : filters[0];

        const rows = limit
            ? await dbServer.select().from(therapies).where(whereClause).orderBy(desc(therapies.startDate)).limit(limit)
            : await dbServer.select().from(therapies).where(whereClause).orderBy(desc(therapies.startDate));

        const result: TherapySummary[] = rows.map((therapy) => ({
            id: therapy.id,
            patientId: therapy.patientId,
            drugName: therapy.drugName,
            /* @Codex */
            aic: therapy.aic ?? null,
            /* @Codex */
            atc: therapy.atc ?? null,
            activePrinciple: therapy.activePrinciple ?? null,
            dosage: therapy.dosage,
            motivation: therapy.motivation ?? null,
            diagnosisCode: therapy.diagnosisCode ?? null,
            diagnosisName: therapy.diagnosisName ?? null,
            status: normalizeTherapyStatus(therapy.status),
            startDate: toIsoString(therapy.startDate) ?? new Date(0).toISOString(),
            endDate: toIsoString(therapy.endDate),
            version: therapy.version,
            createdAt: toIsoString(therapy.createdAt),
            updatedAt: toIsoString(therapy.updatedAt),
            deletedAt: toIsoString(therapy.deletedAt),
            deletionReason: therapy.deletionReason ?? null,
        }));

        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/patients/[id]/therapies error:', error);
        return NextResponse.json({ error: 'Failed to fetch therapies' }, { status: 500 });
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
        /* @Codex */
        const auditBody = body;
        const newId = typeof body.id === 'string' && body.id.trim().length > 0 ? body.id : uuidv4();
        const normalized = normalizeTherapyCreateInput(body, {
            id: newId,
            patientId: id,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        await dbServer.insert(therapies).values(normalized.values);

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            auditSession,
            {
                eventType: 'therapy.created',
                subjectType: 'therapy',
                subjectRef: normalized.values.id,
                redactedMetadata: {
                    changedFields: listChangedFields(auditBody, ['id']),
                    resourceVersion: 1,
                },
            },
            '[MediFlow] Therapy audit write failed:',
        );

        return NextResponse.json({ id: normalized.values.id, version: 1 }, { status: 201 });
    } catch (error) {
        console.error('API POST /api/v1/patients/[id]/therapies error:', error);
        return NextResponse.json({ error: 'Failed to create therapy' }, { status: 500 });
    }
}
