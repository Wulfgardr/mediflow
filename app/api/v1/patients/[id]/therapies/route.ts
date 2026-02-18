// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { therapies } from '@/lib/schema';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import type { TherapySummary } from '@/lib/api/v1/types';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import {
    normalizeTherapyStatus,
    parseTherapyStatus,
    therapyStatusFilterValues,
} from '@/lib/status-normalization';

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
            createdAt: toIsoString(therapy.createdAt)
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
        const { id } = await params;
        const body = await request.json();
        /* @Codex */
        const normalizedStatus = body.status === undefined ? 'active' : parseTherapyStatus(body.status);
        if (body.status !== undefined && !normalizedStatus) {
            return NextResponse.json({ error: 'Invalid therapy status' }, { status: 400 });
        }
        const newId = body.id || uuidv4();

        await dbServer.insert(therapies).values({
            id: newId,
            patientId: id,
            drugName: body.drugName,
            /* @Codex */
            aic: typeof body.aic === 'string' ? body.aic : null,
            /* @Codex */
            atc: typeof body.atc === 'string' ? body.atc : null,
            /* @Codex */
            activePrinciple: body.activePrinciple ?? null,
            dosage: body.dosage,
            /* @Codex */
            motivation: body.motivation ?? null,
            /* @Codex */
            diagnosisCode: body.diagnosisCode ?? null,
            /* @Codex */
            diagnosisName: body.diagnosisName ?? null,
            status: normalizedStatus ?? 'active',
            startDate: new Date(body.startDate),
            endDate: body.endDate ? new Date(body.endDate) : null,
            createdAt: new Date()
        });

        return NextResponse.json({ id: newId }, { status: 201 });
    } catch (error) {
        console.error('API POST /api/v1/patients/[id]/therapies error:', error);
        return NextResponse.json({ error: 'Failed to create therapy' }, { status: 500 });
    }
}
