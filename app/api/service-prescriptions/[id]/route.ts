/* @Codex */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { servicePrescriptionItems, servicePrescriptions } from '@/lib/schema';
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

type RouteContext = { params: Promise<{ id: string }> };

const STATUSES = new Set(['prescribed', 'booked', 'performed', 'report_received', 'cancelled']);
const CATEGORIES = new Set(['lab', 'imaging', 'visit', 'rehab', 'screening', 'procedure', 'other']);
const PRIORITIES = new Set(['U', 'B', 'D', 'P', 'routine', 'unknown']);
const SOURCES = new Set(['manual', 'document_review', 'legacy_therapy_cleanup']);

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
            .select({ id: servicePrescriptions.id })
            .from(servicePrescriptions)
            .where(eq(servicePrescriptions.id, id))
            .get();
        if (!existing) return NextResponse.json({ error: 'Service prescription not found' }, { status: 404 });

        const body = await request.json() as Record<string, unknown>;
        const updateData: Partial<typeof servicePrescriptions.$inferInsert> = { updatedAt: new Date() };
        const nullableTextFields = [
            'priority',
            'codeSystem',
            'serviceCode',
            'clinicalQuestion',
            'provider',
            'outcomeNote',
            'requestReference',
            'documentRefs',
            'notes',
        ] as const;

        for (const field of nullableTextFields) {
            if (Object.prototype.hasOwnProperty.call(body, field)) {
                updateData[field] = optionalText(body[field]) as never;
            }
        }

        const prescribedAt = parseDate(body.prescribedAt);
        if (prescribedAt instanceof Date) updateData.prescribedAt = prescribedAt;
        const scheduledAt = parseDate(body.scheduledAt);
        if (scheduledAt instanceof Date || scheduledAt === null) updateData.scheduledAt = scheduledAt;
        const performedAt = parseDate(body.performedAt);
        if (performedAt instanceof Date || performedAt === null) updateData.performedAt = performedAt;
        const reportReceivedAt = parseDate(body.reportReceivedAt);
        if (reportReceivedAt instanceof Date || reportReceivedAt === null) updateData.reportReceivedAt = reportReceivedAt;

        const serviceName = optionalText(body.serviceName);
        if (Object.prototype.hasOwnProperty.call(body, 'serviceName')) {
            if (!serviceName) return NextResponse.json({ error: 'Service name cannot be empty' }, { status: 400 });
            updateData.serviceName = serviceName;
        }

        const status = optionalText(body.status);
        if (Object.prototype.hasOwnProperty.call(body, 'status')) {
            if (!status || !STATUSES.has(status)) return NextResponse.json({ error: 'Unsupported service prescription status' }, { status: 400 });
            updateData.status = status;
        }

        const category = optionalText(body.category);
        if (Object.prototype.hasOwnProperty.call(body, 'category')) {
            if (!category || !CATEGORIES.has(category)) return NextResponse.json({ error: 'Unsupported service prescription category' }, { status: 400 });
            updateData.category = category;
        }

        const priority = optionalText(body.priority);
        if (Object.prototype.hasOwnProperty.call(body, 'priority')) {
            if (priority && !PRIORITIES.has(priority)) return NextResponse.json({ error: 'Unsupported service prescription priority' }, { status: 400 });
            updateData.priority = priority;
        }

        const source = optionalText(body.source);
        if (Object.prototype.hasOwnProperty.call(body, 'source')) {
            if (!source || !SOURCES.has(source)) return NextResponse.json({ error: 'Unsupported service prescription source' }, { status: 400 });
            updateData.source = source;
        }

        await dbServer.update(servicePrescriptions).set(updateData).where(eq(servicePrescriptions.id, id));

        await safeWriteAuditEventFromRequest(request, session, {
            eventType: 'service.prescription.updated',
            subjectType: 'service_prescription',
            subjectRef: id,
            redactedMetadata: {
                changedFields: listChangedFields(body, []),
            },
        }, '[MediFlow] Service prescription audit write failed:');

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API PUT /service-prescriptions/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update service prescription' }, { status: 500 });
    }
}

export async function DELETE(request: Request, context: RouteContext) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await context.params;
        const existing = await dbServer
            .select({ id: servicePrescriptions.id })
            .from(servicePrescriptions)
            .where(eq(servicePrescriptions.id, id))
            .get();
        if (!existing) return NextResponse.json({ error: 'Service prescription not found' }, { status: 404 });

        /* @Codex */
        dbServer.transaction((tx) => {
            tx.delete(servicePrescriptionItems).where(eq(servicePrescriptionItems.prescriptionId, id)).run();
            tx.delete(servicePrescriptions).where(eq(servicePrescriptions.id, id)).run();
        });
        await safeWriteAuditEventFromRequest(request, session, {
            eventType: 'service.prescription.deleted',
            subjectType: 'service_prescription',
            subjectRef: id,
        }, '[MediFlow] Service prescription audit write failed:');

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /service-prescriptions/[id] error:', error);
        return NextResponse.json({ error: 'Failed to delete service prescription' }, { status: 500 });
    }
}
