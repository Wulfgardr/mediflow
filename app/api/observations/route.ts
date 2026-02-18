/* @Codex */
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { observations } from '@/lib/schema';
import { desc, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

/* @Codex */
function parseDate(value: unknown): Date | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* @Codex */
function normalizeValue(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    return null;
}

export async function GET(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');

    try {
        let query = dbServer.select().from(observations);
        if (patientId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            query = query.where(eq(observations.patientId, patientId)) as any;
        }
        const data = await query.orderBy(desc(observations.observedAt));
        return NextResponse.json(data);
    } catch (error) {
        console.error('API GET /observations error:', error);
        return NextResponse.json({ error: 'Failed to fetch observations' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json();

        const patientId = typeof body.patientId === 'string' ? body.patientId : null;
        const codeSystem = typeof body.codeSystem === 'string' ? body.codeSystem.trim().toUpperCase() : null;
        const code = typeof body.code === 'string' ? body.code.trim() : null;
        const display = typeof body.display === 'string' ? body.display.trim() : null;
        const unitSystem = typeof body.unitSystem === 'string' ? body.unitSystem.trim().toUpperCase() : null;
        const unitCode = typeof body.unitCode === 'string' ? body.unitCode.trim() : null;
        const value = normalizeValue(body.value);
        const observedAt = parseDate(body.observedAt);
        const notes = typeof body.notes === 'string' ? body.notes : null;
        const source = body.source === 'ai_suggestion' ? 'ai_suggestion' : 'manual';

        if (!patientId || !codeSystem || !code || !display || !unitSystem || !unitCode || !value || !observedAt) {
            return NextResponse.json({ error: 'Missing required observation fields' }, { status: 400 });
        }

        if (codeSystem !== 'LOINC' || unitSystem !== 'UCUM') {
            return NextResponse.json({ error: 'Only LOINC + UCUM observations are supported in this slice' }, { status: 400 });
        }

        const id = typeof body.id === 'string' ? body.id : uuidv4();

        await dbServer.insert(observations).values({
            id,
            patientId,
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

        return NextResponse.json({ id }, { status: 201 });
    } catch (error) {
        console.error('API POST /observations error:', error);
        return NextResponse.json({ error: 'Failed to create observation' }, { status: 500 });
    }
}

