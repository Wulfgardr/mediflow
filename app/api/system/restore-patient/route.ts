// WUL-306 (ADR 0066): explicit admin restore of a soft-deleted patient.
import { NextResponse } from 'next/server';
import { desc, eq, isNotNull } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { patients } from '@/lib/schema';
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';
/* @Codex */
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
import { buildPatientRestoreValues } from '@/lib/patient-lifecycle';
import { safeWriteAuditEventFromRequest } from '@/lib/security/audit';

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
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const patientId = typeof body.patientId === 'string' ? body.patientId.trim() : '';
        if (!patientId) {
            return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
        }

        const patient = await dbServer
            .select({ id: patients.id, version: patients.version, deletedAt: patients.deletedAt })
            .from(patients)
            .where(eq(patients.id, patientId))
            .get();
        if (!patient) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        if (!patient.deletedAt) {
            return NextResponse.json({ error: 'Patient is not soft-deleted' }, { status: 409 });
        }

        await dbServer
            .update(patients)
            .set(buildPatientRestoreValues(patient.version))
            .where(eq(patients.id, patientId))
            .run();

        await safeWriteAuditEventFromRequest(
            request,
            session,
            {
                eventType: 'patient.restored',
                subjectType: 'patient',
                subjectRef: patientId,
                redactedMetadata: {
                    changedFields: ['deletedAt', 'deletionReason'],
                    resourceVersion: patient.version + 1,
                },
            },
            '[MediFlow] Patient restore audit write failed:',
        );

        return NextResponse.json({ success: true, patientId, version: patient.version + 1 });
    } catch (error) {
        console.error('[MediFlow] Restore patient failed:', error);
        return NextResponse.json({ error: 'Restore failed' }, { status: 500 });
    }
}
