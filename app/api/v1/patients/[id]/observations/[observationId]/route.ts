/* @Codex */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { observations } from '@/lib/schema';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import type { ObservationSummary } from '@/lib/api/v1/types';

/* @Codex */
function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* @Codex */
function parseDate(value: unknown): Date | undefined {
    if (!value) return undefined;
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

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string; observationId: string }> },
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id, observationId } = await params;
        const item = await dbServer
            .select()
            .from(observations)
            .where(and(eq(observations.id, observationId), eq(observations.patientId, id)))
            .get();

        if (!item) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const result: ObservationSummary = {
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
        };

        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/patients/[id]/observations/[observationId] error:', error);
        return NextResponse.json({ error: 'Failed to fetch observation' }, { status: 500 });
    }
}

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string; observationId: string }> },
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id, observationId } = await params;
        const body = await request.json();

        const existing = await dbServer
            .select({ id: observations.id })
            .from(observations)
            .where(and(eq(observations.id, observationId), eq(observations.patientId, id)))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const updateData: Partial<typeof observations.$inferInsert> = {};
        if (typeof body.codeSystem === 'string') {
            const codeSystem = body.codeSystem.trim().toUpperCase();
            if (codeSystem !== 'LOINC') {
                return NextResponse.json({ error: 'Only LOINC observations are supported' }, { status: 400 });
            }
            updateData.codeSystem = codeSystem;
        }
        if (typeof body.code === 'string') updateData.code = body.code.trim();
        if (typeof body.display === 'string') updateData.display = body.display.trim();
        if (typeof body.unitSystem === 'string') {
            const unitSystem = body.unitSystem.trim().toUpperCase();
            if (unitSystem !== 'UCUM') {
                return NextResponse.json({ error: 'Only UCUM units are supported' }, { status: 400 });
            }
            updateData.unitSystem = unitSystem;
        }
        if (typeof body.unitCode === 'string') updateData.unitCode = body.unitCode.trim();

        if (Object.prototype.hasOwnProperty.call(body, 'value')) {
            const value = normalizeValue(body.value);
            if (value === undefined) {
                return NextResponse.json({ error: 'Invalid value field' }, { status: 400 });
            }
            updateData.value = value;
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
            const observedAt = parseDate(body.observedAt);
            if (!observedAt) {
                return NextResponse.json({ error: 'Invalid observedAt field' }, { status: 400 });
            }
            updateData.observedAt = observedAt;
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

        await dbServer
            .update(observations)
            .set(updateData)
            .where(and(eq(observations.id, observationId), eq(observations.patientId, id)));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API PUT /api/v1/patients/[id]/observations/[observationId] error:', error);
        return NextResponse.json({ error: 'Failed to update observation' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; observationId: string }> },
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id, observationId } = await params;
        const existing = await dbServer
            .select({ id: observations.id })
            .from(observations)
            .where(and(eq(observations.id, observationId), eq(observations.patientId, id)))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        await dbServer
            .delete(observations)
            .where(and(eq(observations.id, observationId), eq(observations.patientId, id)));
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /api/v1/patients/[id]/observations/[observationId] error:', error);
        return NextResponse.json({ error: 'Failed to delete observation' }, { status: 500 });
    }
}
