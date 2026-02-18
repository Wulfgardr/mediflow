// Codex: created 2026-02-06
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { therapies } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import type { TherapySummary } from '@/lib/api/v1/types';
/* @Codex */
import { normalizeTherapyStatus, parseTherapyStatus } from '@/lib/status-normalization';

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
            activePrinciple: therapy.activePrinciple ?? null,
            dosage: therapy.dosage,
            motivation: therapy.motivation ?? null,
            diagnosisCode: therapy.diagnosisCode ?? null,
            diagnosisName: therapy.diagnosisName ?? null,
            status: normalizeTherapyStatus(therapy.status),
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
        const hasActivePrinciple = Object.prototype.hasOwnProperty.call(body, 'activePrinciple');
        const nextActivePrinciple = hasActivePrinciple
            ? (typeof body.activePrinciple === 'string'
                ? body.activePrinciple
                : body.activePrinciple === null || body.activePrinciple === ''
                    ? null
                    : undefined)
            : undefined;
        const nextDosage = typeof body.dosage === 'string' ? body.dosage : undefined;
        const hasMotivation = Object.prototype.hasOwnProperty.call(body, 'motivation');
        const nextMotivation = hasMotivation
            ? (typeof body.motivation === 'string'
                ? body.motivation
                : body.motivation === null || body.motivation === ''
                    ? null
                    : undefined)
            : undefined;
        const hasDiagnosisCode = Object.prototype.hasOwnProperty.call(body, 'diagnosisCode');
        const nextDiagnosisCode = hasDiagnosisCode
            ? (typeof body.diagnosisCode === 'string'
                ? body.diagnosisCode
                : body.diagnosisCode === null || body.diagnosisCode === ''
                    ? null
                    : undefined)
            : undefined;
        const hasDiagnosisName = Object.prototype.hasOwnProperty.call(body, 'diagnosisName');
        const nextDiagnosisName = hasDiagnosisName
            ? (typeof body.diagnosisName === 'string'
                ? body.diagnosisName
                : body.diagnosisName === null || body.diagnosisName === ''
                    ? null
                    : undefined)
            : undefined;
        /* @Codex */
        let nextStatus: string | undefined;
        if (typeof body.status === 'string') {
            const parsedStatus = parseTherapyStatus(body.status);
            if (!parsedStatus) {
                return NextResponse.json({ error: 'Invalid therapy status' }, { status: 400 });
            }
            nextStatus = parsedStatus;
        }

        if (
            nextDrugName === undefined &&
            nextActivePrinciple === undefined &&
            nextDosage === undefined &&
            nextMotivation === undefined &&
            nextDiagnosisCode === undefined &&
            nextDiagnosisName === undefined &&
            nextStatus === undefined &&
            nextStartDate === undefined &&
            !hasEndDate
        ) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        await dbServer.update(therapies)
            .set({
                drugName: nextDrugName,
                activePrinciple: nextActivePrinciple,
                dosage: nextDosage,
                motivation: nextMotivation,
                diagnosisCode: nextDiagnosisCode,
                diagnosisName: nextDiagnosisName,
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
