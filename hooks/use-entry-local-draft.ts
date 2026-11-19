'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { db } from '@/lib/db';
import { useSecurity } from '@/components/security-provider';
import { clientArchiveGeneration } from '@/lib/security/client-auth-api';
import { createEntryLocalDraft, entryDraftStorageKey, entryDraftToPersist, type EntryLocalDraft } from '@/lib/entry-local-draft';

const draftChanged = 'mediflow:entry-draft-changed';

export function hasEntryDraft(user: string, patient: string) {
    try {
        return window.localStorage.getItem(entryDraftStorageKey({ archive: clientArchiveGeneration(), user, patient })) !== null;
    } catch {
        return false;
    }
}

function subscribeToDrafts(notify: () => void) {
    window.addEventListener('storage', notify);
    window.addEventListener(draftChanged, notify);
    return () => {
        window.removeEventListener('storage', notify);
        window.removeEventListener(draftChanged, notify);
    };
}

const absent = () => false;

export function useEntryDraftMarker(patient: string) {
    const { user } = useSecurity();
    const read = useCallback(() => Boolean(user && hasEntryDraft(user.id, patient)), [user, patient]);
    return useSyncExternalStore(subscribeToDrafts, read, absent);
}

export function useEntryLocalDraft(patient: string, value: EntryLocalDraft, restore: (value: EntryLocalDraft) => void) {
    const { user } = useSecurity();
    const [state, setState] = useState<'loading' | 'ready' | 'recovered' | 'failed'>('loading');
    const restoreRef = useRef(restore);
    useEffect(() => { restoreRef.current = restore; }, [restore]);
    const [savedValue, setSavedValue] = useState<EntryLocalDraft>();
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
        void owner.save(value).then(() => {
            window.dispatchEvent(new Event(draftChanged));
            if (current === revision.current) { setSavedValue(value); setError(''); }
        })
            .catch(() => { if (current === revision.current) setError('Bozza automatica non conservata. Mantieni aperta questa schermata e registra il resoconto.'); });
    }, [owner, value, state]);
    const preserveAttempt = async (entryAttempt: string) => {
        if (!owner || state === 'failed' || state === 'loading') return;
        try {
            await owner.save({ ...value, entryAttempt });
            window.dispatchEvent(new Event(draftChanged));
        } catch {
            setError('Bozza automatica non conservata. Mantieni aperta questa schermata e verifica il diario.');
        }
    };
    const clear = async () => {
        if (owner) {
            await owner.discard();
            window.dispatchEvent(new Event(draftChanged));
        }
    };
    const hasDraft = entryDraftToPersist(value) !== null;
    return { state, saved: hasDraft && savedValue === value && !error, error, clear, hasDraft, preserveAttempt };
}
