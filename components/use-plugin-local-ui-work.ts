'use client';

import { createContext, useCallback, useContext, useRef } from 'react';
import type { createLocalUiWork } from '@/lib/plugin-local-ui-work';

export const PluginLocalUiWorkContext = createContext<ReturnType<typeof createLocalUiWork> | null>(null);

export function usePluginLocalUiWork(intent: string, patientId: string) {
    const work = useContext(PluginLocalUiWorkContext);
    const release = useRef<(() => void) | null>(null);
    const finish = useCallback(() => {
        release.current?.();
        release.current = null;
    }, []);
    return {
        begin(stop: () => void) {
            finish();
            work?.move(window.location.hash);
            release.current = work?.begin(intent, patientId, stop) ?? null;
        },
        finish,
    };
}
