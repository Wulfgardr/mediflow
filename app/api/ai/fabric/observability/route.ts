import { NextRequest, NextResponse } from 'next/server';
import { inArray } from 'drizzle-orm';
/* @Codex */
import { dbServer } from '@/lib/db-server';
import { settings } from '@/lib/schema';
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

    // Lettura server-side diretta delle impostazioni (pattern di
    // lib/network-ai-runtime.ts): il facade client di lib/db non e'
    // utilizzabile nel runtime Node delle route.
    const rows = await dbServer
        .select({ key: settings.key, value: settings.value })
        .from(settings)
        .where(inArray(settings.key, ['aiUrl', 'ollamaUrl', NETWORK_MODE_KEY]));
    const snapshot = new Map(rows.map((row) => [row.key, row.value]));
    const rawBaseUrl = resolveOllamaBaseUrl(
        snapshot.get('aiUrl'),
        snapshot.get('ollamaUrl'),
        DEFAULT_OLLAMA_BASE_URL,
    );
    const networkMode = snapshot.get(NETWORK_MODE_KEY);
    const localProcess = await observeLocalProcess(rawBaseUrl);
    const homeBase = normalizeNetworkOperatingMode(networkMode) === 'network-home-base'
        ? observeVenue('home_base', 'available', null)
        : observeVenue('home_base', 'offline', 'mode_disabled');

    return NextResponse.json(buildObservabilitySnapshot([
        localProcess,
        homeBase,
        observeVenue('on_device', 'unknown', 'not_implemented'),
        observeVenue('cloud', 'offline', 'egress_profile_closed'),
    ]));
}
