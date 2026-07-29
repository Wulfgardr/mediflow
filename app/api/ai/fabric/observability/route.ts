import { NextRequest, NextResponse } from 'next/server';
/* @Codex */
import { db } from '@/lib/db';
import {
    DEFAULT_OLLAMA_BASE_URL,
    resolveOllamaBaseUrl,
} from '@/lib/ai-providers/base-url';
import {
    buildObservabilitySnapshot,
    observeVenue,
    type VenueObservation,
} from '@/lib/ai-providers/fabric/routing-observability';
import { strictOllamaLoopbackBaseUrl } from '@/lib/ai-providers/ollama-locality';
import {
    NETWORK_MODE_KEY,
    normalizeNetworkOperatingMode,
} from '@/lib/network-contract';
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/security/server-auth';

async function observeLocalProcess(rawBaseUrl: string): Promise<VenueObservation> {
    let baseUrl: string;
    try {
        baseUrl = strictOllamaLoopbackBaseUrl(rawBaseUrl);
    } catch {
        return observeVenue('local_process', 'offline', 'target_invalid');
    }

    try {
        const response = await fetch(`${baseUrl}/api/tags`, {
            method: 'GET',
            redirect: 'error',
            signal: AbortSignal.timeout(1_500),
        });
        return response.ok
            ? observeVenue('local_process', 'available', null)
            : observeVenue('local_process', 'offline', 'daemon_unreachable');
    } catch {
        return observeVenue('local_process', 'offline', 'daemon_unreachable');
    }
}

export async function GET(req: NextRequest) {
    /* @Codex */
    const session = await requireSessionOrLocalToken(req);
    if (!session) return unauthorizedResponse();

    const [genericUrl, legacyUrl, networkMode] = await Promise.all([
        db.settings.get('aiUrl'),
        db.settings.get('ollamaUrl'),
        db.settings.get(NETWORK_MODE_KEY),
    ]);
    const rawBaseUrl = resolveOllamaBaseUrl(
        genericUrl?.value,
        legacyUrl?.value,
        DEFAULT_OLLAMA_BASE_URL,
    );
    const localProcess = await observeLocalProcess(rawBaseUrl);
    const homeBase = normalizeNetworkOperatingMode(networkMode?.value) === 'network-home-base'
        ? observeVenue('home_base', 'available', null)
        : observeVenue('home_base', 'offline', 'mode_disabled');

    return NextResponse.json(buildObservabilitySnapshot([
        localProcess,
        homeBase,
        observeVenue('on_device', 'unknown', 'not_implemented'),
        observeVenue('cloud', 'offline', 'egress_profile_closed'),
    ]));
}
