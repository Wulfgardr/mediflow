import { NextRequest, NextResponse } from 'next/server';
/* @Codex */
import { createHostProviderLifecycleService } from '@/lib/ai-providers/fabric/provider-lifecycle-service';
import { buildFabricStatusSnapshot, buildPortableFabricStatusSnapshot } from '@/lib/ai-providers/fabric/status';
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/security/server-auth';

import { createPortableProvisioning } from '@/lib/ai-providers/fabric/treatment-reasoning-portable-provisioning';
import { FABRIC_STATUS_VERSION_HEADER } from '@/lib/ai-providers/fabric/treatment-reasoning-portable-disclosure';

// @Codex: launcher-owned root, independent of the Webpack module/asset location.
const portable = createPortableProvisioning({ applicationRoot: process.cwd() });
const ollamaLifecycle = createHostProviderLifecycleService().service;
const athenaLifecycle = createHostProviderLifecycleService({ provider: 'athena_mlx' }).service;

export async function GET(req: NextRequest) {
    /* @Codex */
    const session = await requireSessionOrLocalToken(req);
    if (!session) return unauthorizedResponse();

    const requested = req.headers.get(FABRIC_STATUS_VERSION_HEADER);
    if (requested !== null && requested !== '1' && requested !== '2') return NextResponse.json({ error: 'input_invalid' },
        { status: 400, headers: { 'Cache-Control': 'no-store', Vary: FABRIC_STATUS_VERSION_HEADER } });
    const sources = { ollama: () => ollamaLifecycle.read(), athena: () => athenaLifecycle.read() };
    const snapshot = requested === '2' ? buildPortableFabricStatusSnapshot(sources, portable) : buildFabricStatusSnapshot(sources);
    return NextResponse.json(snapshot, {
        headers: { 'Cache-Control': 'no-store', Vary: FABRIC_STATUS_VERSION_HEADER, [FABRIC_STATUS_VERSION_HEADER]: requested === '2' ? '2' : '1' },
    });
}
