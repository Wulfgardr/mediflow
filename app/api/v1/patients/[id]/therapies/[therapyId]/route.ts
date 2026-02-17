// Codex: created 2026-02-06
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { therapies } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import type { TherapySummary } from '@/lib/api/v1/types';

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

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string; therapyId: string }> }
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id, therapyId } = await params;
        const therapy = await dbServer.select().from(therapies)
            .where(and(eq(therapies.id, therapyId), eq(therapies.patientId, id)))
            .get();

        if (!therapy) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const result: TherapySummary = {
            id: therapy.id,
            patientId: therapy.patientId,
            drugName: therapy.drugName,
            dosage: therapy.dosage,
            status: therapy.status,
            startDate: toIsoString(therapy.startDate) ?? new Date(0).toISOString(),
            endDate: toIsoString(therapy.endDate),
            createdAt: toIsoString(therapy.createdAt),
        };

        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/patients/[id]/therapies/[therapyId] error:', error);
        return NextResponse.json({ error: 'Failed to fetch therapy' }, { status: 500 });
    }
}

/* @Codex */
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string; therapyId: string }> }
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id, therapyId } = await params;
        const body = await request.json();

        const existing = await dbServer.select({ id: therapies.id }).from(therapies)
            .where(and(eq(therapies.id, therapyId), eq(therapies.patientId, id)))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const nextStartDate = parseDate(body.startDate);
        if (body.startDate !== undefined && nextStartDate === undefined) {
            return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 });
        }

        const hasEndDate = Object.prototype.hasOwnProperty.call(body, 'endDate');
        const nextEndDate = body.endDate === null ? null : parseDate(body.endDate);
        if (hasEndDate && body.endDate !== null && nextEndDate === undefined) {
            return NextResponse.json({ error: 'Invalid endDate' }, { status: 400 });
        }

        const nextDrugName = typeof body.drugName === 'string' ? body.drugName : undefined;
        const nextDosage = typeof body.dosage === 'string' ? body.dosage : undefined;
        const nextStatus = typeof body.status === 'string' ? body.status : undefined;

        if (
            nextDrugName === undefined &&
            nextDosage === undefined &&
            nextStatus === undefined &&
            nextStartDate === undefined &&
            !hasEndDate
        ) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        await dbServer.update(therapies)
            .set({
                drugName: nextDrugName,
                dosage: nextDosage,
                status: nextStatus,
                startDate: nextStartDate,
                endDate: hasEndDate ? nextEndDate : undefined
            })
            .where(and(eq(therapies.id, therapyId), eq(therapies.patientId, id)));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API PUT /api/v1/patients/[id]/therapies/[therapyId] error:', error);
        return NextResponse.json({ error: 'Failed to update therapy' }, { status: 500 });
    }
}

/* @Codex */
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; therapyId: string }> }
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id, therapyId } = await params;
        const existing = await dbServer.select({ id: therapies.id }).from(therapies)
            .where(and(eq(therapies.id, therapyId), eq(therapies.patientId, id)))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        await dbServer.delete(therapies).where(and(eq(therapies.id, therapyId), eq(therapies.patientId, id)));
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /api/v1/patients/[id]/therapies/[therapyId] error:', error);
        return NextResponse.json({ error: 'Failed to delete therapy' }, { status: 500 });
    }
}
