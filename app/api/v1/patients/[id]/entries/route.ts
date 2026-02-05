// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { entries } from '@/lib/schema';
import { desc, eq } from 'drizzle-orm';
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

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id } = await params;
        const { searchParams } = new URL(request.url);
        const limit = parseLimit(searchParams.get('limit'));

        let query = dbServer.select().from(entries).where(eq(entries.patientId, id)).orderBy(desc(entries.date));
        if (limit) {
            query = query.limit(limit);
        }

        const rows = await query;
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
