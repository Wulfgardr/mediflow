// Codex: created 2026-02-06
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { entries } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/security/server-auth';
import type { EntrySummary } from '@/lib/api/v1/types';
/* @Codex */
import { parseEntryDeleteInput, prepareEntryUpdate, readEntryJsonObject } from '@/lib/entry-write-input';
import { updateEntryOperation } from '@/lib/entry-write-operation';
/* @Codex */
import { auditContextFromSession, requestIdFromRequest } from '@/lib/security/audit';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
        const parsed = await readEntryJsonObject(request);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
        const prepared = prepareEntryUpdate(parsed.body, 'v1');
        if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: prepared.status });
        const context = auditContextFromSession(auditSession);
        const result = updateEntryOperation({ patientId: id, entryId, expectedVersion: prepared.expectedVersion,
            values: prepared.values, changedFields: prepared.changedFields, mode: 'v1', audit: {
                actorType: context.actorType, actorRef: context.actorRef, sourceSurface: context.sourceSurface,
                requestId: requestIdFromRequest(request), flags: [`auth:${context.authContext}`],
            } });
        return NextResponse.json(result.value, { status: result.status });
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
        const parsedBody = await parseEntryDeleteInput(request, 'api-v1-delete');
        if (!parsedBody.ok) {
            return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
        }
        const prepared = prepareEntryUpdate(parsedBody.body, 'v1', true);
        if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: prepared.status });
        const context = auditContextFromSession(auditSession);
        const result = updateEntryOperation({ patientId: id, entryId, expectedVersion: prepared.expectedVersion,
            values: prepared.values, changedFields: prepared.changedFields, mode: 'v1', audit: {
                actorType: context.actorType, actorRef: context.actorRef, sourceSurface: context.sourceSurface,
                requestId: requestIdFromRequest(request), flags: [`auth:${context.authContext}`],
            } });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API DELETE /api/v1/patients/[id]/entries/[entryId] error:', error);
        return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
    }
}
