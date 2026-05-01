/* @Codex */
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { dbServer } from '@/lib/db-server';
import { sissHandoffEvents } from '@/lib/schema';
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';

const OUTCOMES = new Set(['started', 'completed', 'blocked', 'cancelled']);
const ACTION_LABELS: Record<string, string> = {
    'menu.open': 'Menu SISS',
    'prescription.create': 'Modulo prescrittivo',
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
        const body = await request.json() as Record<string, unknown>;
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

        await dbServer.insert(sissHandoffEvents).values({
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
        });

        await safeWriteAuditEventFromRequest(request, session, {
            eventType: 'siss.handoff.created',
            subjectType: 'siss_handoff',
            subjectRef: id,
            redactedMetadata: {
                changedFields: listChangedFields(body, ['id']),
                flags: [`action:${action}`, `outcome:${outcome}`],
            },
        }, '[MediFlow] SISS handoff audit write failed:');

        return NextResponse.json({ id }, { status: 201 });
    } catch (error) {
        console.error('API POST /siss-handoffs error:', error);
        return NextResponse.json({ error: 'Failed to create SISS handoff' }, { status: 500 });
    }
}
