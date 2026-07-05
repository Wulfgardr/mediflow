/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import { and, eq } from 'drizzle-orm';
/* @Codex */
import { dbServer } from '@/lib/db-server';
/* @Codex */
import { patients } from '@/lib/schema';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
// WUL-306 (ADR 0066): soft-deleted patients are not addressable for SISS handoffs
import { activePatients } from '@/lib/patient-lifecycle';
/* @Codex */
import { safeWriteAuditEventFromRequest } from '@/lib/security/audit';
/* @Codex */
import { resolveSissPatientContextAction } from '@/lib/siss-patient-context-shared';
/* @Codex */
import {
    createSissPatientContextHandoff,
    SissPatientContextError,
} from '@/lib/siss-patient-context';
/* @Codex */
import { buildSissPrescriptionLaunchAuditMetadata } from '@/lib/siss-audit';

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    let auditPatientId: string | null = null;
    let shouldAuditPrescriptionLaunch = false;

    try {
        const body = await request.json() as {
            patientId?: unknown;
            action?: unknown;
        };
        const patientId = typeof body.patientId === 'string' ? body.patientId.trim() : '';
        const action = resolveSissPatientContextAction(body.action);

        if (!patientId) {
            return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
        }

        if (!action) {
            return NextResponse.json({ error: 'supported action is required' }, { status: 400 });
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
        shouldAuditPrescriptionLaunch = action === 'prescription.create';

        const result = await createSissPatientContextHandoff({
            patientId: patient.id,
            patientTaxCode: patient.taxCode,
            action,
        });

        if (shouldAuditPrescriptionLaunch) {
            await safeWriteAuditEventFromRequest(request, session, {
                eventType: 'patient.siss.prescription.launch',
                subjectType: 'patient',
                subjectRef: patient.id,
                redactedMetadata: buildSissPrescriptionLaunchAuditMetadata({
                    entrypoint: 'patient-context',
                    mode: result.mode,
                    outcome: 'success',
                }),
            }, '[MediFlow] SISS patient-context prescription audit write failed:');
        }

        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof SissPatientContextError) {
            if (shouldAuditPrescriptionLaunch && auditPatientId) {
                await safeWriteAuditEventFromRequest(request, session, {
                    eventType: 'patient.siss.prescription.launch',
                    outcome: 'failure',
                    subjectType: 'patient',
                    subjectRef: auditPatientId,
                    redactedMetadata: buildSissPrescriptionLaunchAuditMetadata({
                        entrypoint: 'patient-context',
                        outcome: 'failure',
                        reasonCode: error.code,
                    }),
                }, '[MediFlow] SISS patient-context prescription audit write failed:');
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

        if (shouldAuditPrescriptionLaunch && auditPatientId) {
            await safeWriteAuditEventFromRequest(request, session, {
                eventType: 'patient.siss.prescription.launch',
                outcome: 'failure',
                subjectType: 'patient',
                subjectRef: auditPatientId,
                redactedMetadata: buildSissPrescriptionLaunchAuditMetadata({
                    entrypoint: 'patient-context',
                    outcome: 'failure',
                    reasonCode: 'SISS_UPSTREAM',
                }),
            }, '[MediFlow] SISS patient-context prescription audit write failed:');
        }

        console.error('API POST /api/siss/context error:', error);
        return NextResponse.json({ error: 'Failed to start SISS contextual flow' }, { status: 500 });
    }
}
