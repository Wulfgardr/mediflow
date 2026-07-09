/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    getFseValidatePatientId,
    validatePatientExport,
} from '@/lib/fse-validate-patient';
/* @Codex */
import { NETWORK_FSE_VALIDATE_CAPABILITY } from '@/lib/network-contract';
/* @Codex */
import { validateNetworkScopedPatientExport } from '@/lib/network-fse-validation';
/* @Codex */
import { getNetworkScopedPatientDetail } from '@/lib/network-patient-read';
/* @Codex */
import { requireNetworkCapabilityContext } from '@/lib/network-write-context';

/* @Codex */
export async function GET(request: Request) {
    try {
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_FSE_VALIDATE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const result = await validateNetworkScopedPatientExport(
            getFseValidatePatientId(request),
            resolved.context.scopeAmbulatoryId,
            {
                getNetworkScopedPatientDetail,
                validatePatientExport,
            },
        );
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API GET /api/v1/network/fse/validate-patient error:', error);
        return NextResponse.json({ error: 'Failed to validate patient export' }, { status: 500 });
    }
}
