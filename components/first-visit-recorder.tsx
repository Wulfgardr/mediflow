'use client';

import { useState } from 'react';
import { LocalVoiceRecorderPanel } from '@/components/local-voice-recorder';
import { firstVisitSource } from '@/lib/local-voice/first-visit-source';

const DRAFT_KEY = 'mediflow:prima-visita';

function firstVisitDraft(): string {
    try {
        const kept = window.sessionStorage.getItem(DRAFT_KEY);
        if (kept && /^[a-f0-9-]{36}$/u.test(kept)) return kept;
        const created = crypto.randomUUID();
        window.sessionStorage.setItem(DRAFT_KEY, created);
        return created;
    } catch {
        return crypto.randomUUID();
    }
}

/** A first visit recorded on this tab: once reviewed, its text enters the new-sheet engine as one more source. */
export function FirstVisitRecorder({ onSource }: { onSource: (file: File) => void }) {
    const [draft] = useState(firstVisitDraft);
    return <LocalVoiceRecorderPanel subject={`prima-visita:${draft}`} vocabulary={[]} modes={['visit']} title="Registra la prima visita"
        takeLabel="Usa per la nuova scheda" onTake={async (text) => onSource(await firstVisitSource(text, new Date()))} />;
}
