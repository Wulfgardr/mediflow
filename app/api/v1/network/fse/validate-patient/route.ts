import { NextResponse } from 'next/server';
import {
    getFseValidatePatientId,
    validatePatientExport,
} from '@/lib/fse-validate-patient';
import { validateNetworkScopedPatientExport } from '@/lib/network-fse-validation';
import { getNetworkScopedPatientDetail } from '@/lib/network-patient-read';

export async function GET(request: Request) {
    try {
        let patientId: string | null = null;
        const resolved = await getNetworkScopedPatientDetail(request, () => {
            patientId = getFseValidatePatientId(request);
            return patientId;
        }, 'network-fse');
        if (!resolved.ok) return resolved.response;

        const result = await validateNetworkScopedPatientExport(
            patientId,
            resolved.scopeAmbulatoryId!,
            {
                getNetworkScopedPatientDetail: async () => resolved.profile,
                validatePatientExport,
            },
        );
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API GET /api/v1/network/fse/validate-patient error:', error);
        return NextResponse.json({ error: 'Failed to validate patient export' }, { status: 500 });
    }
}
