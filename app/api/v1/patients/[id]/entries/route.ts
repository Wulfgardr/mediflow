// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { entries } from '@/lib/schema';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import type { EntrySummary } from '@/lib/api/v1/types';
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
        const type = searchParams.get('type')?.trim();
        const dateFrom = parseDateParam(searchParams.get('dateFrom'));
        const dateTo = parseDateParam(searchParams.get('dateTo'));

        const filters = [eq(entries.patientId, id)];
        if (type) filters.push(eq(entries.type, type));
        if (dateFrom) filters.push(gte(entries.date, dateFrom));
        if (dateTo) filters.push(lte(entries.date, dateTo));
        const whereClause = filters.length > 1 ? and(...filters) : filters[0];

        const rows = limit
            ? await dbServer.select().from(entries).where(whereClause).orderBy(desc(entries.date)).limit(limit)
            : await dbServer.select().from(entries).where(whereClause).orderBy(desc(entries.date));

        const result: EntrySummary[] = rows.map((entry) => ({
            id: entry.id,
            patientId: entry.patientId,
            type: entry.type,
            date: toIsoString(entry.date) ?? new Date(0).toISOString(),
            content: entry.content,
            createdAt: toIsoString(entry.createdAt)
        }));

        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/patients/[id]/entries error:', error);
        return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 });
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id } = await params;
        const body = await request.json();
        const newId = body.id || uuidv4();

        await dbServer.insert(entries).values({
            id: newId,
            patientId: id,
            type: body.type,
            date: new Date(body.date),
            content: body.content,
            createdAt: new Date()
        });

        return NextResponse.json({ id: newId }, { status: 201 });
    } catch (error) {
        console.error('API POST /api/v1/patients/[id]/entries error:', error);
        return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 });
    }
}
