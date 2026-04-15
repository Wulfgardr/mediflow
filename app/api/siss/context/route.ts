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
import {
    createSissPatientContextHandoff,
    resolveSissPatientContextAction,
    SissPatientContextError,
} from '@/lib/siss-patient-context';

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json() as {
            patientId?: unknown;
            patientTaxCode?: unknown;
            action?: unknown;
        };
        const patientId = typeof body.patientId === 'string' ? body.patientId.trim() : '';
        const patientTaxCode = typeof body.patientTaxCode === 'string' ? body.patientTaxCode : '';
        const action = resolveSissPatientContextAction(body.action);

        if (!patientId) {
            return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
        }

        if (!action) {
            return NextResponse.json({ error: 'supported action is required' }, { status: 400 });
        }

        const patient = await dbServer
            .select({ id: patients.id })
            .from(patients)
            .where(eq(patients.id, patientId))
            .get();
        if (!patient) {
            return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
        }

        const result = await createSissPatientContextHandoff({
            patientId: patient.id,
            patientTaxCode,
            action,
        });

        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof SissPatientContextError) {
            return NextResponse.json(
                {
                    error: error.message,
                    code: error.code,
                    correlationId: error.correlationId,
                },
                { status: error.status },
            );
        }

        console.error('API POST /api/siss/context error:', error);
        return NextResponse.json({ error: 'Failed to start SISS contextual flow' }, { status: 500 });
    }
}
