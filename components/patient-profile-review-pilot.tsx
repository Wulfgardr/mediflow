'use client';

import { useEffect, useRef, useState } from 'react';
import { useSecurity } from './security-provider';
import { Button } from './ui/button';
import { db } from '@/lib/db';
import { createPatientProfileScopedBrowserAdapter } from '@/lib/patient-profile-scoped-browser-adapter';
import { isProfileReviewView, PROFILE_REVIEW_POLICY, type ProfileReviewInput,
    type ProfileReviewView } from '@/lib/patient-profile-review-contract';
import { isProfileNotesCommitReceipt, isProfileNotesCommitReference, isProfileNotesCommitView, PROFILE_NOTES_COMMIT_POLICY,
    type ProfileNotesCommitInput, type ProfileNotesCommitView, type ProfileNotesCommitReceipt } from '@/lib/patient-profile-notes-commit-contract';

type Mode = 'review-only' | 'commit';
type Prepared = ProfileReviewView | ProfileNotesCommitView;
type Expected = Readonly<{ reference: string; digest: string }>;
type Draft = Readonly<{ notes: string | null; revision: number; epoch: number }>;
type Value = Readonly<{ kind: 'loading' }> | Readonly<{ kind: 'editing'; draft: Draft; expired?: true; denied?: true }>
    | Readonly<{ kind: 'pending' }> | Readonly<{ kind: 'review'; view: Prepared; notes: string | null; recipient: string | null }>
    | Readonly<{ kind: 'complete'; receipt?: ProfileNotesCommitReceipt; notes?: string | null; revision?: number }>
    | Readonly<{ kind: 'recover'; expected: Expected }>
    | Readonly<{ kind: 'unavailable'; message: string }>;
type ScopedValue = Readonly<{ patientId: string; userId: string | undefined; signal: AbortSignal; mode: Mode; value: Value }>;
const unavailable: Value = { kind: 'unavailable', message: 'Revisione non più valida. Riapri le note e verifica il contesto corrente.' };
const lockedSignal = AbortSignal.abort();

class ReviewRequestError extends Error {
    constructor(readonly status: number, readonly body: unknown) { super('Revisione non disponibile.'); }
}

async function requestReview(endpoint: string, input: ProfileReviewInput | ProfileNotesCommitInput, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin',
        cache: 'no-store', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    signal.throwIfAborted();
    const value: unknown = await response.json(); signal.throwIfAborted();
    if (!response.ok) throw new ReviewRequestError(response.status, value);
    return value;
}

function pendingReceipt(): Expected | null {
    const url = new URL(window.location.href);
    const expected = { reference: url.searchParams.get('notesOperation'), digest: url.searchParams.get('notesDigest') };
    return isProfileNotesCommitReference(expected) ? expected : null;
}
function rememberReceipt(expected: Expected | null): void {
    const url = new URL(window.location.href);
    if (expected) { url.searchParams.set('notesOperation', expected.reference); url.searchParams.set('notesDigest', expected.digest); }
    else { url.searchParams.delete('notesOperation'); url.searchParams.delete('notesDigest'); }
    window.history.replaceState(window.history.state, '', url);
}

