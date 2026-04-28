/* @Codex */
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { dbServer } from '@/lib/db-server';
import { prostheticPrescriptions } from '@/lib/schema';
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

/* @Codex */
const STATUSES = new Set(['draft', 'prescribed', 'submitted', 'authorized', 'delivered', 'tested', 'cancelled']);
/* @Codex */
const CATEGORIES = new Set(['standard', 'oxygen', 'repair', 'replacement', 'trial', 'other']);

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
        let query = dbServer.select().from(prostheticPrescriptions);
        if (patientId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            query = query.where(eq(prostheticPrescriptions.patientId, patientId)) as any;
        }

        const data = await query.orderBy(desc(prostheticPrescriptions.prescribedAt));
        return NextResponse.json(data);
    } catch (error) {
        console.error('API GET /prosthetic-prescriptions error:', error);
        return NextResponse.json({ error: 'Failed to fetch prosthetic prescriptions' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json() as Record<string, unknown>;
        const patientId = optionalText(body.patientId);
        const description = optionalText(body.description);
        const prescribedAt = parseDate(body.prescribedAt);
        const status = optionalText(body.status) ?? 'prescribed';
        const category = optionalText(body.category) ?? 'standard';
        const source = body.source === 'document_review' ? 'document_review' : 'manual';

        if (!patientId || !description || !prescribedAt) {
            return NextResponse.json({ error: 'Missing required prosthetic prescription fields' }, { status: 400 });
        }

        if (!STATUSES.has(status) || !CATEGORIES.has(category)) {
            return NextResponse.json({ error: 'Unsupported prosthetic prescription status or category' }, { status: 400 });
        }

        const id = optionalText(body.id) ?? uuidv4();
        await dbServer.insert(prostheticPrescriptions).values({
            id,
            patientId,
            prescribedAt,
            status,
            category,
            isoCode: optionalText(body.isoCode),
            description,
            measures: optionalText(body.measures),
            clinicalReason: optionalText(body.clinicalReason),
            regionalPrescriptionId: optionalText(body.regionalPrescriptionId),
            supplier: optionalText(body.supplier),
            collaudoAt: parseDate(body.collaudoAt),
            collaudoOutcome: optionalText(body.collaudoOutcome),
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
                eventType: 'prosthetic.prescription.created',
                subjectType: 'prosthetic_prescription',
                subjectRef: id,
                redactedMetadata: {
                    changedFields: listChangedFields(body, ['id']),
                    flags: [`source:${source}`, `status:${status}`, `category:${category}`],
                },
            },
            '[MediFlow] Prosthetic prescription audit write failed:',
        );

        return NextResponse.json({ id }, { status: 201 });
    } catch (error) {
        console.error('API POST /prosthetic-prescriptions error:', error);
        return NextResponse.json({ error: 'Failed to create prosthetic prescription' }, { status: 500 });
    }
}
