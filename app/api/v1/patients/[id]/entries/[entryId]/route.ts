// Codex: created 2026-02-06
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { entries } from '@/lib/schema';
import { and, eq, sql } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/server-auth';
import type { EntrySummary } from '@/lib/api/v1/types';
/* @Codex */
import { normalizeEntryUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* @Codex */
type OptionalJsonBodyResult =
    | { ok: true; body: Record<string, unknown> }
    | { ok: false; error: string };

/* @Codex */
async function parseOptionalJsonBody(request: Request): Promise<OptionalJsonBodyResult> {
    const text = await request.text();
    if (text.trim().length === 0) {
        return { ok: true, body: {} };
    }

    try {
        const body = JSON.parse(text);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return { ok: false, error: 'Invalid JSON body' };
        }
        return { ok: true, body: body as Record<string, unknown> };
    } catch {
        return { ok: false, error: 'Invalid JSON body' };
    }
}

/* @Codex */
function hasOwn(input: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(input, key);
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string; entryId: string }> }
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id, entryId } = await params;
        const entry = await dbServer.select().from(entries)
            .where(and(eq(entries.id, entryId), eq(entries.patientId, id)))
            .get();

        if (!entry) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const result: EntrySummary = {
            id: entry.id,
            patientId: entry.patientId,
            type: entry.type,
            title: entry.title,
            date: toIsoString(entry.date) ?? new Date(0).toISOString(),
            content: entry.content,
            setting: entry.setting ?? null,
            metadata: entry.metadata ?? null,
            attachments: entry.attachments ?? null,
            deletedAt: toIsoString(entry.deletedAt),
            deletionReason: entry.deletionReason ?? null,
            version: entry.version,
            createdAt: toIsoString(entry.createdAt),
            updatedAt: toIsoString(entry.updatedAt),
        };

        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/patients/[id]/entries/[entryId] error:', error);
        return NextResponse.json({ error: 'Failed to fetch entry' }, { status: 500 });
    }
}

/* @Codex */
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string; entryId: string }> }
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        /* @Codex */
        const auditSession = await requireLocalApiActorSession(request);
        const { id, entryId } = await params;
        const body = await request.json() as Record<string, unknown>;
        const normalized = normalizeEntryUpdateInput(body);
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        const existing = await dbServer.select({ id: entries.id }).from(entries)
            .where(and(eq(entries.id, entryId), eq(entries.patientId, id)))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const updateResult = await dbServer.update(entries)
            .set({
                ...normalized.values,
                version: sql`${entries.version} + 1`,
            })
            .where(and(eq(entries.id, entryId), eq(entries.patientId, id)))
            .run();

        if (updateResult.changes === 0) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const current = await dbServer
            .select({ version: entries.version })
            .from(entries)
            .where(and(eq(entries.id, entryId), eq(entries.patientId, id)))
            .get();

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            auditSession,
            {
                eventType: normalized.values.deletedAt ? 'entry.deleted' : 'entry.updated',
                subjectType: 'entry',
                subjectRef: entryId,
                redactedMetadata: {
                    changedFields: listChangedFields(body),
                    resourceVersion: current?.version ?? undefined,
                },
            },
            '[MediFlow] Entry audit write failed:',
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API PUT /api/v1/patients/[id]/entries/[entryId] error:', error);
        return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 });
    }
}

/* @Codex */
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; entryId: string }> }
) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        /* @Codex */
        const auditSession = await requireLocalApiActorSession(request);
        const { id, entryId } = await params;
        const parsedBody = await parseOptionalJsonBody(request);
        if (!parsedBody.ok) {
            return NextResponse.json({ error: parsedBody.error }, { status: 400 });
        }
        const body = parsedBody.body;
        if (hasOwn(body, 'deletedAt') && (body.deletedAt === null || body.deletedAt === '')) {
            return NextResponse.json({ error: 'Invalid deletedAt' }, { status: 400 });
        }
        if (hasOwn(body, 'deletionReason')) {
            if (typeof body.deletionReason !== 'string' || body.deletionReason.trim().length === 0) {
                return NextResponse.json({ error: 'Invalid deletionReason' }, { status: 400 });
            }
            body.deletionReason = body.deletionReason.trim();
        }
        const normalized = normalizeEntryUpdateInput({
            deletedAt: hasOwn(body, 'deletedAt') ? body.deletedAt : new Date(),
            deletionReason: hasOwn(body, 'deletionReason') ? body.deletionReason : 'api-v1-delete',
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        const existing = await dbServer.select({ id: entries.id, version: entries.version }).from(entries)
            .where(and(eq(entries.id, entryId), eq(entries.patientId, id)))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const updateResult = await dbServer.update(entries)
            .set({
                ...normalized.values,
                version: sql`${entries.version} + 1`,
            })
            .where(and(eq(entries.id, entryId), eq(entries.patientId, id)))
            .run();

        if (updateResult.changes === 0) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            auditSession,
            {
                eventType: 'entry.deleted',
                subjectType: 'entry',
                subjectRef: entryId,
                redactedMetadata: {
                    changedFields: ['deletedAt', 'deletionReason'],
                    resourceVersion: existing.version + 1,
                },
            },
            '[MediFlow] Entry audit write failed:',
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /api/v1/patients/[id]/entries/[entryId] error:', error);
        return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
    }
}
