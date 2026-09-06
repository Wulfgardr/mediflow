'use client';

/* @Codex */
import { useEffect, useState } from 'react';
import { getAiModelLabels } from '@/lib/ai-summary-service';
import { db } from '@/lib/db';

type AiModelLabels = Awaited<ReturnType<typeof getAiModelLabels>>;

/* @Codex */
export function useAiModelLabels(enabled = true): AiModelLabels | null {
    const [modelLabels, setModelLabels] = useState<AiModelLabels | null>(null);

    useEffect(() => {
        if (!enabled) return;
        let controller: AbortController;
        const read = () => {
            controller = new AbortController();
            const signal = AbortSignal.any([controller.signal, db.getSessionReadSignal()]);
            void getAiModelLabels(signal)
                .then(models => { if (!signal.aborted) setModelLabels(models); })
                .catch(() => { if (!signal.aborted) setModelLabels(null); });
        };
        const retire = () => controller.abort();
        const restore = () => { if (controller.signal.aborted) read(); };
        read();
        window.addEventListener('pagehide', retire);
        window.addEventListener('pageshow', restore);

        return () => {
            retire();
            window.removeEventListener('pagehide', retire);
            window.removeEventListener('pageshow', restore);
        };
    }, [enabled]);

    return enabled ? modelLabels : null;
}
