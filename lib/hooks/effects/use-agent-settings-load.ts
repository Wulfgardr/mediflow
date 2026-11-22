'use client';

import { useEffect, useRef } from 'react';

export function useAgentSettingsLoad(load: () => Promise<void>) {
    const startedRef = useRef(false);
    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        void load();
    }, [load]);
}
