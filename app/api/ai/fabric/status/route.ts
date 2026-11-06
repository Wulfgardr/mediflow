import { NextRequest, NextResponse } from 'next/server';
import { createHostProviderLifecycleService } from '@/lib/ai-providers/fabric/provider-lifecycle-service';
import { buildFabricStatusSnapshot } from '@/lib/ai-providers/fabric/status';
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/security/server-auth';

const ollamaLifecycle = createHostProviderLifecycleService().service;

export async function GET(req: NextRequest) {
    if (!await requireSessionOrLocalToken(req)) return unauthorizedResponse();
    const versionHeader = 'x-mediflow-fabric-status';
    const requested = req.headers.get(versionHeader);
    if (requested !== null && requested !== '1') return NextResponse.json({ error: 'input_invalid' },
        { status: 400, headers: { 'Cache-Control': 'no-store', Vary: versionHeader } });
    return NextResponse.json(buildFabricStatusSnapshot({ ollama: () => ollamaLifecycle.read() }), {
        headers: { 'Cache-Control': 'no-store', Vary: versionHeader, [versionHeader]: '1' },
    });
}
