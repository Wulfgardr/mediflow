/* @Codex */
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { observations } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

/* @Codex */
function parseDate(value: unknown): Date | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/* @Codex */
function normalizeValue(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (value === null || value === '') return '';
    return undefined;
}

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const body = await request.json() as Record<string, unknown>;

        const existing = await dbServer
            .select({ id: observations.id })
            .from(observations)
            .where(eq(observations.id, id))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const updateData: Partial<typeof observations.$inferInsert> = {};

        if (typeof body.codeSystem === 'string') {
            const normalized = body.codeSystem.trim().toUpperCase();
            if (normalized !== 'LOINC') {
                return NextResponse.json({ error: 'Only LOINC observations are supported' }, { status: 400 });
            }
            updateData.codeSystem = normalized;
        }

        if (typeof body.code === 'string') updateData.code = body.code.trim();
        if (typeof body.display === 'string') updateData.display = body.display.trim();

        if (typeof body.unitSystem === 'string') {
            const normalized = body.unitSystem.trim().toUpperCase();
            if (normalized !== 'UCUM') {
                return NextResponse.json({ error: 'Only UCUM units are supported' }, { status: 400 });
            }
            updateData.unitSystem = normalized;
        }

        if (typeof body.unitCode === 'string') updateData.unitCode = body.unitCode.trim();

        if (Object.prototype.hasOwnProperty.call(body, 'value')) {
            const normalized = normalizeValue(body.value);
            if (normalized === undefined) {
                return NextResponse.json({ error: 'Invalid value field' }, { status: 400 });
            }
            updateData.value = normalized;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
            if (body.notes === null || body.notes === '') {
                updateData.notes = null;
            } else if (typeof body.notes === 'string') {
                updateData.notes = body.notes;
            } else {
                return NextResponse.json({ error: 'Invalid notes field' }, { status: 400 });
            }
        }

        if (Object.prototype.hasOwnProperty.call(body, 'observedAt')) {
            const parsed = parseDate(body.observedAt);
            if (!parsed) {
                return NextResponse.json({ error: 'Invalid observedAt field' }, { status: 400 });
            }
            updateData.observedAt = parsed;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'source')) {
            if (body.source === null || body.source === '') {
                updateData.source = null;
            } else if (body.source === 'manual' || body.source === 'ai_suggestion') {
                updateData.source = body.source;
            } else {
                return NextResponse.json({ error: 'Invalid source field' }, { status: 400 });
            }
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        await dbServer.update(observations).set(updateData).where(eq(observations.id, id));
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API PUT /observations/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update observation' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const existing = await dbServer
            .select({ id: observations.id })
            .from(observations)
            .where(eq(observations.id, id))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        await dbServer.delete(observations).where(eq(observations.id, id));
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /observations/[id] error:', error);
        return NextResponse.json({ error: 'Failed to delete observation' }, { status: 500 });
    }
}

