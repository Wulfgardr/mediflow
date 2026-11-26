'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { LocalVoiceRecorder } from '@/lib/local-voice/recorder';

const recorders = new Map<string, { recorder: LocalVoiceRecorder; users: number }>();

function recorderFor(subject: string) {
    let entry = recorders.get(subject);
    if (!entry) {
        entry = { recorder: new LocalVoiceRecorder(subject), users: 0 };
        recorders.set(subject, entry);
    }
    return entry;
}

/** The recording surface owns microphone and text for its subject and lets go of them when it leaves. */
export function useLocalVoiceRecorder(subject: string) {
    const { recorder } = recorderFor(subject);
    useEffect(() => {
        const entry = recorderFor(subject);
        entry.users += 1;
        if (entry.users === 1) void entry.recorder.refresh();
        return () => {
            entry.users -= 1;
            queueMicrotask(() => {
                if (entry.users > 0 || recorders.get(subject) !== entry) return;
                recorders.delete(subject);
                entry.recorder.dispose();
            });
        };
    }, [subject]);
    const view = useSyncExternalStore(recorder.subscribe, recorder.getSnapshot, recorder.getSnapshot);
    return [view, recorder] as const;
}
