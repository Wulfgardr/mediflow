/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import { cookies } from 'next/headers';
/* @Codex */
import { requireSession, requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import {
    getNetworkAiRuntimeSummary,
    getNetworkCapabilities,
    getNetworkIdentitySummary,
    getNetworkNodeSummary,
    getNetworkSessionSummary,
} from '@/lib/network-home-base-server';

/* @Codex */
export async function GET(request: Request) {
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();

    try {
        const cookieStore = await cookies();
        const activeAmbulatoryId = cookieStore.get('ambulatory_id')?.value ?? null;
        const operatorSession = await requireSession();

        const [node, sessionSummary, capabilities, aiRuntime, identity] = await Promise.all([
            getNetworkNodeSummary(),
            getNetworkSessionSummary(),
            getNetworkCapabilities(),
            getNetworkAiRuntimeSummary(),
            getNetworkIdentitySummary(operatorSession, activeAmbulatoryId),
        ]);

        const activationReason = sessionSummary.operatingMode === 'network-home-base'
            ? 'manual'
            : 'default-local';

        return NextResponse.json({
            node,
            session: sessionSummary,
            aiRuntime,
            identity,
            capabilities: capabilities.capabilities,
            activationReason,
            lastContactAt: null,
            lastSyncAt: null,
        });
    } catch (error) {
        console.error('API GET /api/system/network-overview error:', error);
        return NextResponse.json({ error: 'Failed to load network overview' }, { status: 500 });
    }
}
