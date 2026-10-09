import { dbServer } from '@/lib/db-server';
import { ambulatories, patients, patientsToAmbulatories } from '@/lib/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { patientDuplicateSchema } from '@/lib/api-schemas/patient-bulk';
/* @Codex */
import { parseApiBody } from '@/lib/api-schemas/parse';
import { readBoundedJsonBody } from '@/lib/bounded-request-body';
import { auditContextFromSession, requestIdFromRequest, withAuditContextMetadata, writeAuditEventInTransaction } from '@/lib/security/audit';
// WUL-306 (ADR 0066): bulk reads treat soft-deleted patients as missing
import { activePatients } from '@/lib/patient-lifecycle';

const DUPLICATE_JSON_MAX_BYTES = 262_144;

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await readBoundedJsonBody(request, DUPLICATE_JSON_MAX_BYTES, 'request-json',
            { signal: request.signal, deadline: Infinity });
        if (!body.ok) return NextResponse.json({ error: body.status === 413 ? 'JSON payload too large' : 'Invalid JSON body' }, { status: body.status });
        const parsedBody = parseApiBody(patientDuplicateSchema, body.value);
        if (!parsedBody.ok) return parsedBody.response;
        const { patientIds, targetAmbulatoryId } = parsedBody.data;

        const auditContext = auditContextFromSession(session);
        const requestId = requestIdFromRequest(request);
        // Resolve scope and clone the whole batch on the same authoritative snapshot.
        const result = dbServer.transaction((tx) => {
            const target = tx.select({ id: ambulatories.id }).from(ambulatories)
                .where(eq(ambulatories.id, targetAmbulatoryId)).get();
            if (!target) return { status: 404, value: { error: 'Target ambulatory not found' } };

            const originals = tx.select().from(patients)
                .where(and(inArray(patients.id, patientIds), activePatients())).all();
            const originalIds = new Set(originals.map((item) => item.id));
            const missingPatientIds = patientIds.filter((id) => !originalIds.has(id));
            if (missingPatientIds.length > 0) return {
                status: 404, value: { error: 'Some patients were not found', missingPatientIds },
            };

            let cloned = 0;
            for (const p of originals) {
                const newId = uuidv4();

                // Clone patient data
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { id: _oldId, createdAt: _c, updatedAt: _u, ambulatoryId: _oldAmb, ...data } = p;

                // Insert Clone
                const inserted = tx.insert(patients).values({
                    id: newId,
                    ...data,
                    /* @Codex */
                    firstName: p.firstName,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    ambulatoryId: targetAmbulatoryId // Set primary ownership too for compat
                }).run();

                if (inserted.changes !== 1) throw new Error('Patient clone did not insert exactly one row');

                // Create Link
                const linked = tx.insert(patientsToAmbulatories).values({
                    patientId: newId,
                    ambulatoryId: targetAmbulatoryId
                }).onConflictDoNothing().run();
                if (linked.changes !== 1) throw new Error('Clone membership did not insert exactly one row');
                writeAuditEventInTransaction(tx, {
                    eventType: 'patient.created', outcome: 'success',
                    actorType: auditContext.actorType, actorRef: auditContext.actorRef,
                    subjectType: 'patient', subjectRef: newId,
                    sourceSurface: auditContext.sourceSurface, requestId,
                    redactedMetadata: withAuditContextMetadata(auditContext, {
                        resourceVersion: p.version, flags: ['patient:duplicated'],
                    }),
                });
                cloned++;
            }
            return { status: 200, value: { success: true, count: cloned } };
        }, { behavior: 'immediate' });

        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error("Duplicate patients error:", error);
        return NextResponse.json({ error: "Failed to duplicate patients" }, { status: 500 });
    }
}
