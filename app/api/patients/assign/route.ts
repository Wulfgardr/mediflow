import { dbServer } from '@/lib/db-server';
import { ambulatories, patients, patientsToAmbulatories } from '@/lib/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { patientAssignSchema } from '@/lib/api-schemas/patient-bulk';
/* @Codex */
import { parseApiBody } from '@/lib/api-schemas/parse';
import { readBoundedJsonBody } from '@/lib/bounded-request-body';
import { auditContextFromSession, requestIdFromRequest, withAuditContextMetadata, writeAuditEventInTransaction } from '@/lib/security/audit';
// WUL-306 (ADR 0066): bulk reads treat soft-deleted patients as missing
import { activePatients } from '@/lib/patient-lifecycle';
import { buildPatientVersionConflictPayload } from '@/lib/patient-concurrency';

const MEMBERSHIP_JSON_MAX_BYTES = 262_144;

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await readBoundedJsonBody(request, MEMBERSHIP_JSON_MAX_BYTES, 'request-json',
            { signal: request.signal, deadline: Infinity });
        if (!body.ok) return NextResponse.json({ error: body.status === 413 ? 'JSON payload too large' : 'Invalid JSON body' }, { status: body.status });
        const parsedBody = parseApiBody(patientAssignSchema, body.value);
        if (!parsedBody.ok) return parsedBody.response;
        const { patientIds, patientVersions, targetAmbulatoryId } = parsedBody.data;

        const auditContext = auditContextFromSession(session);
        const requestId = requestIdFromRequest(request);
        const result = dbServer.transaction((tx): { status: 200 | 404 | 409; value: Record<string, unknown> } => {
            const target = tx.select({ id: ambulatories.id }).from(ambulatories)
                .where(eq(ambulatories.id, targetAmbulatoryId)).get();
            if (!target) return { status: 404, value: { error: 'Target ambulatory not found' } };

            const existingPatients = tx.select({ id: patients.id, version: patients.version, updatedAt: patients.updatedAt, isArchived: patients.isArchived }).from(patients)
                .where(and(inArray(patients.id, patientIds), activePatients())).all();
            const existingIds = new Set(existingPatients.map((item) => item.id));
            const missingPatientIds = patientIds.filter((id) => !existingIds.has(id));
            if (missingPatientIds.length > 0) return { status: 404, value: { error: 'Some patients were not found', missingPatientIds } };

            for (const patient of existingPatients) {
                const expectedVersion = patientVersions[patient.id];
                if (patient.version !== expectedVersion) return {
                    status: 409, value: buildPatientVersionConflictPayload(expectedVersion, patient.id, patient),
                };
            }

            const memberships = tx.select({ patientId: patientsToAmbulatories.patientId })
                .from(patientsToAmbulatories).where(and(
                    eq(patientsToAmbulatories.ambulatoryId, targetAmbulatoryId),
                    inArray(patientsToAmbulatories.patientId, patientIds),
                )).all();
            const linked = new Set(memberships.map((item) => item.patientId));
            for (const patientId of patientIds) {
                // A current no-op preserves the response without a version bump or event.
                if (linked.has(patientId)) continue;
                const result = tx.insert(patientsToAmbulatories).values({ patientId, ambulatoryId: targetAmbulatoryId }).run();
                if (result.changes !== 1) throw new Error('Membership mutation did not affect exactly one row');
                const expectedVersion = patientVersions[patientId];
                const nextVersion = expectedVersion + 1;
                const updated = tx.update(patients).set({ version: nextVersion, updatedAt: new Date() })
                    .where(and(eq(patients.id, patientId), eq(patients.version, expectedVersion), activePatients())).run();
                if (updated.changes !== 1) throw new Error('Membership patient version did not update exactly one row');
                writeAuditEventInTransaction(tx, {
                    eventType: 'patient.updated', outcome: 'success',
                    actorType: auditContext.actorType, actorRef: auditContext.actorRef,
                    subjectType: 'patient', subjectRef: patientId,
                    sourceSurface: auditContext.sourceSurface, requestId,
                    redactedMetadata: withAuditContextMetadata(auditContext, {
                        changedFields: ['ambulatoryMemberships'], resourceVersion: nextVersion, flags: ['membership:assigned'],
                    }),
                });
            }
            return { status: 200, value: { success: true, count: patientIds.length } };
        }, { behavior: 'immediate' });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error("Assign patients error:", error);
        return NextResponse.json({ error: "Failed to assign patients" }, { status: 500 });
    }
}
