/* @Codex */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { servicePrescriptionItems } from '@/lib/schema';
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/security/audit';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { servicePrescriptionItemUpdateSchema } from '@/lib/api-schemas/prescriptions';
import { parseApiBody } from '@/lib/api-schemas/parse';

type RouteContext = { params: Promise<{ id: string }> };

const STATUSES = new Set(['prescribed', 'booked', 'performed', 'report_received', 'cancelled']);
const CATEGORIES = new Set(['lab', 'imaging', 'visit', 'rehab', 'screening', 'procedure', 'other']);
const MATCH_STATUSES = new Set(['unmatched', 'candidate', 'matched', 'manual', 'not_found']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);

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

function optionalInteger(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

export async function PUT(request: Request, context: RouteContext) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await context.params;
        const existing = await dbServer
            .select({ id: servicePrescriptionItems.id })
            .from(servicePrescriptionItems)
            .where(eq(servicePrescriptionItems.id, id))
            .get();
        if (!existing) return NextResponse.json({ error: 'Service prescription item not found' }, { status: 404 });

        const rawBody = await request.json() as Record<string, unknown>;
        const parsedBody = parseApiBody(servicePrescriptionItemUpdateSchema, rawBody);
        if (!parsedBody.ok) return parsedBody.response;
        const body = parsedBody.data;
        const updateData: Partial<typeof servicePrescriptionItems.$inferInsert> = { updatedAt: new Date() };
        const nullableTextFields = [
            'codeSystem',
            'serviceCode',
            'catalogEntryId',
            'catalogDisplayName',
            'evidence',
            'notes',
            'outcomeNote',
        ] as const;

        for (const field of nullableTextFields) {
            if (Object.prototype.hasOwnProperty.call(body, field)) {
                updateData[field] = optionalText(body[field]) as never;
            }
        }

        const ordinal = optionalInteger(body.ordinal);
        if (ordinal !== undefined) updateData.ordinal = ordinal;

        const serviceName = optionalText(body.serviceName);
        if (Object.prototype.hasOwnProperty.call(body, 'serviceName')) {
            if (!serviceName) return NextResponse.json({ error: 'Service item name cannot be empty' }, { status: 400 });
            updateData.serviceName = serviceName;
        }

        const status = optionalText(body.status);
        if (Object.prototype.hasOwnProperty.call(body, 'status')) {
            if (!status || !STATUSES.has(status)) return NextResponse.json({ error: 'Unsupported service item status' }, { status: 400 });
            updateData.status = status;
        }

        const category = optionalText(body.category);
        if (Object.prototype.hasOwnProperty.call(body, 'category')) {
            if (category && !CATEGORIES.has(category)) return NextResponse.json({ error: 'Unsupported service item category' }, { status: 400 });
            updateData.category = category;
        }

        const matchStatus = optionalText(body.matchStatus);
        if (Object.prototype.hasOwnProperty.call(body, 'matchStatus')) {
            if (!matchStatus || !MATCH_STATUSES.has(matchStatus)) return NextResponse.json({ error: 'Unsupported service item match status' }, { status: 400 });
            updateData.matchStatus = matchStatus;
        }

        const confidence = optionalText(body.confidence);
        if (Object.prototype.hasOwnProperty.call(body, 'confidence')) {
            if (confidence && !CONFIDENCES.has(confidence)) return NextResponse.json({ error: 'Unsupported service item confidence' }, { status: 400 });
            updateData.confidence = confidence;
        }

        const scheduledAt = parseDate(body.scheduledAt);
        if (scheduledAt instanceof Date || scheduledAt === null) updateData.scheduledAt = scheduledAt;
        const performedAt = parseDate(body.performedAt);
        if (performedAt instanceof Date || performedAt === null) updateData.performedAt = performedAt;
        const reportReceivedAt = parseDate(body.reportReceivedAt);
        if (reportReceivedAt instanceof Date || reportReceivedAt === null) updateData.reportReceivedAt = reportReceivedAt;

        await dbServer.update(servicePrescriptionItems).set(updateData).where(eq(servicePrescriptionItems.id, id));
        await safeWriteAuditEventFromRequest(request, session, {
            eventType: 'service.prescription_item.updated',
            subjectType: 'service_prescription_item',
            subjectRef: id,
            redactedMetadata: {
                changedFields: listChangedFields(body as Record<string, unknown>, []),
            },
        }, '[MediFlow] Service prescription item audit write failed:');

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API PUT /service-prescription-items/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update service prescription item' }, { status: 500 });
    }
}

export async function DELETE(request: Request, context: RouteContext) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await context.params;
        await dbServer.delete(servicePrescriptionItems).where(eq(servicePrescriptionItems.id, id));
        await safeWriteAuditEventFromRequest(request, session, {
            eventType: 'service.prescription_item.deleted',
            subjectType: 'service_prescription_item',
            subjectRef: id,
        }, '[MediFlow] Service prescription item audit write failed:');
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /service-prescription-items/[id] error:', error);
        return NextResponse.json({ error: 'Failed to delete service prescription item' }, { status: 500 });
    }
}
