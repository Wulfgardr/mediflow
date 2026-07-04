/* @Codex */
import { NextResponse } from 'next/server';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { readAiModelParliamentArtifact } from '@/lib/ai-model-parliament-storage';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const artifact = readAiModelParliamentArtifact();
        if (!artifact) {
            return NextResponse.json({ error: 'AI parliament report not found.' }, { status: 404 });
        }

        return NextResponse.json({
            updatedAt: artifact.updatedAt,
            jsonPath: artifact.paths.jsonPath,
            markdownPath: artifact.paths.markdownPath,
            report: artifact.report,
        });
    } catch (error) {
        console.error('GET ai parliament report failed:', error);
        return NextResponse.json({ error: 'Failed to load AI parliament report.' }, { status: 500 });
    }
}
