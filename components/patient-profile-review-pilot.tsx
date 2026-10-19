'use client';

import { useEffect, useRef, useState } from 'react';
import { useSecurity } from './security-provider';
import { db } from '@/lib/db';
import { createPatientProfileScopedBrowserAdapter } from '@/lib/patient-profile-scoped-browser-adapter';
import { isProfileReviewView, PROFILE_REVIEW_POLICY, type ProfileReviewInput,
    type ProfileReviewView } from '@/lib/patient-profile-review-contract';

type Draft = Readonly<{ notes: string | null; revision: number; epoch: number }>;
type Value = Readonly<{ kind: 'loading' }> | Readonly<{ kind: 'editing'; draft: Draft }>
    | Readonly<{ kind: 'pending' }> | Readonly<{ kind: 'review'; view: ProfileReviewView; notes: string | null }>
    | Readonly<{ kind: 'complete' }> | Readonly<{ kind: 'unavailable'; message: string }>;
type ScopedValue = Readonly<{ patientId: string; userId: string | undefined; signal: AbortSignal; value: Value }>;
const unavailable: Value = { kind: 'unavailable', message: 'Prova non più valida. Riapri le note e verifica il contesto corrente.' };
const lockedSignal = AbortSignal.abort();

async function requestReview(input: ProfileReviewInput, signal: AbortSignal): Promise<unknown> {
    const response = await fetch('/api/patient-profile/review', { method: 'POST', credentials: 'same-origin',
        cache: 'no-store', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    signal.throwIfAborted();
    if (!response.ok) throw new Error('Revisione non disponibile.');
    const value: unknown = await response.json(); signal.throwIfAborted(); return value;
}

/** Development-only composition of the real scoped host and ENC presentation. No save action. */
export function PatientProfileReviewPilot({ patientId }: Readonly<{ patientId: string }>) {
    const { isLocked, isAuthenticated, user } = useSecurity();
    const sessionSignal = db.getSessionReadSignal();
    const signal = sessionSignal.aborted ? lockedSignal : sessionSignal;
    const [client] = useState(() => createPatientProfileScopedBrowserAdapter());
    const [scoped, setScoped] = useState<ScopedValue>({ patientId, userId: user?.id, signal, value: { kind: 'loading' } });
    const [pin, setPin] = useState('');
    const [attempt, setAttempt] = useState(0);
    const generation = useRef(0);
    const pending = useRef<AbortController | null>(null);
    const activeReview = useRef<ProfileReviewView | null>(null);
    const current = !isLocked && isAuthenticated && !signal.aborted
        && scoped.patientId === patientId && scoped.userId === user?.id && scoped.signal === signal;
    const value: Value = current ? scoped.value : unavailable;
    const setValue = (next: Value) => setScoped({ patientId, userId: user?.id, signal, value: next });
    const retire = () => {
        generation.current++; pending.current?.abort(); pending.current = null; setPin('');
        const review = activeReview.current; activeReview.current = null;
        if (review && !signal.aborted) void requestReview({ kind: 'cancel', reference: review.reference }, signal).catch(() => undefined);
    };
    useEffect(() => {
        let alive = true;
        const token = ++generation.current;
        const controller = new AbortController(); pending.current = controller;
        const readSignal = AbortSignal.any([signal, controller.signal]);
        const set = (value: Value) => { if (alive && token === generation.current) setScoped({ patientId, userId: user?.id, signal, value }); };
        const locked = () => { generation.current++; activeReview.current = null; setPin(''); setScoped({ patientId, userId: user?.id, signal, value: unavailable }); };
        signal.addEventListener('abort', locked, { once: true });
        set({ kind: 'loading' });
        if (!isLocked && isAuthenticated && !signal.aborted) void client.open(patientId, 'notes', readSignal).then(async result => {
            const notes = await db.decryptPatientProfileReviewNotes(result.profile.notes);
            readSignal.throwIfAborted();
            if (Date.now() >= result.currentness.expiresAt) throw new Error('Lettura scaduta.');
            set({ kind: 'editing', draft: { notes, revision: result.currentness.revision, epoch: result.currentness.selectionEpoch } });
        }).catch(() => set(unavailable));
        return () => {
            alive = false; generation.current++; controller.abort(); pending.current?.abort(); client.reset();
            signal.removeEventListener('abort', locked);
            const review = activeReview.current; activeReview.current = null;
            if (review && !signal.aborted) void requestReview({ kind: 'cancel', reference: review.reference }, signal).catch(() => undefined);
        };
    }, [patientId, user?.id, signal, isLocked, isAuthenticated, client, attempt]);
    useEffect(() => {
        if (value.kind !== 'review') return;
        const timer = setTimeout(() => {
            generation.current++; pending.current?.abort(); activeReview.current = null; setPin('');
            setScoped({ patientId, userId: user?.id, signal, value: unavailable });
        }, Math.max(0, value.view.expiresAt - Date.now()));
        return () => clearTimeout(timer);
    }, [value, patientId, user?.id, signal]);

    async function prepare(draft: Draft) {
        if (!current || value.kind !== 'editing') return;
        retire(); const token = generation.current; const controller = new AbortController(); pending.current = controller;
        const operationSignal = AbortSignal.any([signal, controller.signal]); setValue({ kind: 'pending' });
        try {
            const notesToReview = draft.notes === null ? null : (await db.patients.prepareWritePayload({ notes: draft.notes }, true)).notes;
            if (notesToReview === undefined) throw new Error('Note mancanti.');
            operationSignal.throwIfAborted();
            const response = await requestReview({ kind: 'prepare', expectedRevision: draft.revision,
                expectedSelectionEpoch: draft.epoch, notes: notesToReview }, operationSignal);
            operationSignal.throwIfAborted();
            if (token !== generation.current) throw new Error('Revisione superata.');
            if (!isProfileReviewView(response) || response.expectedRevision !== draft.revision
                || response.selectionEpoch !== draft.epoch) throw new Error('Revisione inattesa.');
            activeReview.current = response;
            const notes = await db.decryptPatientProfileReviewNotes(response.notes);
            operationSignal.throwIfAborted();
            if (token !== generation.current || Date.now() >= response.expiresAt) throw new Error('Revisione scaduta.');
            setValue({ kind: 'review', view: response, notes });
        } catch { if (token === generation.current) { retire(); setValue(unavailable); } }
    }
    async function confirm(view: ProfileReviewView) {
        if (!current || value.kind !== 'review' || activeReview.current !== view || Date.now() >= view.expiresAt) return;
        activeReview.current = null;
        const candidatePin = pin; setPin(''); setValue({ kind: 'pending' });
        const token = generation.current;
        const operationSignal = AbortSignal.any([signal, pending.current?.signal ?? AbortSignal.abort()]);
        try {
            const response = await requestReview({ kind: 'confirm', reference: view.reference, digest: view.digest, candidatePin }, operationSignal);
            if (!response || typeof response !== 'object' || Object.keys(response).length !== 3 || !('kind' in response) || response.kind !== 'reviewed'
                || !('policy' in response) || response.policy !== PROFILE_REVIEW_POLICY
                || !('writesPerformed' in response) || response.writesPerformed !== 0) throw new Error('Esito inatteso.');
            if (token === generation.current) { activeReview.current = null; setValue({ kind: 'complete' }); }
        } catch { if (token === generation.current) { retire(); setValue(unavailable); } }
    }

    return <section className="mx-auto max-w-3xl space-y-5 p-6" data-testid="patient-profile-review-pilot">
        <h1 className="type-page-title">Prova di revisione delle note</h1>
        <p>Il contenuto viene preparato e mostrato per la conferma. Questa prova non salva modifiche nella cartella.</p>
        {value.kind === 'loading' || value.kind === 'pending' ? <p role="status">Verifica in corso…</p> : null}
        {value.kind === 'unavailable' ? <p role="alert">{value.message}</p> : null}
        {value.kind === 'complete' ? <p role="status">Revisione completata. Nessuna modifica salvata.</p> : null}
        {value.kind === 'editing' ? <>
            <label className="block">Note da proporre
                <textarea className="mf-input mt-2 min-h-48 w-full" value={value.draft.notes ?? ''}
                    onChange={event => setValue({ kind: 'editing', draft: { ...value.draft, notes: event.target.value } })} />
            </label>
            <label className="flex gap-2"><input type="checkbox" checked={value.draft.notes === null}
                onChange={event => setValue({ kind: 'editing', draft: { ...value.draft, notes: event.target.checked ? null : '' } })} />Rimuovi le note</label>
            <button type="button" className="mf-button-primary" onClick={() => void prepare(value.draft)}>Prepara la revisione</button>
        </> : null}
        {value.kind === 'review' ? <>
            <h2 className="text-lg font-semibold">Contenuto da confermare</h2>
            <div className="whitespace-pre-wrap break-words rounded border p-4" data-testid="review-canonical-notes">
                {value.notes === null ? 'Rimozione delle note.' : value.notes === '' ? 'Sostituzione con una nota vuota.' : value.notes}
            </div>
            <p>Leggi il contenuto completo. Per confermare questa prova, inserisci nuovamente il tuo PIN.</p>
            <label className="block">PIN di conferma<input className="mf-input ml-3" type="password" inputMode="numeric"
                autoComplete="off" value={pin} onChange={event => setPin(event.target.value)} /></label>
            <button type="button" className="mf-button-primary" disabled={!pin} onClick={() => void confirm(value.view)}>Conferma la prova senza salvare</button>
            <button type="button" className="mf-button-secondary ml-3" onClick={() => { retire(); setValue(unavailable); }}>Annulla la revisione</button>
        </> : null}
        {(value.kind === 'unavailable' || value.kind === 'complete') && !isLocked && isAuthenticated
            ? <button type="button" className="mf-button-secondary" onClick={() => { retire(); setAttempt(value => value + 1); }}>Riapri le note</button> : null}
        <a className="block underline" href={`/patients/${encodeURIComponent(patientId)}/modules`}>Torna alla cartella</a>
    </section>;
}
