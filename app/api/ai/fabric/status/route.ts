import { NextRequest, NextResponse } from 'next/server';
/* @Codex */
import { createHostProviderLifecycleService } from '@/lib/ai-providers/fabric/provider-lifecycle-service';
import { buildFabricStatusSnapshot } from '@/lib/ai-providers/fabric/status';
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/security/server-auth';

const ollamaLifecycle = createHostProviderLifecycleService().service;
const athenaLifecycle = createHostProviderLifecycleService({ provider: 'athena_mlx' }).service;

export async function GET(req: NextRequest) {
    /* @Codex */
    const session = await requireSessionOrLocalToken(req);
    if (!session) return unauthorizedResponse();

    return NextResponse.json(buildFabricStatusSnapshot({
        ollama: () => ollamaLifecycle.read(),
        athena: () => athenaLifecycle.read(),
    }), {
        headers: { 'Cache-Control': 'no-store' },
    });
}
