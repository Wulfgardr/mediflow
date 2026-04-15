/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import { eq } from 'drizzle-orm';
/* @Codex */
import { dbServer } from '@/lib/db-server';
/* @Codex */
import { patients } from '@/lib/schema';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { safeWriteAuditEventFromRequest } from '@/lib/audit';
/* @Codex */
import { createSissPrescriptionHandoff, SissPrescriptionError } from '@/lib/siss-prescription';
/* @Codex */
import { buildSissPrescriptionLaunchAuditMetadata } from '@/lib/siss-audit';

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    let auditPatientId: string | null = null;

    try {
        const body = await request.json() as { patientId?: unknown };
        const patientId = typeof body.patientId === 'string' ? body.patientId.trim() : '';
        if (!patientId) {
            return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
        }

        const patient = await dbServer
            .select({ id: patients.id, taxCode: patients.taxCode })
            .from(patients)
            .where(eq(patients.id, patientId))
            .get();
        if (!patient) {
            return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
        }

        auditPatientId = patient.id;

        const result = await createSissPrescriptionHandoff({
            patientId: patient.id,
            patientTaxCode: patient.taxCode,
        });

        await safeWriteAuditEventFromRequest(request, session, {
            eventType: 'patient.siss.prescription.launch',
            subjectType: 'patient',
            subjectRef: patient.id,
            redactedMetadata: buildSissPrescriptionLaunchAuditMetadata({
                entrypoint: 'therapy-panel',
                mode: result.mode,
                outcome: 'success',
            }),
        }, '[MediFlow] SISS prescription audit write failed:');

        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof SissPrescriptionError) {
            if (auditPatientId) {
                await safeWriteAuditEventFromRequest(request, session, {
                    eventType: 'patient.siss.prescription.launch',
                    outcome: 'failure',
                    subjectType: 'patient',
                    subjectRef: auditPatientId,
                    redactedMetadata: buildSissPrescriptionLaunchAuditMetadata({
                        entrypoint: 'therapy-panel',
                        outcome: 'failure',
                        reasonCode: error.code,
                    }),
                }, '[MediFlow] SISS prescription audit write failed:');
            }

            return NextResponse.json(
                {
                    error: error.message,
                    code: error.code,
                    correlationId: error.correlationId,
                },
                { status: error.status },
            );
        }

        console.error('API POST /api/siss/prescription error:', error);
        return NextResponse.json({ error: 'Failed to start SISS prescription flow' }, { status: 500 });
    }
}