/** Both policies display the retained ENC command; only the named commit route may save. */
export function PatientProfileNotesReview({ patientId, mode }: Readonly<{ patientId: string; mode: Mode }>) {
    const { isLocked, isAuthenticated, user } = useSecurity();
    const sessionSignal = db.getSessionReadSignal();
    const signal = sessionSignal.aborted ? lockedSignal : sessionSignal;
    const [client] = useState(() => createPatientProfileScopedBrowserAdapter());
    const endpoint = mode === 'commit' ? `/api/patients/${encodeURIComponent(patientId)}/notes-commit` : '/api/patient-profile/review';
    const [scoped, setScoped] = useState<ScopedValue>({ patientId, userId: user?.id, signal, mode, value: { kind: 'loading' } });
    const [pin, setPin] = useState('');
    const [attempt, setAttempt] = useState(0);
    const generation = useRef(0);
    const pending = useRef<AbortController | null>(null);
    const activeReview = useRef<Prepared | null>(null);
    const current = !isLocked && isAuthenticated && !signal.aborted
        && scoped.patientId === patientId && scoped.userId === user?.id && scoped.signal === signal && scoped.mode === mode;
    const value: Value = current ? scoped.value : unavailable;
    const setValue = (next: Value) => setScoped({ patientId, userId: user?.id, signal, mode, value: next });
    const retire = () => {
        generation.current++; pending.current?.abort(); pending.current = null; setPin('');
        const review = activeReview.current; activeReview.current = null;
        if (review && !signal.aborted) void requestReview(endpoint, { kind: 'cancel', reference: review.reference }, signal).catch(() => undefined);
    };
    useEffect(() => {
        let alive = true;
        const token = ++generation.current;
        const controller = new AbortController(); pending.current = controller;
        const readSignal = AbortSignal.any([signal, controller.signal]);
        const set = (value: Value) => { if (alive && token === generation.current) setScoped({ patientId, userId: user?.id, signal, mode, value }); };
        const locked = () => { generation.current++; activeReview.current = null; setPin(''); setScoped({ patientId, userId: user?.id, signal, mode, value: unavailable }); };
        signal.addEventListener('abort', locked, { once: true });
        set({ kind: 'loading' });
        const recovery = mode === 'commit' ? pendingReceipt() : null;
        if (!isLocked && isAuthenticated && !signal.aborted && recovery) set({ kind: 'recover', expected: recovery });
        else if (!isLocked && isAuthenticated && !signal.aborted) void client.open(patientId, 'notes', readSignal).then(async result => {
            const notes = await db.decryptPatientProfileReviewNotes(result.profile.notes);
            readSignal.throwIfAborted();
            if (Date.now() >= result.currentness.expiresAt) throw new Error('Lettura scaduta.');
            set({ kind: 'editing', draft: { notes, revision: result.currentness.revision, epoch: result.currentness.selectionEpoch } });
        }).catch(() => set(unavailable));
        return () => {
            alive = false; generation.current += 1; controller.abort(); pending.current?.abort(); client.reset();
            signal.removeEventListener('abort', locked);
            const review = activeReview.current; activeReview.current = null;
            if (review && !signal.aborted) void requestReview(endpoint, { kind: 'cancel', reference: review.reference }, signal).catch(() => undefined);
        };
    }, [patientId, user?.id, signal, isLocked, isAuthenticated, client, attempt, mode, endpoint]);
    useEffect(() => {
        if (value.kind !== 'review') return;
        const token = generation.current;
        const review = value.view;
        const timer = setTimeout(() => {
            if (signal.aborted || token !== generation.current || activeReview.current !== review) return;
            generation.current++; pending.current?.abort(); pending.current = null; activeReview.current = null; setPin('');
            void requestReview(endpoint, { kind: 'cancel', reference: review.reference }, signal).catch(() => undefined);
            setScoped({ patientId, userId: user?.id, signal, mode, value: mode === 'commit'
                ? { kind: 'editing', expired: true, draft: { notes: value.notes, revision: review.expectedRevision, epoch: review.selectionEpoch } }
                : unavailable });
        }, Math.max(0, review.expiresAt - Date.now()));
        return () => clearTimeout(timer);
    }, [value, patientId, user?.id, signal, mode, endpoint]);

    async function prepare(draft: Draft) {
        if (!current || value.kind !== 'editing') return;
        retire(); const token = generation.current; const controller = new AbortController(); pending.current = controller;
        const operationSignal = AbortSignal.any([signal, controller.signal]); setValue({ kind: 'pending' });
        try {
            const notesToReview = draft.notes === null ? null : (await db.patients.prepareWritePayload({ notes: draft.notes }, true)).notes;
            if (notesToReview === undefined) throw new Error('Note mancanti.');
            operationSignal.throwIfAborted();
            const response = await requestReview(endpoint, { kind: 'prepare', expectedRevision: draft.revision,
                expectedSelectionEpoch: draft.epoch, notes: notesToReview }, operationSignal);
            operationSignal.throwIfAborted();
            if (token !== generation.current) throw new Error('Revisione superata.');
            const valid = mode === 'commit' ? isProfileNotesCommitView(response) : isProfileReviewView(response);
            if (!valid) throw new Error('Revisione inattesa.');
            const view = response as Prepared;
            if (view.expectedRevision !== draft.revision
                || view.selectionEpoch !== draft.epoch || ('recipient' in view && view.recipient.id !== patientId)) throw new Error('Revisione inattesa.');
            activeReview.current = view;
            const notes = await db.decryptPatientProfileReviewNotes(view.notes);
            const recipient = 'recipient' in view ? await db.decryptPatientProfileReviewRecipient(view.recipient) : null;
            operationSignal.throwIfAborted();
            if (token !== generation.current || Date.now() >= view.expiresAt) throw new Error('Revisione scaduta.');
            setValue({ kind: 'review', view, notes, recipient });
        } catch { if (token === generation.current) { retire(); setValue(unavailable); } }
    }
    async function saved(response: unknown, expected: Expected, token: number, operationSignal: AbortSignal) {
        if (!isProfileNotesCommitReceipt(response) || response.reference !== expected.reference || response.digest !== expected.digest) throw new Error('Esito inatteso.');
        operationSignal.throwIfAborted(); if (token !== generation.current) return;
        rememberReceipt(null); setValue({ kind: 'complete', receipt: response });
        try {
            const result = await client.open(patientId, 'notes', operationSignal);
            const notes = await db.decryptPatientProfileReviewNotes(result.profile.notes);
            operationSignal.throwIfAborted();
            if (result.currentness.revision < response.revision || Date.now() >= result.currentness.expiresAt) throw new Error('Rilettura non corrente.');
            if (token === generation.current) setValue({ kind: 'complete', receipt: response, notes, revision: result.currentness.revision });
        } catch { /* The validated commit remains known even when the subsequent read is unavailable. */ }
    }
    async function recover(expected: Expected) {
        if (!current || value.kind !== 'recover') return;
        setValue({ kind: 'pending' }); const token = ++generation.current;
        const controller = new AbortController(); pending.current = controller;
        const operationSignal = AbortSignal.any([signal, controller.signal]);
        try {
            const response = await requestReview(endpoint, { kind: 'receipt', ...expected }, operationSignal);
            if (isProfileNotesCommitReceipt(response)) await saved(response, expected, token, operationSignal);
            else {
                if (!response || typeof response !== 'object' || Object.keys(response).length !== 4 || !('kind' in response)
                    || response.kind !== 'not_committed' || !('policy' in response) || response.policy !== PROFILE_NOTES_COMMIT_POLICY
                    || !isProfileNotesCommitReference(response) || response.reference !== expected.reference || response.digest !== expected.digest) throw new Error('Esito inatteso.');
                if (token === generation.current) { rememberReceipt(null); setValue({ kind: 'unavailable', message: 'Nessuna modifica salvata. Riapri le note per preparare una nuova revisione.' }); }
            }
        } catch { if (token === generation.current) setValue({ kind: 'recover', expected }); }
    }
    async function confirm(view: Prepared) {
        if (!current || value.kind !== 'review' || activeReview.current !== view || Date.now() >= view.expiresAt) return;
        activeReview.current = null;
        const candidatePin = pin; setPin(''); setValue({ kind: 'pending' });
        const token = generation.current;
        const operationSignal = AbortSignal.any([signal, pending.current?.signal ?? AbortSignal.abort()]);
        try {
            if (mode === 'commit') rememberReceipt(view);
            const response = await requestReview(endpoint, { kind: 'confirm', reference: view.reference, digest: view.digest, candidatePin }, operationSignal);
            if (mode === 'commit') { await saved(response, view, token, operationSignal); return; }
            if (!response || typeof response !== 'object' || Object.keys(response).length !== 3 || !('kind' in response) || response.kind !== 'reviewed'
                || !('policy' in response) || response.policy !== PROFILE_REVIEW_POLICY
                || !('writesPerformed' in response) || response.writesPerformed !== 0) throw new Error('Esito inatteso.');
            if (token === generation.current) { activeReview.current = null; setValue({ kind: 'complete' }); }
        } catch (error) { if (token === generation.current) {
            if (mode === 'commit' && error instanceof ReviewRequestError && error.status === 403
                && error.body && typeof error.body === 'object' && !Array.isArray(error.body) && Object.keys(error.body).length === 2
                && 'code' in error.body && error.body.code === 'review_denied' && 'error' in error.body && typeof error.body.error === 'string') {
                // This response retires the review before any effect. Other failures may hide a commit.
                rememberReceipt(null);
                setValue({ kind: 'editing', denied: true,
                    draft: { notes: value.notes, revision: view.expectedRevision, epoch: view.selectionEpoch } });
            } else if (mode === 'commit') setValue({ kind: 'recover', expected: { reference: view.reference, digest: view.digest } });
            else { retire(); setValue(unavailable); }
        } }
    }

    return <section className="mx-auto max-w-3xl space-y-5 p-6" data-testid={mode === 'commit' ? 'patient-profile-notes-review' : 'patient-profile-review-pilot'}>
        <h1 className="type-page-title">{mode === 'commit' ? 'Rivedi e salva le note' : 'Prova di revisione delle note'}</h1>
        <p>{mode === 'commit' ? 'Prepara le note, verifica il paziente e leggi il contenuto completo prima di salvare nella cartella.'
            : 'Il contenuto viene preparato e mostrato per la conferma. Questa prova non salva modifiche nella cartella.'}</p>
        {value.kind === 'loading' || value.kind === 'pending' ? <p role="status">Verifica in corso…</p> : null}
        {value.kind === 'unavailable' ? <p role="alert">{value.message}</p> : null}
        {value.kind === 'recover' ? <>
            <p role="alert">L’esito non è ancora verificato. Controlla il salvataggio prima di preparare altre modifiche.</p>
            <Button onClick={() => void recover(value.expected)}>Verifica il salvataggio</Button>
        </> : null}
        {value.kind === 'complete' ? <>
            <p role="status">{value.receipt ? 'Note salvate.' : 'Revisione completata. Nessuna modifica salvata.'}</p>
            {value.receipt && value.notes === undefined ? <p>Il salvataggio è registrato. Riapri le note per leggere lo stato corrente.</p> : null}
            {value.receipt && value.notes !== undefined ? <>
                <h2 className="text-lg font-semibold">Note correnti in cartella</h2>
                {value.revision && value.revision > value.receipt.revision ? <p>La cartella è stata aggiornata dopo questo salvataggio.</p> : null}
                <div className="whitespace-pre-wrap break-words rounded border p-4" data-testid="saved-current-notes">{value.notes === null ? 'Nessuna nota registrata.' : value.notes === '' ? 'Nota vuota.' : value.notes}</div>
            </> : null}
        </> : null}
        {value.kind === 'editing' ? <>
            {value.expired ? <p role="status">La revisione è scaduta. La bozza è conservata: preparala di nuovo e verifica il contenuto.</p> : null}
            {value.denied ? <p role="alert">Revisione non ammessa. Nessuna modifica salvata. La bozza è conservata: verifica la sessione e il PIN, poi prepara una nuova revisione.</p> : null}
            <label className="block">Note da proporre
                <textarea className="mf-input mt-2 min-h-48 w-full" value={value.draft.notes ?? ''}
                    onChange={event => setValue({ kind: 'editing', draft: { ...value.draft, notes: event.target.value } })} />
            </label>
            <label className="flex gap-2"><input type="checkbox" checked={value.draft.notes === null}
                onChange={event => setValue({ kind: 'editing', draft: { ...value.draft, notes: event.target.checked ? null : '' } })} />Rimuovi le note</label>
            <Button onClick={() => void prepare(value.draft)}>Prepara la revisione</Button>
        </> : null}
        {value.kind === 'review' ? <>
            {value.recipient ? <p data-testid="review-recipient"><strong>Paziente:</strong> {value.recipient}</p> : null}
            {mode === 'commit' ? <p>{value.view.notes === null ? 'Le note del paziente verranno rimosse.' : 'Le note del paziente verranno sostituite con questo contenuto.'}</p> : null}
            <h2 className="text-lg font-semibold">Contenuto da confermare</h2>
            <div className="whitespace-pre-wrap break-words rounded border p-4" data-testid="review-canonical-notes">
                {value.notes === null ? 'Rimozione delle note.' : value.notes === '' ? 'Sostituzione con una nota vuota.' : value.notes}
            </div>
            <p>{mode === 'commit' ? 'Verifica il paziente e il contenuto completo. Per salvare, inserisci nuovamente il tuo PIN.'
                : 'Leggi il contenuto completo. Per confermare questa prova, inserisci nuovamente il tuo PIN.'}</p>
            <label className="block">PIN di conferma<input className="mf-input mt-2" type="password" inputMode="numeric"
                autoComplete="off" value={pin} onChange={event => setPin(event.target.value)} /></label>
            <div className="flex flex-wrap gap-3">
                <Button disabled={!pin} onClick={() => void confirm(value.view)}>{mode === 'commit' ? 'Conferma e salva le note' : 'Conferma la prova senza salvare'}</Button>
                <Button variant="secondary" onClick={() => { retire(); setValue(unavailable); }}>Annulla la revisione</Button>
            </div>
        </> : null}
        {(value.kind === 'unavailable' || value.kind === 'complete') && !isLocked && isAuthenticated
            ? <Button variant="secondary" onClick={() => { retire(); setAttempt(value => value + 1); }}>Riapri le note</Button> : null}
        <a className="block underline" href={`/patients/${encodeURIComponent(patientId)}/modules`}>Torna alla cartella</a>
    </section>;
}

export function PatientProfileReviewPilot({ patientId }: Readonly<{ patientId: string }>) {
    return <PatientProfileNotesReview patientId={patientId} mode="review-only" />;
}
