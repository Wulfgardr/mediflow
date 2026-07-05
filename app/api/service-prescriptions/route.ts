/* @Codex */
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { dbServer } from '@/lib/db-server';
import { servicePrescriptions } from '@/lib/schema';
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/security/audit';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { servicePrescriptionCreateSchema } from '@/lib/api-schemas/prescriptions';
import { parseApiBody } from '@/lib/api-schemas/parse';

const STATUSES = new Set(['prescribed', 'booked', 'performed', 'report_received', 'cancelled']);
const CATEGORIES = new Set(['lab', 'imaging', 'visit', 'rehab', 'screening', 'procedure', 'other']);
const PRIORITIES = new Set(['U', 'B', 'D', 'P', 'routine', 'unknown']);
const SOURCES = new Set(['manual', 'document_review', 'legacy_therapy_cleanup']);

function parseDate(value: unknown): Date | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function optionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export async function GET(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');

    try {
        let query = dbServer.select().from(servicePrescriptions);
        if (patientId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            query = query.where(eq(servicePrescriptions.patientId, patientId)) as any;
        }

        const data = await query.orderBy(desc(servicePrescriptions.prescribedAt));
        return NextResponse.json(data);
    } catch (error) {
        console.error('API GET /service-prescriptions error:', error);
        return NextResponse.json({ error: 'Failed to fetch service prescriptions' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const rawBody = await request.json() as Record<string, unknown>;
        const parsedBody = parseApiBody(servicePrescriptionCreateSchema, rawBody);
        if (!parsedBody.ok) return parsedBody.response;
        const body = parsedBody.data;
        const patientId = optionalText(body.patientId);
        const serviceName = optionalText(body.serviceName);
        const prescribedAt = parseDate(body.prescribedAt);
        const status = optionalText(body.status) ?? 'prescribed';
        const category = optionalText(body.category) ?? 'other';
        const priority = optionalText(body.priority);
        const source = optionalText(body.source) ?? 'manual';

        if (!patientId || !serviceName || !prescribedAt) {
            return NextResponse.json({ error: 'Missing required service prescription fields' }, { status: 400 });
        }

        if (!STATUSES.has(status) || !CATEGORIES.has(category) || !SOURCES.has(source)) {
            return NextResponse.json({ error: 'Unsupported service prescription status, category, or source' }, { status: 400 });
        }

        if (priority && !PRIORITIES.has(priority)) {
            return NextResponse.json({ error: 'Unsupported service prescription priority' }, { status: 400 });
        }

        const id = optionalText(body.id) ?? uuidv4();
        await dbServer.insert(servicePrescriptions).values({
            id,
            patientId,
            prescribedAt,
            status,
            category,
            priority,
            codeSystem: optionalText(body.codeSystem),
            serviceCode: optionalText(body.serviceCode),
            serviceName,
            clinicalQuestion: optionalText(body.clinicalQuestion),
            provider: optionalText(body.provider),
            scheduledAt: parseDate(body.scheduledAt),
            performedAt: parseDate(body.performedAt),
            reportReceivedAt: parseDate(body.reportReceivedAt),
            outcomeNote: optionalText(body.outcomeNote),
            requestReference: optionalText(body.requestReference),
            source,
            documentRefs: optionalText(body.documentRefs),
            notes: optionalText(body.notes),
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: 'service.prescription.created',
                subjectType: 'service_prescription',
                subjectRef: id,
                redactedMetadata: {
                    changedFields: listChangedFields(body as Record<string, unknown>, ['id']),
                    flags: [`source:${source}`, `status:${status}`, `category:${category}`],
                },
            },
            '[MediFlow] Service prescription audit write failed:',
        );

        return NextResponse.json({ id }, { status: 201 });
    } catch (error) {
        console.error('API POST /service-prescriptions error:', error);
        return NextResponse.json({ error: 'Failed to create service prescription' }, { status: 500 });
    }
}
