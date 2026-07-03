/* @Codex */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { sissHandoffEvents } from '@/lib/schema';
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
import { sissHandoffUpdateSchema } from '@/lib/api-schemas/siss-handoffs';
import { parseApiBody } from '@/lib/api-schemas/parse';

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
        const existing = await dbServer
            .select({ id: sissHandoffEvents.id })
            .from(sissHandoffEvents)
            .where(eq(sissHandoffEvents.id, id))
            .get();
        if (!existing) return NextResponse.json({ error: 'SISS handoff not found' }, { status: 404 });

        const rawBody = await request.json() as Record<string, unknown>;
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

        await dbServer.update(sissHandoffEvents).set(updateData).where(eq(sissHandoffEvents.id, id));

        await safeWriteAuditEventFromRequest(request, session, {
            eventType: 'siss.handoff.updated',
            subjectType: 'siss_handoff',
            subjectRef: id,
            redactedMetadata: {
                changedFields: listChangedFields(body as Record<string, unknown>, []),
            },
        }, '[MediFlow] SISS handoff audit write failed:');

        return NextResponse.json({ success: true });
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
        const existing = await dbServer
            .select({ id: sissHandoffEvents.id })
            .from(sissHandoffEvents)
            .where(eq(sissHandoffEvents.id, id))
            .get();
        if (!existing) return NextResponse.json({ error: 'SISS handoff not found' }, { status: 404 });

        await dbServer.delete(sissHandoffEvents).where(eq(sissHandoffEvents.id, id));
        await safeWriteAuditEventFromRequest(request, session, {
            eventType: 'siss.handoff.deleted',
            subjectType: 'siss_handoff',
            subjectRef: id,
        }, '[MediFlow] SISS handoff audit write failed:');

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /siss-handoffs/[id] error:', error);
        return NextResponse.json({ error: 'Failed to delete SISS handoff' }, { status: 500 });
    }
}
