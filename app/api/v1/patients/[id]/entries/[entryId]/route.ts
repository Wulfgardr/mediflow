// Codex: created 2026-02-06
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { entries } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/server-auth';
import type { EntrySummary } from '@/lib/api/v1/types';
/* @Codex */
import { normalizeEntryUpdateInput } from '@/lib/api-v1-clinical-write-normalization';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/audit';
import { buildEntryVersionConflictPayload, parseEntryExpectedVersion } from '@/lib/entry-concurrency';
import { parseClinicalDeleteBody } from '@/lib/api-v1-clinical-lifecycle';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// WUL-308: PHI-safe snapshot for the 409 version-conflict payload.
async function selectEntryConflictSnapshot(patientId: string, entryId: string) {
    return await dbServer
        .select({
            id: entries.id,
            patientId: entries.patientId,
            version: entries.version,
            updatedAt: entries.updatedAt,
            deletedAt: entries.deletedAt,
        })
        .from(entries)
        .where(and(eq(entries.id, entryId), eq(entries.patientId, patientId)))
        .get() ?? null;
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
        // WUL-308: child PUTs require optimistic concurrency like the patient PUT.
        const expectedVersion = parseEntryExpectedVersion(body.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }

        const existing = await dbServer.select({ id: entries.id }).from(entries)
            .where(and(eq(entries.id, entryId), eq(entries.patientId, id)))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const normalized = normalizeEntryUpdateInput(body);
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        const updateResult = await dbServer.update(entries)
            .set({
                ...normalized.values,
                version: expectedVersion + 1,
            })
            .where(and(
                eq(entries.id, entryId),
                eq(entries.patientId, id),
                eq(entries.version, expectedVersion),
            ))
            .run();

        if (updateResult.changes === 0) {
            return NextResponse.json(
                buildEntryVersionConflictPayload(
                    expectedVersion,
                    entryId,
                    await selectEntryConflictSnapshot(id, entryId),
                ),
                { status: 409 }
            );
        }

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            auditSession,
            {
                eventType: normalized.values.deletedAt ? 'entry.deleted' : 'entry.updated',
                subjectType: 'entry',
                subjectRef: entryId,
                redactedMetadata: {
                    changedFields: listChangedFields(body, ['version']),
                    resourceVersion: expectedVersion + 1,
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
        // WUL-308: DELETE keeps the soft-delete tombstone and gains the version guard.
        const parsedBody = await parseClinicalDeleteBody(request);
        if (!parsedBody.ok) {
            return NextResponse.json({ error: parsedBody.error }, { status: 400 });
        }
        const expectedVersion = parseEntryExpectedVersion(parsedBody.values.version);
        if (expectedVersion === null) {
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }
        const normalized = normalizeEntryUpdateInput({
            deletedAt: parsedBody.values.deletedAt,
            deletionReason: parsedBody.values.deletionReason,
        });
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
                version: expectedVersion + 1,
            })
            .where(and(
                eq(entries.id, entryId),
                eq(entries.patientId, id),
                eq(entries.version, expectedVersion),
            ))
            .run();

        if (updateResult.changes === 0) {
            return NextResponse.json(
                buildEntryVersionConflictPayload(
                    expectedVersion,
                    entryId,
                    await selectEntryConflictSnapshot(id, entryId),
                ),
                { status: 409 }
            );
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
                    resourceVersion: expectedVersion + 1,
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
