'use client';

/* @Codex */
import { useEffect, useState } from 'react';
import { getAiModelLabels } from '@/lib/ai-summary-service';

type AiModelLabels = Awaited<ReturnType<typeof getAiModelLabels>>;

/* @Codex */
export function useAiModelLabels(): AiModelLabels | null {
    const [modelLabels, setModelLabels] = useState<AiModelLabels | null>(null);

    useEffect(() => {
        let mounted = true;

        void getAiModelLabels()
            .then((models) => {
                if (mounted) setModelLabels(models);
            })
            .catch(() => {
                if (mounted) setModelLabels(null);
            });

        return () => {
            mounted = false;
        };
    }, []);

    return modelLabels;
}
