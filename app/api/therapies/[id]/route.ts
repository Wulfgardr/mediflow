/* @Codex */
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { therapies } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { parseTherapyStatus } from '@/lib/status-normalization';

function parseDate(value: unknown): Date | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const body = await request.json() as unknown;
        const existing = await dbServer.select({ id: therapies.id }).from(therapies).where(eq(therapies.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const updateData: {
            drugName?: string;
            /* @Codex */
            aic?: string | null;
            /* @Codex */
            atc?: string | null;
            /* @Codex */
            activePrinciple?: string | null;
            dosage?: string;
            /* @Codex */
            motivation?: string | null;
            /* @Codex */
            diagnosisCode?: string | null;
            /* @Codex */
            diagnosisName?: string | null;
            status?: string;
            startDate?: Date;
            endDate?: Date | null;
        } = {};

        if (body && typeof body === 'object') {
            const payload = body as Record<string, unknown>;

            if (typeof payload.drugName === 'string') updateData.drugName = payload.drugName;
            /* @Codex */
            if (payload.aic === null || payload.aic === '') {
                updateData.aic = null;
            } else if (typeof payload.aic === 'string') {
                updateData.aic = payload.aic;
            }
            /* @Codex */
            if (payload.atc === null || payload.atc === '') {
                updateData.atc = null;
            } else if (typeof payload.atc === 'string') {
                updateData.atc = payload.atc;
            }
            /* @Codex */
            if (payload.activePrinciple === null || payload.activePrinciple === '') {
                updateData.activePrinciple = null;
            } else if (typeof payload.activePrinciple === 'string') {
                updateData.activePrinciple = payload.activePrinciple;
            }
            if (typeof payload.dosage === 'string') updateData.dosage = payload.dosage;
            /* @Codex */
            if (payload.motivation === null || payload.motivation === '') {
                updateData.motivation = null;
            } else if (typeof payload.motivation === 'string') {
                updateData.motivation = payload.motivation;
            }
            /* @Codex */
            if (payload.diagnosisCode === null || payload.diagnosisCode === '') {
                updateData.diagnosisCode = null;
            } else if (typeof payload.diagnosisCode === 'string') {
                updateData.diagnosisCode = payload.diagnosisCode;
            }
            /* @Codex */
            if (payload.diagnosisName === null || payload.diagnosisName === '') {
                updateData.diagnosisName = null;
            } else if (typeof payload.diagnosisName === 'string') {
                updateData.diagnosisName = payload.diagnosisName;
            }
            if (typeof payload.status === 'string') {
                const parsedStatus = parseTherapyStatus(payload.status);
                if (!parsedStatus) {
                    return NextResponse.json({ error: 'Invalid therapy status' }, { status: 400 });
                }
                updateData.status = parsedStatus;
            }

            const hasStartDate = Object.prototype.hasOwnProperty.call(payload, 'startDate');
            const parsedStartDate = parseDate(payload.startDate);
            if (hasStartDate && parsedStartDate === undefined) {
                return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 });
            }
            if (parsedStartDate) updateData.startDate = parsedStartDate;

            if (payload.endDate === null || payload.endDate === '') {
                updateData.endDate = null;
            } else {
                const parsedEndDate = parseDate(payload.endDate);
                if (Object.prototype.hasOwnProperty.call(payload, 'endDate') && parsedEndDate === undefined) {
                    return NextResponse.json({ error: 'Invalid endDate' }, { status: 400 });
                }
                if (parsedEndDate) updateData.endDate = parsedEndDate;
            }
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        await dbServer.update(therapies).set(updateData).where(eq(therapies.id, id));
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API PUT /therapies/[id] error:', error);
        return NextResponse.json({ error: 'Update Failed' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const existing = await dbServer.select({ id: therapies.id }).from(therapies).where(eq(therapies.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        await dbServer.delete(therapies).where(eq(therapies.id, id));
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /therapies/[id] error:', error);
        return NextResponse.json({ error: 'Delete Failed' }, { status: 500 });
    }
}
