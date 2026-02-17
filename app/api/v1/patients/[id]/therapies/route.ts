// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { therapies } from '@/lib/schema';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import type { TherapySummary } from '@/lib/api/v1/types';
import { v4 as uuidv4 } from 'uuid';

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
        const dateFrom = parseDateParam(searchParams.get('dateFrom'));
        const dateTo = parseDateParam(searchParams.get('dateTo'));

        const filters = [eq(therapies.patientId, id)];
        if (status) filters.push(eq(therapies.status, status));
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
            dosage: therapy.dosage,
            status: therapy.status,
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
        const newId = body.id || uuidv4();

        await dbServer.insert(therapies).values({
            id: newId,
            patientId: id,
            drugName: body.drugName,
            dosage: body.dosage,
            status: body.status || 'active',
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
