/* @Codex */
import { readNativeNetworkJson, jsonBodyTooLargeResponse, NATIVE_BOOTSTRAP_JSON_MAX_BYTES } from '@/lib/native-network-json-body';
import { NextResponse } from 'next/server';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
/* @Codex */
import {
    listNetworkPairingIntents,
    postNetworkPairingIntent,
} from '@/lib/network-home-base-server';

/* @Codex */
export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const intents = await listNetworkPairingIntents();
        return NextResponse.json(intents);
    } catch (error) {
        console.error('API GET /api/v1/network/pairing-intents error:', error);
        return NextResponse.json({ error: 'Failed to load pairing intents' }, { status: 500 });
    }
}

/* @Codex */
export async function POST(request: Request) {
    try {
        const payload = await readNativeNetworkJson(request, NATIVE_BOOTSTRAP_JSON_MAX_BYTES);
        const result = await postNetworkPairingIntent(payload);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        /* @Codex */
        const sizeError = jsonBodyTooLargeResponse(error);
        if (sizeError) return sizeError;
        console.error('API POST /api/v1/network/pairing-intents error:', error);
        return NextResponse.json({ error: 'Failed to create pairing intent' }, { status: 500 });
    }
}
