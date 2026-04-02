/* @Codex */
import { NextResponse } from 'next/server';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
import { readAiRolloutReadinessArtifacts } from '@/lib/ai-rollout-readiness-storage';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const artifacts = readAiRolloutReadinessArtifacts();
        return NextResponse.json({
            lanes: artifacts.map((artifact) => ({
                lane: artifact.lane,
                available: artifact.available,
                updatedAt: artifact.artifact?.updatedAt || null,
                jsonPath: artifact.artifact?.paths.jsonPath || null,
                markdownPath: artifact.artifact?.paths.markdownPath || null,
                markdown: artifact.artifact?.markdown || null,
                report: artifact.artifact?.report || null,
            })),
        });
    } catch (error) {
        console.error('GET ai rollout readiness artifacts failed:', error);
        return NextResponse.json({ error: 'Failed to load AI rollout readiness artifacts.' }, { status: 500 });
    }
}
