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
        if (artifacts.length === 0) {
            return NextResponse.json({ error: 'AI rollout readiness artifacts not found.' }, { status: 404 });
        }

        return NextResponse.json({
            lanes: artifacts.map((artifact) => ({
                lane: artifact.lane,
                updatedAt: artifact.updatedAt,
                jsonPath: artifact.paths.jsonPath,
                markdownPath: artifact.paths.markdownPath,
                markdown: artifact.markdown,
                report: artifact.report,
            })),
        });
    } catch (error) {
        console.error('GET ai rollout readiness artifacts failed:', error);
        return NextResponse.json({ error: 'Failed to load AI rollout readiness artifacts.' }, { status: 500 });
    }
}
