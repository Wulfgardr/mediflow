/* @Codex */
import { NextResponse } from 'next/server';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import {
    getFseValidatePatientId,
    validatePatientExport,
} from '@/lib/fse-validate-patient';

export async function GET(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const patientId = getFseValidatePatientId(request);
        if (!patientId) {
            return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
        }

        const validation = await validatePatientExport(patientId);
        if (!validation) {
            return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
        }

        return NextResponse.json(validation);
    } catch (error) {
        console.error('API GET /api/fse/validate-patient error:', error);
        return NextResponse.json({ error: 'Failed to validate patient export' }, { status: 500 });
    }
}
