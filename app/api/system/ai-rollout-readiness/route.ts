/* @Codex */
import { NextResponse } from 'next/server';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
import { buildAiRolloutReadinessArtifactsPayload } from '@/lib/ai-rollout-readiness-storage';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        return NextResponse.json(buildAiRolloutReadinessArtifactsPayload());
    } catch (error) {
        console.error('GET ai rollout readiness artifacts failed:', error);
        return NextResponse.json({ error: 'Failed to load AI rollout readiness artifacts.' }, { status: 500 });
    }
}
