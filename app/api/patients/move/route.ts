import { canIncrementVersion } from '@/lib/version-concurrency';
import { dbServer } from '@/lib/db-server';
import { ambulatories, patients, patientsToAmbulatories } from '@/lib/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { patientMoveSchema } from '@/lib/api-schemas/patient-bulk';
/* @Codex */
import { parseApiBody } from '@/lib/api-schemas/parse';
import { readBoundedJsonBody } from '@/lib/bounded-request-body';
import { auditContextFromSession, requestIdFromRequest, withAuditContextMetadata, writeAuditEventInTransaction } from '@/lib/security/audit';
/* @Codex */
import { buildPatientVersionConflictPayload } from '@/lib/patient-concurrency';
// WUL-306 (ADR 0066): bulk reads treat soft-deleted patients as missing
import { activePatients } from '@/lib/patient-lifecycle';

const MOVE_JSON_MAX_BYTES = 262_144;

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await readBoundedJsonBody(request, MOVE_JSON_MAX_BYTES, 'request-json',
            { signal: request.signal, deadline: Infinity });
        if (!body.ok) return NextResponse.json({ error: body.status === 413 ? 'JSON payload too large' : 'Invalid JSON body' }, { status: body.status });
        const parsedBody = parseApiBody(patientMoveSchema, body.value);
        if (!parsedBody.ok) return parsedBody.response;
        const { patientIds, patientVersions, targetAmbulatoryId, sourceAmbulatoryId } = parsedBody.data;

        const auditContext = auditContextFromSession(session);
        const requestId = requestIdFromRequest(request);

        // WUL-268 (STREAM A): membership delete + insert + primary-ownership update
        // must land atomically. better-sqlite3 transactions are synchronous, so no
        // awaits inside the callback (see app/api/system/backup-restore).
        /* @Codex */
        const result = dbServer.transaction((tx): { status: 200 | 404 | 409; value: Record<string, unknown> } => {
            const target = tx
                .select({ id: ambulatories.id })
                .from(ambulatories)
                .where(eq(ambulatories.id, targetAmbulatoryId))
                .get();
            if (!target) {
                return { status: 404, value: { error: 'Target ambulatory not found' } };
            }

            const existingPatients = tx
                .select({
                    id: patients.id,
                    version: patients.version,
                    updatedAt: patients.updatedAt,
                    isArchived: patients.isArchived,
                })
                .from(patients)
                .where(and(inArray(patients.id, patientIds), activePatients()))
                .all();
            const existingIds = new Set(existingPatients.map((patient) => patient.id));
            const missingPatientIds = patientIds.filter((id) => !existingIds.has(id));
            if (missingPatientIds.length > 0) {
                return { status: 404, value: { error: 'Some patients were not found', missingPatientIds } };
            }

            for (const patient of existingPatients) {
                const expectedVersion = patientVersions[patient.id];
                if (patient.version !== expectedVersion) {
                    return {
                        status: 409,
                        value: buildPatientVersionConflictPayload(expectedVersion, patient.id, patient),
                    };
                }
            }

            // Complete batch preflight before deleting or inserting any membership.
            for (const patient of existingPatients) {
                if (!canIncrementVersion(patient.version)) return { status: 409,
                    value: buildPatientVersionConflictPayload(patientVersions[patient.id], patient.id, patient) };
            }

            /* @Codex */
            if (sourceAmbulatoryId) {
                tx.delete(patientsToAmbulatories)
                    .where(and(
                        eq(patientsToAmbulatories.ambulatoryId, sourceAmbulatoryId),
                        inArray(patientsToAmbulatories.patientId, patientIds)
                    ))
                    .run();
            }

            /* @Codex */
            tx.insert(patientsToAmbulatories)
                .values(patientIds.map((patientId: string) => ({
                    patientId,
                    ambulatoryId: targetAmbulatoryId
                })))
                .onConflictDoNothing()
                .run();

            const updatedVersions: Record<string, number> = {};
            const updatedAt = new Date();
            for (const patient of existingPatients) {
                const nextVersion = patient.version + 1;
                const updateResult = tx.update(patients)
                    .set({ ambulatoryId: targetAmbulatoryId, version: nextVersion, updatedAt })
                    .where(and(eq(patients.id, patient.id), eq(patients.version, patient.version), activePatients()))
                    .run();
                if (updateResult.changes !== 1) {
                    throw new Error('Patient version changed during move');
                }
                writeAuditEventInTransaction(tx, {
                    eventType: 'patient.updated', outcome: 'success',
                    actorType: auditContext.actorType, actorRef: auditContext.actorRef,
                    subjectType: 'patient', subjectRef: patient.id,
                    sourceSurface: auditContext.sourceSurface, requestId,
                    redactedMetadata: withAuditContextMetadata(auditContext, {
                        changedFields: ['ambulatoryId', 'ambulatoryMemberships'],
                        resourceVersion: nextVersion, flags: ['membership:moved'],
                    }),
                });
                updatedVersions[patient.id] = nextVersion;
            }

            return {
                status: 200,
                value: {
                    success: true,
                    count: patientIds.length,
                    targetAmbulatoryId,
                    sourceAmbulatoryId: sourceAmbulatoryId ?? null,
                    patientVersions: updatedVersions,
                },
            };
        }, { behavior: 'immediate' });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error("Move patients error:", error);
        return NextResponse.json({ error: "Failed to move patients" }, { status: 500 });
    }
}
