/* @Codex */
import { NextResponse } from 'next/server';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { inArray } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { settings } from '@/lib/schema';
import {
    buildAiRolloutLocalControlsPayload,
    buildAiRolloutReadinessArtifactsPayload,
} from '@/lib/ai-rollout-readiness-storage';
import { AI_PATIENT_INSIGHT_KILL_SWITCH_KEY } from '@/lib/ai-patient-insight-kill-switch';
import { AI_SMART_IMPORT_KILL_SWITCH_KEY } from '@/lib/ai-smart-import-kill-switch';
import { AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY } from '@/lib/ai-document-synthesis-kill-switch';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const rows = await dbServer
            .select({ key: settings.key, value: settings.value })
            .from(settings)
            .where(inArray(settings.key, [
                AI_PATIENT_INSIGHT_KILL_SWITCH_KEY,
                AI_SMART_IMPORT_KILL_SWITCH_KEY,
                AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY,
            ]));

        const rowMap = new Map(rows.map((row) => [row.key, row.value]));
        const localControls = buildAiRolloutLocalControlsPayload({
            patient_insight: rowMap.get(AI_PATIENT_INSIGHT_KILL_SWITCH_KEY),
            smart_import: rowMap.get(AI_SMART_IMPORT_KILL_SWITCH_KEY),
            document_synthesis: rowMap.get(AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY),
        });

        return NextResponse.json(buildAiRolloutReadinessArtifactsPayload({ localControls }));
    } catch (error) {
        console.error('GET ai rollout readiness artifacts failed:', error);
        return NextResponse.json({ error: 'Failed to load AI rollout readiness artifacts.' }, { status: 500 });
    }
}
