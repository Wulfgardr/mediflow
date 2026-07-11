// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { checkups, patients } from '@/lib/schema';
import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { requireLocalApiActorSession } from '@/lib/security/server-auth';
import type { CheckupSummary } from '@/lib/api/v1/types';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { normalizeCheckupCreateInput } from '@/lib/api-v1-clinical-write-normalization';
/* @Codex */
import {
    checkupStatusFilterValues,
    normalizeCheckupStatus,
} from '@/lib/status-normalization';
/* @Codex */
import { listChangedFields, safeWriteAuditEventFromRequest } from '@/lib/security/audit';
import { activePatients } from '@/lib/patient-lifecycle';

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
function parseDateParam(value: string | null): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// WUL-308: lists hide soft-deleted rows by default, like entries.
function parseIncludeDeleted(value: string | null): boolean {
    return value === 'true' || value === '1';
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id } = await params;
        const { searchParams } = new URL(request.url);
        const limit = parseLimit(searchParams.get('limit'));
        const status = searchParams.get('status')?.trim();
        /* @Codex */
        const statusFilterValues = status ? checkupStatusFilterValues(status) : null;
        const dateFrom = parseDateParam(searchParams.get('dateFrom'));
        const dateTo = parseDateParam(searchParams.get('dateTo'));
        const includeDeleted = parseIncludeDeleted(searchParams.get('includeDeleted'));

        const filters = [eq(checkups.patientId, id)];
        if (!includeDeleted) filters.push(isNull(checkups.deletedAt));
        /* @Codex */
        if (statusFilterValues) filters.push(inArray(checkups.status, statusFilterValues));
        if (dateFrom) filters.push(gte(checkups.date, dateFrom));
        if (dateTo) filters.push(lte(checkups.date, dateTo));
        const whereClause = filters.length > 1 ? and(...filters) : filters[0];

        const rows = limit
            ? await dbServer.select().from(checkups).where(whereClause).orderBy(desc(checkups.date)).limit(limit)
            : await dbServer.select().from(checkups).where(whereClause).orderBy(desc(checkups.date));

        const result: CheckupSummary[] = rows.map((checkup) => ({
            id: checkup.id,
            patientId: checkup.patientId,
            date: toIsoString(checkup.date) ?? new Date(0).toISOString(),
            title: checkup.title,
            notes: checkup.notes ?? null,
            status: normalizeCheckupStatus(checkup.status),
            source: checkup.source ?? null,
            version: checkup.version,
            createdAt: toIsoString(checkup.createdAt),
            updatedAt: toIsoString(checkup.updatedAt),
            deletedAt: toIsoString(checkup.deletedAt),
            deletionReason: checkup.deletionReason ?? null,
        }));

        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/patients/[id]/checkups error:', error);
        return NextResponse.json({ error: 'Failed to fetch checkups' }, { status: 500 });
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        /* @Codex */
        const auditSession = await requireLocalApiActorSession(request);
        const { id } = await params;
        const body = await request.json() as Record<string, unknown>;
        /* @Codex */
        const auditBody = body;
        const newId = typeof body.id === 'string' && body.id.trim().length > 0 ? body.id : uuidv4();
        const normalized = normalizeCheckupCreateInput(body, {
            id: newId,
            patientId: id,
        });
        if (!normalized.ok) {
            return NextResponse.json({ error: normalized.error }, { status: 400 });
        }

        const created = dbServer.transaction((tx) => {
            const patient = tx.select({ id: patients.id })
                .from(patients)
                .where(and(eq(patients.id, id), activePatients()))
                .get();
            if (!patient) return false;
            tx.insert(checkups).values(normalized.values).run();
            return true;
        });
        if (!created) {
            return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
        }

        /* @Codex */
        await safeWriteAuditEventFromRequest(
            request,
            auditSession,
            {
                eventType: 'checkup.created',
                subjectType: 'checkup',
                subjectRef: normalized.values.id,
                redactedMetadata: {
                    changedFields: listChangedFields(auditBody, ['id']),
                    resourceVersion: 1,
                },
            },
            '[MediFlow] Checkup audit write failed:',
        );

        return NextResponse.json({ id: normalized.values.id, version: 1 }, { status: 201 });
    } catch (error) {
        console.error('API POST /api/v1/patients/[id]/checkups error:', error);
        return NextResponse.json({ error: 'Failed to create checkup' }, { status: 500 });
    }
}
