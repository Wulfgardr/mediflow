'use client';

import { useEffect, useState } from 'react';
import { useSecurity } from './security-provider';
import { db } from '@/lib/db';
import { createPatientProfileScopedBrowserAdapter, PatientProfileBrowserAdapterError } from '@/lib/patient-profile-scoped-browser-adapter';

type NotesState = Readonly<{ state: 'pending' }> | Readonly<{ state: 'available'; notes: string | null }>
    | Readonly<{ state: 'unavailable'; message: string }>;
function message(error: unknown): string {
    if (!(error instanceof PatientProfileBrowserAdapterError)) return 'Note non disponibili. Riapri la lettura per riprovare.';
    if (error.code === 'output_too_large') return 'Le note superano il limite di questa vista. Nessun contenuto è stato troncato e nessuna bozza è stata modificata.';
    if (error.code === 'session_unavailable') return 'Sblocca MediFlow per leggere le note.';
    if (error.code === 'scope_denied') return 'La sessione corrente non consente di leggere queste note.';
    if (error.code === 'selection_conflict' || error.code === 'operation_superseded') return 'La selezione è cambiata. Riapri le note del paziente che stai consultando.';
    return 'Lettura delle note non più valida. Riapri le note per ottenere un nuovo riferimento.';
}
export function PatientProfileNotesView({ value }: Readonly<{ value: NotesState }>) {
    return <>
        <h3>Note in cartella</h3>
        {value.state === 'pending' ? <p role="status">Lettura delle note in corso…</p>
            : value.state === 'unavailable' ? <p role="alert">{value.message}</p>
                : !value.notes?.trim() ? <p>Nessuna nota generale registrata.</p>
                    : <><p className="whitespace-pre-wrap">{value.notes.length > 320 ? `${value.notes.slice(0, 320).trimEnd()}…` : value.notes}</p>
                        {value.notes.length > 320 ? <details><summary>Leggi la nota completa</summary><p className="whitespace-pre-wrap">{value.notes}</p></details> : null}</>}
    </>;
}
export function PatientProfileNotes({ patientId }: Readonly<{ patientId: string }>) {
    const { isLocked, isAuthenticated, user } = useSecurity();
    const [client] = useState(() => createPatientProfileScopedBrowserAdapter());
    const [scoped, setScoped] = useState<{ patientId: string; userId: string | undefined;
        signal: AbortSignal | null; value: NotesState }>({ patientId: '', userId: undefined, signal: null, value: { state: 'pending' } });
    const signalAtRender = db.getSessionReadSignal();
    const value: NotesState = isLocked || !isAuthenticated || signalAtRender.aborted
        ? { state: 'unavailable', message: 'Sblocca MediFlow per leggere le note.' }
        : scoped.patientId === patientId && scoped.userId === user?.id && scoped.signal === signalAtRender
            ? scoped.value : { state: 'pending' };
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        client.reset();
        let current = true;
        let expiry: ReturnType<typeof setTimeout> | undefined;
        const signal = db.getSessionReadSignal();
        const setValue = (value: NotesState) => setScoped({ patientId, userId: user?.id, signal, value });
        const denied = () => { client.reset(); if (current) setValue({ state: 'unavailable', message: 'Sblocca MediFlow per leggere le note.' }); };
        signal.addEventListener('abort', denied, { once: true });
        if (!isLocked && isAuthenticated && !signal.aborted) void client.open(patientId, 'notes', signal).then(async result => {
            const notes = await db.decryptPatientProfileNotes(result.profile.notes);
            if (current && !signal.aborted) {
                const remaining = result.currentness.expiresAt - Date.now();
                if (remaining <= 0) { setValue({ state: 'unavailable', message: 'La lettura è scaduta. Riapri le note.' }); return; }
                setValue({ state: 'available', notes });
                expiry = setTimeout(() => { client.reset(); if (current) setValue({ state: 'unavailable', message: 'La lettura è scaduta. Riapri le note.' }); }, remaining);
            }
        }).catch(error => { if (current && !signal.aborted) setValue({ state: 'unavailable', message: message(error) }); });
        return () => { current = false; clearTimeout(expiry); signal.removeEventListener('abort', denied); client.reset(); };
    }, [patientId, user?.id, isLocked, isAuthenticated, client, attempt]);
    return <div data-testid="patient-profile-notes">
        <PatientProfileNotesView value={value} />
        {value.state === 'unavailable' && !isLocked ? <button type="button" className="mf-button-secondary mt-2" onClick={() => { setScoped(current => ({ ...current, value: { state: 'pending' } })); setAttempt(current => current + 1); }}>Riapri le note</button> : null}
    </div>;
}
