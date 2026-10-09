import { dbServer } from '@/lib/db-server';
import { patients, patientsToAmbulatories } from '@/lib/schema';
import { and, eq, isNotNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';

import { auditContextFromSession, requestIdFromRequest, withAuditContextMetadata, writeAuditEventInTransaction } from '@/lib/security/audit';

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();

    try {
        const auditContext = auditContextFromSession(session);
        const requestId = requestIdFromRequest(request);
        const result = dbServer.transaction((tx) => {
            const existingPatients = tx.select().from(patients).where(isNotNull(patients.ambulatoryId)).all();
            let count = 0;
            for (const patient of existingPatients) {
                if (!patient.ambulatoryId) continue;
                const existingLink = tx.select().from(patientsToAmbulatories)
                    .where(eq(patientsToAmbulatories.patientId, patient.id)).limit(1).get();
                if (existingLink) continue;
                const inserted = tx.insert(patientsToAmbulatories).values({
                    patientId: patient.id, ambulatoryId: patient.ambulatoryId,
                }).run();
                if (inserted.changes !== 1) throw new Error('Migration membership did not insert exactly one row');
                const nextVersion = patient.version + 1;
                const updated = tx.update(patients).set({ version: nextVersion, updatedAt: new Date() })
                    .where(and(eq(patients.id, patient.id), eq(patients.version, patient.version))).run();
                if (updated.changes !== 1) throw new Error('Migration patient version did not update exactly one row');
                writeAuditEventInTransaction(tx, {
                    eventType: 'patient.updated', outcome: 'success',
                    actorType: auditContext.actorType, actorRef: auditContext.actorRef,
                    subjectType: 'patient', subjectRef: patient.id,
                    sourceSurface: auditContext.sourceSurface, requestId,
                    redactedMetadata: withAuditContextMetadata(auditContext, {
                        changedFields: ['ambulatoryMemberships'], resourceVersion: nextVersion,
                        flags: ['membership:migrated'],
                    }),
                });
                count += 1;
            }
            return { success: true, migrated: count, total: existingPatients.length };
        }, { behavior: 'immediate' });
        return NextResponse.json(result);
    } catch (error) {
        console.error("Migration fatal error:", error);
        return NextResponse.json({ error: "Migration failed" }, { status: 500 });
    }
}
