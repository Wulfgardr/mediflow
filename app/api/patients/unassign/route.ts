import { dbServer } from '@/lib/db-server';
import { ambulatories, patients, patientsToAmbulatories } from '@/lib/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { patientUnassignSchema } from '@/lib/api-schemas/patient-bulk';
/* @Codex */
import { parseApiBody } from '@/lib/api-schemas/parse';
import { readBoundedJsonBody } from '@/lib/bounded-request-body';
import { auditContextFromSession, requestIdFromRequest, withAuditContextMetadata, writeAuditEventInTransaction } from '@/lib/security/audit';
// WUL-306 (ADR 0066): bulk reads treat soft-deleted patients as missing
import { activePatients } from '@/lib/patient-lifecycle';

const MEMBERSHIP_JSON_MAX_BYTES = 262_144;

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await readBoundedJsonBody(request, MEMBERSHIP_JSON_MAX_BYTES, 'request-json',
            { signal: request.signal, deadline: Infinity });
        if (!body.ok) return NextResponse.json({ error: body.status === 413 ? 'JSON payload too large' : 'Invalid JSON body' }, { status: body.status });
        const parsedBody = parseApiBody(patientUnassignSchema, body.value);
        if (!parsedBody.ok) return parsedBody.response;
        const { patientIds, ambulatoryId } = parsedBody.data;

        const auditContext = auditContextFromSession(session);
        const requestId = requestIdFromRequest(request);
        const rejection = dbServer.transaction((tx) => {
            const target = tx.select({ id: ambulatories.id }).from(ambulatories)
                .where(eq(ambulatories.id, ambulatoryId)).get();
            if (!target) return { error: 'Ambulatory not found' };

            const existingPatients = tx.select({ id: patients.id }).from(patients)
                .where(and(inArray(patients.id, patientIds), activePatients())).all();
            const existingIds = new Set(existingPatients.map((item) => item.id));
            const missingPatientIds = patientIds.filter((id) => !existingIds.has(id));
            if (missingPatientIds.length > 0) return { error: 'Some patients were not found', missingPatientIds };

            const memberships = tx.select({ patientId: patientsToAmbulatories.patientId })
                .from(patientsToAmbulatories).where(and(
                    eq(patientsToAmbulatories.ambulatoryId, ambulatoryId),
                    inArray(patientsToAmbulatories.patientId, patientIds),
                )).all();
            const linked = new Set(memberships.map((item) => item.patientId));
            for (const patientId of patientIds) {
                // A retry/no-op preserves the response, without claiming a new mutation.
                if (!linked.has(patientId)) continue;
                const result = tx.delete(patientsToAmbulatories).where(and(
                    eq(patientsToAmbulatories.patientId, patientId),
                    eq(patientsToAmbulatories.ambulatoryId, ambulatoryId),
                )).run();
                if (result.changes !== 1) throw new Error('Membership mutation did not affect exactly one row');
                writeAuditEventInTransaction(tx, {
                    eventType: 'patient.updated', outcome: 'success',
                    actorType: auditContext.actorType, actorRef: auditContext.actorRef,
                    subjectType: 'patient', subjectRef: patientId,
                    sourceSurface: auditContext.sourceSurface, requestId,
                    redactedMetadata: withAuditContextMetadata(auditContext, {
                        changedFields: ['ambulatoryMemberships'], flags: ['membership:unassigned'],
                    }),
                });
            }
            return null;
        }, { behavior: 'immediate' });
        if (rejection) return NextResponse.json(rejection, { status: 404 });

        return NextResponse.json({ success: true, count: patientIds.length, ambulatoryId });
    } catch (error) {
        console.error("Unassign patients error:", error);
        return NextResponse.json({ error: "Failed to unlink patients" }, { status: 500 });
    }
}
