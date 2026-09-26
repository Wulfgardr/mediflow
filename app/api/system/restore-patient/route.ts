// WUL-306 (ADR 0066): explicit admin restore of a soft-deleted patient.
import { NextResponse } from 'next/server';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { patients } from '@/lib/schema';
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';
/* @Codex */
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
import { buildPatientRestoreValues } from '@/lib/patient-lifecycle';
import { auditContextFromSession, requestIdFromRequest, withAuditContextMetadata,
    writeAuditEventInTransaction } from '@/lib/security/audit';
/* @Codex */
import { readBoundedJsonBody } from '@/lib/bounded-request-body';

/* @Codex: this cap applies only to the administrative restore envelope. */
const RESTORE_PATIENT_JSON_MAX_BYTES = 65_536;

export const dynamic = 'force-dynamic';

// Restore deliberately bypasses the activePatients() read filter: it must see tombstones.
export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();

    try {
        const softDeleted = await dbServer
            .select({
                id: patients.id,
                firstName: patients.firstName,
                lastName: patients.lastName,
                deletedAt: patients.deletedAt,
                deletionReason: patients.deletionReason,
                version: patients.version,
            })
            .from(patients)
            .where(isNotNull(patients.deletedAt))
            .orderBy(desc(patients.deletedAt));

        return NextResponse.json({ success: true, softDeleted });
    } catch (error) {
        console.error('[MediFlow] Restore patient list failed:', error);
        return NextResponse.json({ error: 'Failed to list soft-deleted patients' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();

    try {
        const parsed = await readBoundedJsonBody(request, RESTORE_PATIENT_JSON_MAX_BYTES, 'request-json');
        if (!parsed.ok) {
            return NextResponse.json({ error: parsed.status === 413 ? 'Richiesta troppo grande.' : 'Richiesta non valida.' },
                { status: parsed.status });
        }
        if (parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
            return NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400 });
        }
        const body = parsed.value as Record<string, unknown>;
        /* @Codex: this host-only restore accepts no client actor or version fields. */
        if (Object.keys(body).some((key) => key !== 'patientId')) {
            return NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400 });
        }
        const patientId = typeof body.patientId === 'string' ? body.patientId.trim() : '';
        if (!patientId) {
            return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
        }

        /* @Codex: Web-admin identity is authoritative even when extra bearer headers are supplied. */
        const auditContext = auditContextFromSession(session);
        const requestId = requestIdFromRequest(request);
        const result = dbServer.transaction((tx) => {
            const patient = tx.select({ id: patients.id, version: patients.version, deletedAt: patients.deletedAt })
                .from(patients).where(eq(patients.id, patientId)).get();
            if (!patient) return { status: 404, value: { error: 'Not found' } } as const;
            if (!patient.deletedAt) {
                return { status: 409, value: { error: 'Patient is not soft-deleted' } } as const;
            }

            const restored = tx.update(patients)
                .set(buildPatientRestoreValues(patient.version))
                .where(and(eq(patients.id, patientId), eq(patients.version, patient.version),
                    isNotNull(patients.deletedAt)))
                .run();
            if (restored.changes !== 1) throw new Error('Restore patient update did not modify exactly one row');

            writeAuditEventInTransaction(tx, {
                eventType: 'patient.restored',
                outcome: 'success',
                actorType: auditContext.actorType,
                actorRef: auditContext.actorRef,
                subjectType: 'patient',
                subjectRef: patientId,
                sourceSurface: auditContext.sourceSurface,
                requestId,
                redactedMetadata: withAuditContextMetadata(auditContext, {
                    changedFields: ['deletedAt', 'deletionReason'],
                    resourceVersion: patient.version + 1,
                }),
            });

            return { status: 200, value: { success: true, patientId, version: patient.version + 1 } } as const;
        }, { behavior: 'immediate' });
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('[MediFlow] Restore patient failed:', error);
        return NextResponse.json({ error: 'Restore failed' }, { status: 500 });
    }
}
