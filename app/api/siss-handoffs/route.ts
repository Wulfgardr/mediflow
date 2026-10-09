/* @Codex */
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { dbServer } from '@/lib/db-server';
import { patients, sissHandoffEvents } from '@/lib/schema';
import { auditContextFromSession, listChangedFields, requestIdFromRequest,
    withAuditContextMetadata, writeAuditEventInTransaction } from '@/lib/security/audit';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { sissHandoffCreateSchema } from '@/lib/api-schemas/siss-handoffs';
import { parseApiBody } from '@/lib/api-schemas/parse';
import { readBoundedJsonBody } from '@/lib/bounded-request-body';

// Local handoff notes and metadata; no documents or attachment payloads.
const SISS_HANDOFF_JSON_MAX_BYTES = 262_144;

const OUTCOMES = new Set(['started', 'completed', 'blocked', 'cancelled']);
const ACTION_LABELS: Record<string, string> = {
    'menu.open': 'Menu SISS',
    'prescription.create': 'Prescrittivo Regionale (PRREG)',
    'prosthetics.open': 'Protesica-RL',
    'fse.lookup': 'FSE',
    'registry.lookup': 'Anagrafe',
};

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
        let query = dbServer.select().from(sissHandoffEvents);
        if (patientId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            query = query.where(eq(sissHandoffEvents.patientId, patientId)) as any;
        }

        const data = await query.orderBy(desc(sissHandoffEvents.startedAt));
        return NextResponse.json(data);
    } catch (error) {
        console.error('API GET /siss-handoffs error:', error);
        return NextResponse.json({ error: 'Failed to fetch SISS handoffs' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const parsed = await readBoundedJsonBody(request, SISS_HANDOFF_JSON_MAX_BYTES, 'request-json');
        if (!parsed.ok) {
            return NextResponse.json({ error: parsed.status === 413 ? 'Richiesta troppo grande.' : 'Richiesta non valida.' },
                { status: parsed.status });
        }
        const rawBody = parsed.value;
        const parsedBody = parseApiBody(sissHandoffCreateSchema, rawBody);
        if (!parsedBody.ok) return parsedBody.response;
        const body = parsedBody.data;
        const patientId = optionalText(body.patientId);
        const action = optionalText(body.action);
        const outcome = optionalText(body.outcome) ?? 'started';
        const startedAt = parseDate(body.startedAt) ?? new Date();

        if (!patientId || !action) {
            return NextResponse.json({ error: 'Missing required SISS handoff fields' }, { status: 400 });
        }

        if (!OUTCOMES.has(outcome)) {
            return NextResponse.json({ error: 'Unsupported SISS handoff outcome' }, { status: 400 });
        }

        const completedAt = parseDate(body.completedAt);
        const id = optionalText(body.id) ?? uuidv4();
        const moduleLabel = optionalText(body.moduleLabel) ?? ACTION_LABELS[action] ?? action;

        const auditContext = auditContextFromSession(session);
        const requestId = requestIdFromRequest(request);
        const result = dbServer.transaction((tx) => {
            const patient = tx.select({ deletedAt: patients.deletedAt }).from(patients)
                .where(eq(patients.id, patientId)).get();
            if (!patient || patient.deletedAt) {
                return { status: 404, value: { error: 'Patient not found' } } as const;
            }
            if (tx.select({ id: sissHandoffEvents.id }).from(sissHandoffEvents)
                .where(eq(sissHandoffEvents.id, id)).get()) {
                return { status: 409, value: { error: 'SISS handoff already exists' } } as const;
            }
            const inserted = tx.insert(sissHandoffEvents).values({
                id,
                patientId,
                action,
                moduleLabel,
                reason: optionalText(body.reason),
                startedAt,
                completedAt,
                outcome,
                nextAction: optionalText(body.nextAction),
                notes: optionalText(body.notes),
                correlationId: optionalText(body.correlationId),
                createdAt: new Date(),
                updatedAt: new Date(),
            }).run();
            if (inserted.changes !== 1) throw new Error('SISS handoff insert did not modify exactly one row');
            writeAuditEventInTransaction(tx, {
                eventType: 'siss.handoff.created',
                outcome: 'success',
                actorType: auditContext.actorType,
                actorRef: auditContext.actorRef,
                subjectType: 'siss_handoff',
                subjectRef: id,
                sourceSurface: auditContext.sourceSurface,
                requestId,
                redactedMetadata: withAuditContextMetadata(auditContext, {
                    changedFields: listChangedFields(body as Record<string, unknown>, ['id']),
                    flags: [`action:${action}`, `outcome:${outcome}`],
                }),
            });
            return { status: 201, value: { id, version: 1 } } as const;
        }, { behavior: 'immediate' });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /siss-handoffs error:', error);
        return NextResponse.json({ error: 'Failed to create SISS handoff' }, { status: 500 });
    }
}
