import { archiveReplacementResponse } from '@/lib/api-error-response';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { patients } from '@/lib/schema';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
// WUL-306 (ADR 0066): soft-deleted patients are not addressable for SISS handoffs
import { activePatients } from '@/lib/patient-lifecycle';
import { safeWriteAuditEventFromRequest } from '@/lib/security/audit';
import { createSissPrescriptionHandoff, SissPrescriptionError } from '@/lib/siss-prescription';
import { buildSissPrescriptionLaunchAuditMetadata } from '@/lib/siss-audit';

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

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
            .where(and(eq(patients.id, patientId), activePatients()))
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
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
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

        if (auditPatientId) {
            await safeWriteAuditEventFromRequest(request, session, {
                eventType: 'patient.siss.prescription.launch',
                outcome: 'failure',
                subjectType: 'patient',
                subjectRef: auditPatientId,
                redactedMetadata: buildSissPrescriptionLaunchAuditMetadata({
                    entrypoint: 'therapy-panel',
                    outcome: 'failure',
                    reasonCode: 'SISS_UPSTREAM',
                }),
            }, '[MediFlow] SISS prescription audit write failed:');
        }

        console.error('API POST /api/siss/prescription error:', error);
        return NextResponse.json({ error: 'Failed to start SISS prescription flow' }, { status: 500 });
    }
}
