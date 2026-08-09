/* @Codex */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { settings } from '@/lib/schema';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import {
    AI_TREATMENT_REASONING_KILL_SWITCH_KEY,
    isAiTreatmentReasoningEnabledValue,
} from '@/lib/ai-treatment-reasoning-kill-switch';
import { generateWithAthenaMlx, resolveAthenaMlxMaxTokens } from '@/lib/athena-mlx-runtime';
import { TREATMENT_REASONING_SCHEMA_VERSION } from '@/lib/treatment-reasoning-contract';
import { apiInternalError } from '@/lib/api-error-response';

export const dynamic = 'force-dynamic';

const MAX_PROMPT_CHARS = 28_000;

async function isTreatmentReasoningEnabled(): Promise<boolean> {
    try {
        const row = await dbServer
            .select({ value: settings.value })
            .from(settings)
            .where(eq(settings.key, AI_TREATMENT_REASONING_KILL_SWITCH_KEY))
            .get();

        return isAiTreatmentReasoningEnabledValue(row?.value);
    } catch (error) {
        console.warn('[MediFlow] Treatment reasoning kill switch read failed; blocking ATHENA MLX route.', error);
        return false;
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        if (!(await isTreatmentReasoningEnabled())) {
            return NextResponse.json({
                error: 'AI Treatment Reasoning is disabled by the local rollout kill switch.',
            }, { status: 403 });
        }

        const payload = await request.json().catch(() => null) as {
            prompt?: unknown;
            maxTokens?: unknown;
        } | null;
        const prompt = typeof payload?.prompt === 'string' ? payload.prompt : '';
        const maxTokens = resolveAthenaMlxMaxTokens(
            typeof payload?.maxTokens === 'number' ? payload.maxTokens : undefined,
        );

        if (!prompt.trim()) {
            return NextResponse.json({ error: 'Missing treatment reasoning prompt.' }, { status: 400 });
        }
        if (prompt.length > MAX_PROMPT_CHARS) {
            return NextResponse.json({ error: 'Treatment reasoning prompt exceeds local ATHENA limit.' }, { status: 413 });
        }
        if (!prompt.includes(TREATMENT_REASONING_SCHEMA_VERSION)) {
            return NextResponse.json({ error: 'Treatment reasoning prompt schema is missing.' }, { status: 400 });
        }

        const result = await generateWithAthenaMlx({
            prompt,
            maxTokens,
            timeoutMs: 420_000,
        });

        return NextResponse.json({
            content: result.content,
            model: result.model,
            provider: 'athena_mlx',
            latencyMs: result.latencyMs,
            runtimeArtifact: result.artifactKind,
            quantizationBits: result.quantizationBits,
        });
    } catch (error) {
        /* Il messaggio grezzo qui espone percorsi del modello e argomenti del
           runtime MLX. */
        return apiInternalError('ATHENA MLX generation', error, {
            code: 'athena_mlx_generation_failed',
            message: 'Generazione ATHENA MLX non riuscita.',
        });
    }
}
