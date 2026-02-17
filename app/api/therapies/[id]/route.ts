/* @Codex */
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { therapies } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

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
        const updateData: {
            drugName?: string;
            dosage?: string;
            status?: string;
            startDate?: Date;
            endDate?: Date | null;
        } = {};

        if (body && typeof body === 'object') {
            const payload = body as Record<string, unknown>;

            if (typeof payload.drugName === 'string') updateData.drugName = payload.drugName;
            if (typeof payload.dosage === 'string') updateData.dosage = payload.dosage;
            if (typeof payload.status === 'string') updateData.status = payload.status;

            const parsedStartDate = parseDate(payload.startDate);
            if (parsedStartDate) updateData.startDate = parsedStartDate;

            if (payload.endDate === null || payload.endDate === '') {
                updateData.endDate = null;
            } else {
                const parsedEndDate = parseDate(payload.endDate);
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
        await dbServer.delete(therapies).where(eq(therapies.id, id));
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /therapies/[id] error:', error);
        return NextResponse.json({ error: 'Delete Failed' }, { status: 500 });
    }
}
