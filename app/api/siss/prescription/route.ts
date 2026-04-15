/* @Codex */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { patients } from '@/lib/schema';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
import { createSissPrescriptionHandoff, SissPrescriptionError } from '@/lib/siss-prescription';

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

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

        const result = await createSissPrescriptionHandoff({
            patientId: patient.id,
            patientTaxCode: patient.taxCode,
        });

        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof SissPrescriptionError) {
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
