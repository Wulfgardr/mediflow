// WUL-306 (ADR 0066): audited admin purge of a soft-deleted patient (GDPR Art. 17 tool).
// Modeled on fix-orphans: GET dry-run with per-table counts, POST execute, admin only.
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { patients, patientRetiredIds } from '@/lib/schema';
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';
/* @Codex */
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
import {
    countPatientCascadeRows,
    purgePatientCascade,
    totalPatientCascadeRows,
    type PatientCascadeCounts,
} from '@/lib/patient-cascade';
import { auditContextFromSession, requestIdFromRequest, withAuditContextMetadata, writeAuditEventInTransaction } from '@/lib/security/audit';
import { readBoundedJsonBody } from '@/lib/bounded-request-body';
import { requireExpectedVersion, buildVersionConflictPayload } from '@/lib/version-concurrency';

const PURGE_JSON_MAX_BYTES = 65_536;

export const dynamic = 'force-dynamic';

function cascadeCountFlags(prefix: string, counts: PatientCascadeCounts): string[] {
    return Object.entries(counts).map(([table, count]) => `${prefix}:${table}:${count}`);
}

export async function GET(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();

    try {
        const { searchParams } = new URL(request.url);
        const patientId = searchParams.get('patientId')?.trim() ?? '';
        if (!patientId) {
            return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
        }

        // Tombstone/version and child counts describe one coherent read snapshot.
        const result = dbServer.transaction((tx) => {
            const patient = tx.select({ id: patients.id, version: patients.version, deletedAt: patients.deletedAt })
                .from(patients).where(eq(patients.id, patientId)).get();
            if (!patient) return { status: 404, value: { error: 'Not found' } };
            const childRowCounts = countPatientCascadeRows(tx, patientId);
            return { status: 200, value: {
                success: true,
                dryRun: true,
                patientId,
                version: patient.version,
                deletedAt: patient.deletedAt?.toISOString() ?? null,
                patientState: patient.deletedAt ? 'soft-deleted' : 'active',
                childRowCounts,
                totalChildRows: totalPatientCascadeRows(childRowCounts),
            } };
        });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('[MediFlow] Purge patient dry-run failed:', error);
        return NextResponse.json({ error: 'Purge dry-run failed' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();

    try {
        const parsed = await readBoundedJsonBody(request, PURGE_JSON_MAX_BYTES, 'request-json',
            { signal: request.signal, deadline: Infinity }).catch(() => ({ ok: false as const, status: 400 as const }));
        if (!parsed.ok) return NextResponse.json({ error: parsed.status === 413 ? 'JSON payload too large' : 'Invalid JSON body' }, { status: parsed.status });
        if (typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        const body = parsed.value as Record<string, unknown>;
        const patientId = typeof body.patientId === 'string' ? body.patientId.trim() : '';
        if (!patientId) {
            return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
        }

        const versionResult = requireExpectedVersion(body.version);
        if (!versionResult.ok) return NextResponse.json(versionResult.value, { status: versionResult.status });
        const { expectedVersion } = versionResult;

        const auditContext = auditContextFromSession(session);
        const requestId = requestIdFromRequest(request);
        const result = dbServer.transaction((tx) => {
            const patient = tx.select({ id: patients.id, version: patients.version, deletedAt: patients.deletedAt })
                .from(patients).where(eq(patients.id, patientId)).get();
            if (!patient) return { status: 404, value: { error: 'Not found' } };
            // Erasure only follows an explicit operational soft-delete, reread under the write lock.
            if (!patient.deletedAt) return {
                status: 409, value: { error: 'Patient is still active: soft-delete it before purging' },
            };

            if (patient.version !== expectedVersion) return { status: 409,
                value: buildVersionConflictPayload('patient', expectedVersion, patientId, {
                    ...patient, updatedAt: null,
                }),
            };

            tx.insert(patientRetiredIds).values({ id: patientId }).onConflictDoNothing().run();
            if (!tx.select({ id: patientRetiredIds.id }).from(patientRetiredIds)
                .where(eq(patientRetiredIds.id, patientId)).get()) {
                throw new Error('Patient identity retirement failed');
            }
            const childRowCounts = purgePatientCascade(tx, patientId);
            const deleted = tx.delete(patients).where(and(eq(patients.id, patientId),
                eq(patients.version, patient.version), eq(patients.deletedAt, patient.deletedAt))).run();
            if (deleted.changes !== 1) throw new Error('Patient purge did not delete exactly one row');
            writeAuditEventInTransaction(tx, {
                eventType: 'patient.purged', outcome: 'success',
                actorType: auditContext.actorType, actorRef: auditContext.actorRef,
                subjectType: 'patient', subjectRef: patientId,
                sourceSurface: auditContext.sourceSurface, requestId,
                redactedMetadata: withAuditContextMetadata(auditContext, {
                    counts: totalPatientCascadeRows(childRowCounts),
                    flags: cascadeCountFlags('purged', childRowCounts),
                }),
            });
            return { status: 200, value: {
                success: true, patientId, childRowCounts,
                totalChildRows: totalPatientCascadeRows(childRowCounts),
            } };
        }, { behavior: 'immediate' });

        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('[MediFlow] Purge patient failed:', error);
        return NextResponse.json({ error: 'Purge failed' }, { status: 500 });
    }
}
