import { NextRequest, NextResponse } from 'next/server';
/* @Codex */
import { buildFabricStatusSnapshot } from '@/lib/ai-providers/fabric/status';
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/security/server-auth';

export async function GET(req: NextRequest) {
    /* @Codex */
    const session = await requireSessionOrLocalToken(req);
    if (!session) return unauthorizedResponse();

    return NextResponse.json(buildFabricStatusSnapshot());
}
