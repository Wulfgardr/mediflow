'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/lib/db';
import { useSecurity } from '@/components/security-provider';
import { clientArchiveGeneration } from '@/lib/security/client-auth-api';
import { createEntryLocalDraft, entryDraftToPersist, type EntryLocalDraft } from '@/lib/entry-local-draft';

export function useEntryLocalDraft(patient: string, value: EntryLocalDraft, restore: (value: EntryLocalDraft) => void) {
    const { user } = useSecurity();
    const [state, setState] = useState<'loading' | 'ready' | 'recovered' | 'failed'>('loading');
    const restoreRef = useRef(restore);
    useEffect(() => { restoreRef.current = restore; }, [restore]);
    const [saved, setSaved] = useState(false);
    const revision = useRef(0);
    const [error, setError] = useState('');
    const owner = useMemo(() => typeof window === 'undefined' || !user ? null
        : createEntryLocalDraft({ archive: clientArchiveGeneration(), user: user.id, patient }, window.localStorage, db, navigator.locks), [patient, user]);
    useEffect(() => {
        if (!owner) return;
        let current = true;
        setState('loading');
        void owner.read().then(draft => {
            if (!current) return;
            if (draft) restoreRef.current(draft);
            setState(draft ? 'recovered' : 'ready');
        }).catch(() => { if (current) { setState('failed'); setError('La bozza conservata non è leggibile. Non verrà sovrascritta.'); } });
        return () => { current = false; };
    }, [owner]);
    useEffect(() => {
        if (!owner || state === 'loading' || state === 'failed' || value.editState === 'pristine') return;
        const current = ++revision.current;
        setSaved(false);
        void owner.save(value).then(() => { if (current === revision.current) { setSaved(entryDraftToPersist(value) !== null); setError(''); } })
            .catch(() => { if (current === revision.current) setError('Bozza automatica non conservata. Mantieni aperta questa schermata e registra il resoconto.'); });
    }, [owner, value, state]);
    const clear = async () => { if (owner) { await owner.discard(); } };
    return { state, saved, error, clear, hasDraft: entryDraftToPersist(value) !== null };
}
