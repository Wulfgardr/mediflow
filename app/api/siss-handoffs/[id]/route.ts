/* @Codex */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { sissHandoffEvents } from '@/lib/schema';
import { auditContextFromSession, listChangedFields, requestIdFromRequest,
    withAuditContextMetadata, writeAuditEventInTransaction } from '@/lib/security/audit';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { sissHandoffUpdateSchema } from '@/lib/api-schemas/siss-handoffs';
import { parseApiBody } from '@/lib/api-schemas/parse';
import { readBoundedJsonBody } from '@/lib/bounded-request-body';

// Local handoff notes and metadata; no documents or attachment payloads.
const SISS_HANDOFF_JSON_MAX_BYTES = 262_144;

type RouteContext = { params: Promise<{ id: string }> };

const OUTCOMES = new Set(['started', 'completed', 'blocked', 'cancelled']);

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

        const parsed = await readBoundedJsonBody(request, SISS_HANDOFF_JSON_MAX_BYTES, 'request-json');
        if (!parsed.ok) {
            return NextResponse.json({ error: parsed.status === 413 ? 'Richiesta troppo grande.' : 'Richiesta non valida.' },
                { status: parsed.status });
        }
        const rawBody = parsed.value;
        const parsedBody = parseApiBody(sissHandoffUpdateSchema, rawBody);
        if (!parsedBody.ok) return parsedBody.response;
        const body = parsedBody.data;
        const updateData: Partial<typeof sissHandoffEvents.$inferInsert> = { updatedAt: new Date() };
        const nullableTextFields = ['reason', 'nextAction', 'notes', 'correlationId'] as const;

        for (const field of nullableTextFields) {
            if (Object.prototype.hasOwnProperty.call(body, field)) {
                updateData[field] = optionalText(body[field]) as never;
            }
        }

        const startedAt = parseDate(body.startedAt);
        if (startedAt instanceof Date) updateData.startedAt = startedAt;
        const completedAt = parseDate(body.completedAt);
        if (completedAt instanceof Date || completedAt === null) updateData.completedAt = completedAt;

        const moduleLabel = optionalText(body.moduleLabel);
        if (Object.prototype.hasOwnProperty.call(body, 'moduleLabel')) {
            if (!moduleLabel) return NextResponse.json({ error: 'Module label cannot be empty' }, { status: 400 });
            updateData.moduleLabel = moduleLabel;
        }

        const action = optionalText(body.action);
        if (Object.prototype.hasOwnProperty.call(body, 'action')) {
            if (!action) return NextResponse.json({ error: 'Action cannot be empty' }, { status: 400 });
            updateData.action = action;
        }

        const outcome = optionalText(body.outcome);
        if (Object.prototype.hasOwnProperty.call(body, 'outcome')) {
            if (!outcome || !OUTCOMES.has(outcome)) return NextResponse.json({ error: 'Unsupported SISS handoff outcome' }, { status: 400 });
            updateData.outcome = outcome;
            if (outcome !== 'started' && !Object.prototype.hasOwnProperty.call(body, 'completedAt')) {
                updateData.completedAt = new Date();
            }
        }

        const auditContext = auditContextFromSession(session);
        const requestId = requestIdFromRequest(request);
        const result = dbServer.transaction((tx) => {
            const existing = tx.select({ id: sissHandoffEvents.id }).from(sissHandoffEvents)
                .where(eq(sissHandoffEvents.id, id)).get();
            if (!existing) return { status: 404, value: { error: 'SISS handoff not found' } } as const;
            const changed = tx.update(sissHandoffEvents).set(updateData).where(eq(sissHandoffEvents.id, id)).run();
            if (changed.changes !== 1) throw new Error('SISS handoff update did not modify exactly one row');
            writeAuditEventInTransaction(tx, {
                eventType: 'siss.handoff.updated',
                outcome: 'success',
                actorType: auditContext.actorType,
                actorRef: auditContext.actorRef,
                subjectType: 'siss_handoff',
                subjectRef: id,
                sourceSurface: auditContext.sourceSurface,
                requestId,
                redactedMetadata: withAuditContextMetadata(auditContext, {
                    changedFields: listChangedFields(body as Record<string, unknown>, []),
                }),
            });
            return { status: 200, value: { success: true } } as const;
        }, { behavior: 'immediate' });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API PUT /siss-handoffs/[id] error:', error);
        return NextResponse.json({ error: 'Failed to update SISS handoff' }, { status: 500 });
    }
}

export async function DELETE(request: Request, context: RouteContext) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await context.params;

        const auditContext = auditContextFromSession(session);
        const requestId = requestIdFromRequest(request);
        const result = dbServer.transaction((tx) => {
            const existing = tx.select({ id: sissHandoffEvents.id }).from(sissHandoffEvents)
                .where(eq(sissHandoffEvents.id, id)).get();
            if (!existing) return { status: 404, value: { error: 'SISS handoff not found' } } as const;
            const changed = tx.delete(sissHandoffEvents).where(eq(sissHandoffEvents.id, id)).run();
            if (changed.changes !== 1) throw new Error('SISS handoff delete did not modify exactly one row');
            writeAuditEventInTransaction(tx, {
                eventType: 'siss.handoff.deleted',
                outcome: 'success',
                actorType: auditContext.actorType,
                actorRef: auditContext.actorRef,
                subjectType: 'siss_handoff',
                subjectRef: id,
                sourceSurface: auditContext.sourceSurface,
                requestId,
                redactedMetadata: withAuditContextMetadata(auditContext, {}),
            });
            return { status: 200, value: { success: true } } as const;
        }, { behavior: 'immediate' });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API DELETE /siss-handoffs/[id] error:', error);
        return NextResponse.json({ error: 'Failed to delete SISS handoff' }, { status: 500 });
    }
}
