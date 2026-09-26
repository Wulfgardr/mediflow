// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { therapies } from '@/lib/schema';
import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/security/server-auth';
import type { TherapySummary } from '@/lib/api/v1/types';
/* @Codex */
import { normalizeTherapyCreateInput } from '@/lib/api-v1-clinical-write-normalization';
/* @Codex */
import {
    normalizeTherapyStatus,
    therapyStatusFilterValues,
} from '@/lib/status-normalization';
/* @Codex */
import { auditContextFromSession, requestIdFromRequest } from '@/lib/security/audit';
import { createTherapyOperation } from '@/lib/therapy-write-operation';
import { readTherapyJsonObject, therapyChangedFields, therapyCreateId, validateTherapyInput } from '@/lib/therapy-write-input';

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

// WUL-308: lists hide soft-deleted rows by default, like entries.
function parseIncludeDeleted(value: string | null): boolean {
    return value === 'true' || value === '1';
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
        const includeDeleted = parseIncludeDeleted(searchParams.get('includeDeleted'));

        const filters = [eq(therapies.patientId, id)];
        if (!includeDeleted) filters.push(isNull(therapies.deletedAt));
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
        const auditSession = await requireLocalApiActorSession(request);
        const { id } = await params;
        const parsed = await readTherapyJsonObject(request, 'v1', 'create');
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
        const shape = validateTherapyInput(parsed.body, 'v1', 'create');
        if (shape) return NextResponse.json({ error: shape.error }, { status: shape.status });
        const newId = therapyCreateId(parsed.body);
        const normalized = normalizeTherapyCreateInput(parsed.body, { id: newId, patientId: id });
        if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });
        const context = auditContextFromSession(auditSession);
        const result = createTherapyOperation({
            patientId: id, therapyId: newId, values: normalized.values,
            changedFields: therapyChangedFields(normalized.values, parsed.body), mode: 'v1',
            audit: { actorType: context.actorType, actorRef: context.actorRef,
                sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request),
                flags: [`auth:${context.authContext}`] },
        });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /api/v1/patients/[id]/therapies error:', error);
        return NextResponse.json({ error: 'Failed to create therapy' }, { status: 500 });
    }
}
