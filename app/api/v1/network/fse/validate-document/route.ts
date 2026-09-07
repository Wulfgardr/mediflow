/* @Codex */
import { readNativeNetworkJson, jsonBodyTooLargeResponse } from '@/lib/native-network-json-body';
/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import { validateFseDocumentPayload } from '@/lib/fse-validate-document';
/* @Codex */
import { NETWORK_FSE_VALIDATE_CAPABILITY } from '@/lib/network-contract';
/* @Codex */
import { requireNetworkCapabilityContext } from '@/lib/network-write-context';

/* @Codex */
export async function POST(request: Request) {
    try {
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_FSE_VALIDATE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const body = await readNativeNetworkJson(request) as Record<string, unknown>;
        const result = await validateFseDocumentPayload(body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        /* @Codex */
        const sizeError = jsonBodyTooLargeResponse(error);
        if (sizeError) return sizeError;
        console.error('API POST /api/v1/network/fse/validate-document error:', error);
        return NextResponse.json({ error: 'Failed to validate profile document' }, { status: 500 });
    }
}
