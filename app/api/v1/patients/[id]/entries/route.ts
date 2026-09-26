// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { entries } from '@/lib/schema';
import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/security/server-auth';
import type { EntrySummary } from '@/lib/api/v1/types';
/* @Codex */
import { prepareEntryCreate, readEntryJsonObject } from '@/lib/entry-write-input';
import { createEntryOperation } from '@/lib/entry-write-operation';
/* @Codex */
import { auditContextFromSession, requestIdFromRequest } from '@/lib/security/audit';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseLimit(value: string | null): number | null {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return null;
    return Math.min(parsed, 100);
}

/* @Codex */
function parseIncludeDeleted(value: string | null): boolean {
    return value === 'true' || value === '1';
}

/* @Codex */
function parseDateParam(value: string | null): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id } = await params;
        const { searchParams } = new URL(request.url);
        const limit = parseLimit(searchParams.get('limit'));
        const type = searchParams.get('type')?.trim();
        const dateFrom = parseDateParam(searchParams.get('dateFrom'));
        const dateTo = parseDateParam(searchParams.get('dateTo'));
        const includeDeleted = parseIncludeDeleted(searchParams.get('includeDeleted'));

        const filters = [eq(entries.patientId, id)];
        if (!includeDeleted) filters.push(isNull(entries.deletedAt));
        if (type) filters.push(eq(entries.type, type));
        if (dateFrom) filters.push(gte(entries.date, dateFrom));
        if (dateTo) filters.push(lte(entries.date, dateTo));
        const whereClause = filters.length > 1 ? and(...filters) : filters[0];

        const rows = limit
            ? await dbServer.select().from(entries).where(whereClause).orderBy(desc(entries.date)).limit(limit)
            : await dbServer.select().from(entries).where(whereClause).orderBy(desc(entries.date));

        const result: EntrySummary[] = rows.map((entry) => ({
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
        }));

        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/patients/[id]/entries error:', error);
        return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 });
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        /* @Codex */
        const auditSession = await requireLocalApiActorSession(request);
        const { id } = await params;
        const parsed = await readEntryJsonObject(request);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
        const prepared = prepareEntryCreate(parsed.body, 'v1', id);
        if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: prepared.status });
        const context = auditContextFromSession(auditSession);
        const result = createEntryOperation({ patientId: id, id: prepared.id, values: prepared.values,
            changedFields: prepared.changedFields, mode: 'v1', audit: {
                actorType: context.actorType, actorRef: context.actorRef, sourceSurface: context.sourceSurface,
                requestId: requestIdFromRequest(request), flags: [`auth:${context.authContext}`],
            } });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /api/v1/patients/[id]/entries error:', error);
        return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 });
    }
}
