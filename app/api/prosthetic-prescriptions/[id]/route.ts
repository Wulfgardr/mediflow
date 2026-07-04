/* @Codex */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { prostheticPrescriptions } from '@/lib/schema';
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
import { prostheticPrescriptionUpdateSchema } from '@/lib/api-schemas/prescriptions';
import { parseApiBody } from '@/lib/api-schemas/parse';

type RouteContext = { params: Promise<{ id: string }> };

const STATUSES = new Set(['draft', 'prescribed', 'submitted', 'authorized', 'delivered', 'tested', 'cancelled']);
const CATEGORIES = new Set(['standard', 'oxygen', 'repair', 'replacement', 'trial', 'other']);
const SOURCES = new Set(['manual', 'document_review']);

function parseDate(value: unknown): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function optionalText(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return typeof value === 'string' ? value.trim() || null : undefined;
}

export async function PUT(request: Request, context: RouteContext) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await context.params;
        const existing = await dbServer
            .select({ id: prostheticPrescriptions.id })
            .from(prostheticPrescriptions)
            .where(eq(prostheticPrescriptions.id, id))
            .get();
        if (!existing) return NextResponse.json({ error: 'Prosthetic prescription not found' }, { status: 404 });

        const rawBody = await request.json() as Record<string, unknown>;
        const parsedBody = parseApiBody(prostheticPrescriptionUpdateSchema, rawBody);
        if (!parsedBody.ok) return parsedBody.response;
        const body = parsedBody.data;
        const updateData: Partial<typeof prostheticPrescriptions.$inferInsert> = { updatedAt: new Date() };
        const nullableTextFields = ['isoCode', 'measures', 'clinicalReason', 'regionalPrescriptionId', 'supplier', 'collaudoOutcome', 'documentRefs', 'notes'] as const;

        for (const field of nullableTextFields) {
            if (Object.prototype.hasOwnProperty.call(body, field)) {
                updateData[field] = optionalText(body[field]) as never;
            }
        }

        const prescribedAt = parseDate(body.prescribedAt);
        if (prescribedAt instanceof Date) updateData.prescribedAt = prescribedAt;
        const collaudoAt = parseDate(body.collaudoAt);
        if (collaudoAt instanceof Date) updateData.collaudoAt = collaudoAt;

        const description = optionalText(body.description);
        if (Object.prototype.hasOwnProperty.call(body, 'description')) {
            if (!description) return NextResponse.json({ error: 'Description cannot be empty' }, { status: 400 });
            updateData.description = description;
        }

        const status = optionalText(body.status);
        if (Object.prototype.hasOwnProperty.call(body, 'status')) {
            if (!status || !STATUSES.has(status)) return NextResponse.json({ error: 'Unsupported prosthetic prescription status' }, { status: 400 });
            updateData.status = status;
        }

        const category = optionalText(body.category);
        if (Object.prototype.hasOwnProperty.call(body, 'category')) {
            if (!category || !CATEGORIES.has(category)) return NextResponse.json({ error: 'Unsupported prosthetic prescription category' }, { status: 400 });
            updateData.category = category;
        }

        const source = optionalText(body.source);
        if (Object.prototype.hasOwnProperty.call(body, 'source')) {
            if (!source || !SOURCES.has(source)) return NextResponse.json({ error: 'Unsupported prosthetic prescription source' }, { status: 400 });
            updateData.source = source;
        }

        await dbServer.update(prostheticPrescriptions).set(updateData).where(eq(prostheticPrescriptions.id, id));

        await safeWriteAuditEventFromRequest(request, session, {
            eventType: 'prosthetic.prescription.updated',
            subjectType: 'prosthetic_prescription',
            subjectRef: id,
            redactedMetadata: {
                changedFields: listChangedFields(body as Record<string, unknown>, []),
            },
        }, '[MediFlow] Prosthetic prescription audit write failed:');

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API PUT /prosthetic-prescriptions/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update prosthetic prescription' }, { status: 500 });
    }
}

export async function DELETE(request: Request, context: RouteContext) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await context.params;
        const existing = await dbServer
            .select({ id: prostheticPrescriptions.id })
            .from(prostheticPrescriptions)
            .where(eq(prostheticPrescriptions.id, id))
            .get();
        if (!existing) return NextResponse.json({ error: 'Prosthetic prescription not found' }, { status: 404 });

        await dbServer.delete(prostheticPrescriptions).where(eq(prostheticPrescriptions.id, id));
        await safeWriteAuditEventFromRequest(request, session, {
            eventType: 'prosthetic.prescription.deleted',
            subjectType: 'prosthetic_prescription',
            subjectRef: id,
        }, '[MediFlow] Prosthetic prescription audit write failed:');

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /prosthetic-prescriptions/[id] error:', error);
        return NextResponse.json({ error: 'Failed to delete prosthetic prescription' }, { status: 500 });
    }
}
