'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { LocalVoiceRecorder } from '@/lib/local-voice/recorder';

const recorders = new Map<string, { recorder: LocalVoiceRecorder; users: number }>();

export type LocalVoiceSurface = 'recording' | 'availability';

function recorderFor(key: string, subject: string) {
    let entry = recorders.get(key);
    if (!entry) {
        entry = { recorder: new LocalVoiceRecorder(subject), users: 0 };
        recorders.set(key, entry);
    }
    return entry;
}

/**
 * One recorder per subject and surface: the recording surface owns microphone and text and lets go of them when it leaves,
 * even if a header on the same page still reads the availability.
 */
export function useLocalVoiceRecorder(subject: string, surface: LocalVoiceSurface) {
    const key = `${surface}:${subject}`;
    const { recorder } = recorderFor(key, subject);
    useEffect(() => {
        const entry = recorderFor(key, subject);
        entry.users += 1;
        if (entry.users === 1) void entry.recorder.refresh();
        return () => {
            entry.users -= 1;
            queueMicrotask(() => {
                if (entry.users > 0 || recorders.get(key) !== entry) return;
                recorders.delete(key);
                entry.recorder.dispose();
            });
        };
    }, [key, subject]);
    const view = useSyncExternalStore(recorder.subscribe, recorder.getSnapshot, recorder.getSnapshot);
    return [view, recorder] as const;
}
