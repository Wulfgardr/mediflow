/* @Codex */
import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { dbServer } from '@/lib/db-server';
import { servicePrescriptionItems, servicePrescriptions } from '@/lib/schema';
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

const STATUSES = new Set(['prescribed', 'booked', 'performed', 'report_received', 'cancelled']);
const CATEGORIES = new Set(['lab', 'imaging', 'visit', 'rehab', 'screening', 'procedure', 'other']);
const MATCH_STATUSES = new Set(['unmatched', 'candidate', 'matched', 'manual', 'not_found']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);

function parseDate(value: unknown): Date | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function optionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function optionalInteger(value: unknown, fallback = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

export async function GET(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId')?.trim();
    const prescriptionId = searchParams.get('prescriptionId')?.trim();

    try {
        let query = dbServer.select().from(servicePrescriptionItems);
        if (prescriptionId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            query = query.where(eq(servicePrescriptionItems.prescriptionId, prescriptionId)) as any;
        } else if (patientId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            query = query.where(eq(servicePrescriptionItems.patientId, patientId)) as any;
        }

        const data = await query.orderBy(asc(servicePrescriptionItems.prescriptionId), asc(servicePrescriptionItems.ordinal));
        return NextResponse.json(data);
    } catch (error) {
        console.error('API GET /service-prescription-items error:', error);
        return NextResponse.json({ error: 'Failed to fetch service prescription items' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json() as Record<string, unknown>;
        const prescriptionId = optionalText(body.prescriptionId);
        const serviceName = optionalText(body.serviceName);
        const status = optionalText(body.status) ?? 'prescribed';
        const category = optionalText(body.category);
        const matchStatus = optionalText(body.matchStatus) ?? 'unmatched';
        const confidence = optionalText(body.confidence);

        if (!prescriptionId || !serviceName) {
            return NextResponse.json({ error: 'Missing required service prescription item fields' }, { status: 400 });
        }

        if (!STATUSES.has(status) || !MATCH_STATUSES.has(matchStatus)) {
            return NextResponse.json({ error: 'Unsupported service item status or match status' }, { status: 400 });
        }

        if (category && !CATEGORIES.has(category)) {
            return NextResponse.json({ error: 'Unsupported service item category' }, { status: 400 });
        }

        if (confidence && !CONFIDENCES.has(confidence)) {
            return NextResponse.json({ error: 'Unsupported service item confidence' }, { status: 400 });
        }

        const parent = await dbServer
            .select({ id: servicePrescriptions.id, patientId: servicePrescriptions.patientId })
            .from(servicePrescriptions)
            .where(eq(servicePrescriptions.id, prescriptionId))
            .get();
        if (!parent) return NextResponse.json({ error: 'Service prescription not found' }, { status: 404 });

        const id = optionalText(body.id) ?? uuidv4();
        await dbServer.insert(servicePrescriptionItems).values({
            id,
            patientId: parent.patientId,
            prescriptionId,
            ordinal: optionalInteger(body.ordinal),
            status,
            category,
            codeSystem: optionalText(body.codeSystem),
            serviceCode: optionalText(body.serviceCode),
            serviceName,
            catalogEntryId: optionalText(body.catalogEntryId),
            catalogDisplayName: optionalText(body.catalogDisplayName),
            matchStatus,
            confidence,
            evidence: optionalText(body.evidence),
            notes: optionalText(body.notes),
            scheduledAt: parseDate(body.scheduledAt),
            performedAt: parseDate(body.performedAt),
            reportReceivedAt: parseDate(body.reportReceivedAt),
            outcomeNote: optionalText(body.outcomeNote),
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        await safeWriteAuditEventFromRequest(request, session, {
            eventType: 'service.prescription_item.created',
            subjectType: 'service_prescription_item',
            subjectRef: id,
            redactedMetadata: {
                changedFields: listChangedFields(body, ['id']),
                flags: [`status:${status}`, `match:${matchStatus}`],
            },
        }, '[MediFlow] Service prescription item audit write failed:');

        return NextResponse.json({ id }, { status: 201 });
    } catch (error) {
        console.error('API POST /service-prescription-items error:', error);
        return NextResponse.json({ error: 'Failed to create service prescription item' }, { status: 500 });
    }
}
