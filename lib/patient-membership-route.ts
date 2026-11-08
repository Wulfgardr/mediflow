import { archiveReplacementResponse } from '@/lib/api-error-response';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { dbServer } from '@/lib/db-server';
import { ambulatories, patients, patientsToAmbulatories } from '@/lib/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { patientAssignSchema, patientUnassignSchema } from '@/lib/api-schemas/patient-bulk';
import { parseApiBody } from '@/lib/api-schemas/parse';
import { readBoundedJsonBody } from '@/lib/bounded-request-body';
import { auditContextFromSession, requestIdFromRequest, withAuditContextMetadata, writeAuditEventInTransaction } from '@/lib/security/audit';
// WUL-306 (ADR 0066): bulk reads treat soft-deleted patients as missing
import { activePatients } from '@/lib/patient-lifecycle';
import { buildPatientVersionConflictPayload } from '@/lib/patient-concurrency';

const MEMBERSHIP_JSON_MAX_BYTES = 262_144;

type MembershipOperation = 'assign' | 'unassign';

function parseMembershipBody(operation: MembershipOperation, value: unknown) {
    if (operation === 'assign') {
        const parsed = parseApiBody(patientAssignSchema, value);
        return parsed.ok ? { ok: true as const, ...parsed.data, ambulatoryId: parsed.data.targetAmbulatoryId } : parsed;
    }
    const parsed = parseApiBody(patientUnassignSchema, value);
    return parsed.ok ? { ok: true as const, ...parsed.data } : parsed;
}

/* Assign and unassign share one transaction: same fences, versions and audit, opposite membership write. */
export async function changePatientMemberships(request: Request, operation: MembershipOperation) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    try {
        const body = await readBoundedJsonBody(request, MEMBERSHIP_JSON_MAX_BYTES, 'request-json',
            { signal: request.signal, deadline: Infinity });
        if (!body.ok) return NextResponse.json({ error: body.status === 413 ? 'JSON payload too large' : 'Invalid JSON body' }, { status: body.status });
        const parsedBody = parseMembershipBody(operation, body.value);
        if (!parsedBody.ok) return parsedBody.response;
        const { patientIds, patientVersions, ambulatoryId } = parsedBody;

        const auditContext = auditContextFromSession(session);
        const requestId = requestIdFromRequest(request);
        const result = dbServer.transaction((tx): { status: 200 | 404 | 409; value: Record<string, unknown> } => {
            const target = tx.select({ id: ambulatories.id }).from(ambulatories)
                .where(eq(ambulatories.id, ambulatoryId)).get();
            if (!target) return { status: 404, value: { error: operation === 'assign' ? 'Target ambulatory not found' : 'Ambulatory not found' } };

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
                    eq(patientsToAmbulatories.ambulatoryId, ambulatoryId),
                    inArray(patientsToAmbulatories.patientId, patientIds),
                )).all();
            const linked = new Set(memberships.map((item) => item.patientId));
            for (const patientId of patientIds) {
                // A current no-op preserves the response without a version bump or event.
                if (linked.has(patientId) === (operation === 'assign')) continue;
                const result = operation === 'assign'
                    ? tx.insert(patientsToAmbulatories).values({ patientId, ambulatoryId }).run()
                    : tx.delete(patientsToAmbulatories).where(and(
                        eq(patientsToAmbulatories.patientId, patientId),
                        eq(patientsToAmbulatories.ambulatoryId, ambulatoryId),
                    )).run();
                if (result.changes !== 1) throw new Error('Membership mutation did not affect exactly one row');
                const expectedVersion = patientVersions[patientId];
                const nextVersion = expectedVersion + 1;
                const updated = tx.update(patients).set({ version: nextVersion, updatedAt: new Date() })
                    .where(and(eq(patients.id, patientId), eq(patients.version, expectedVersion), activePatients())).run();
                if (updated.changes !== 1) throw new Error('Membership patient version did not update exactly one row');
                writeAuditEventInTransaction(tx, {
                    eventType: 'patient.updated', outcome: 'success',
                    archiveGeneration: auditContext.archiveGeneration, actorType: auditContext.actorType, actorRef: auditContext.actorRef,
                    subjectType: 'patient', subjectRef: patientId,
                    sourceSurface: auditContext.sourceSurface, requestId,
                    redactedMetadata: withAuditContextMetadata(auditContext, {
                        changedFields: ['ambulatoryMemberships'], resourceVersion: nextVersion,
                        flags: [operation === 'assign' ? 'membership:assigned' : 'membership:unassigned'],
                    }),
                });
            }
            return { status: 200, value: operation === 'assign'
                ? { success: true, count: patientIds.length }
                : { success: true, count: patientIds.length, ambulatoryId } };
        }, { behavior: 'immediate' });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        console.error(operation === 'assign' ? 'Assign patients error:' : 'Unassign patients error:', error);
        return NextResponse.json({ error: operation === 'assign' ? 'Failed to assign patients' : 'Failed to unlink patients' }, { status: 500 });
    }
}
