'use client';

import Link from 'next/link';
import { useCallback, useId } from 'react';
import { Mic, Pause, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import PrivacyBlur from '@/components/privacy-blur';
import { useLocalVoiceRecorder } from '@/lib/hooks/effects/use-local-voice-recorder';
import type { RecorderNotice, RecorderView } from '@/lib/local-voice/recorder';
import type { LocalVoiceMode } from '@/lib/local-voice/web-bridge';
import styles from './local-voice-recorder.module.css';

const NOTICES: Record<RecorderNotice, string> = {
    off: 'Il servizio della voce non è attivo su questo computer.',
    unsupported: 'La registrazione della visita per ora funziona solo sul Mac.',
    'model-missing': 'Manca il modello della voce su questo Mac.',
    'model-incomplete': 'Il modello della voce non è installato del tutto.',
    'model-invalid': 'Il modello della voce è danneggiato: va installato di nuovo.',
    'permission-denied': 'Il browser non ha il permesso di usare il microfono.',
    'no-microphone': 'Nessun microfono disponibile.',
    'audio-missing': 'Dal microfono non arriva audio. Controllalo e avvia di nuovo.',
    'audio-lost': 'L’audio si è interrotto. Il testo fin qui resta da rivedere.',
    'engine-failed': 'La trascrizione si è interrotta e il testo è perso.',
    draining: 'Trascrizione dell’audio ricevuto in corso. Riprova tra poco.',
    'stop-retry': 'Non è ancora possibile terminare. Riprova tra poco.',
    'subject-mismatch': 'La registrazione appartiene a un’altra scheda e non viene mostrata.',
    failed: 'Richiesta non riuscita. Riprova.',
};

const INDICATOR: Record<NonNullable<RecorderView['snapshot']>['visible'], string> = {
    ready: 'Pronta', recording: 'In registrazione', paused: 'In pausa', stopped: 'Ferma', error: 'Errore',
};

function clock(ms: number) {
    const seconds = Math.floor(ms / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function Indicator({ view }: { view: RecorderView }) {
    const visible = view.snapshot?.visible ?? (view.review ? 'stopped' : 'ready');
    const elapsed = view.snapshot && view.snapshot.elapsedMs > 0 ? clock(view.snapshot.elapsedMs) : null;
    return <p className={styles.indicator} data-visible={visible} data-testid="local-voice-indicator" role="status" aria-live="polite">
        <span className={styles.mark} aria-hidden="true" />
        <span>{INDICATOR[visible]}</span>
        {elapsed ? <span className={styles.clock}>{elapsed}</span> : null}
    </p>;
}

export type LocalVoiceTake = (text: string) => void | Promise<void>;

/** Recording surface for one subject: start, live text, attributed review, hand-off of the reviewed text. */
export function LocalVoiceRecorderPanel({ subject, vocabulary, modes, title, takeLabel, onTake }: {
    subject: string; vocabulary: readonly string[]; modes: readonly LocalVoiceMode[]; title: string; takeLabel: string; onTake: LocalVoiceTake;
}) {
    const ids = useId();
    const confirm = useConfirm();
    const [view, recorder] = useLocalVoiceRecorder(subject, 'recording');
    const focusStart = useCallback((button: HTMLButtonElement | null) => {
        if (button && window.location.hash === '#registrazione') button.focus();
    }, []);
    const allowed = new Set(view.snapshot?.allowed ?? []);
    const busy = view.pending !== null;
    const { foreign, review, snapshot } = view;

    const askDiscard = async (foreignSession = false) => {
        const { confirmed } = await confirm({ title: 'Scartare la registrazione?', message: 'Il testo trascritto si perde.',
            confirmLabel: 'Scarta', cancelLabel: 'Annulla', tone: 'danger' });
        if (!confirmed) return;
        if (foreignSession) await recorder.discardForeign();
        else await recorder.discard();
    };

    const take = async () => {
        const text = await recorder.take();
        if (text !== null) await onTake(text);
    };

    if (view.phase === 'checking') return null;

    return <section id="registrazione" className={styles.panel} aria-labelledby={`${ids}-title`} data-testid="local-voice-recorder" data-phase={view.phase}>
        <div className={styles.head}>
            <h2 id={`${ids}-title`}>{title}</h2>
            {view.phase === 'live' || view.phase === 'review' || view.phase === 'opening' ? <Indicator view={view} /> : null}
        </div>

        {view.notice ? <p className={styles.notice} role={view.phase === 'unavailable' || view.notice === 'draining' ? 'status' : 'alert'} data-testid="local-voice-notice">{NOTICES[view.notice]}</p> : null}
        {snapshot?.limitReached ? <p className={styles.notice} role="status">La registrazione ha raggiunto la durata massima e si è fermata.</p> : null}

        {view.phase === 'idle' || view.phase === 'opening' ? <div className={styles.actions}>
            {modes.includes('visit') ? <Button variant="secondary" ref={focusStart} disabled={busy} onClick={() => void recorder.start('visit', vocabulary)}>
                <Mic size={16} aria-hidden="true" />Ascolta la visita</Button> : null}
            {modes.includes('dictation') ? <Button variant="text" disabled={busy} onClick={() => void recorder.start('dictation', vocabulary)}>Detta</Button> : null}
        </div> : null}

        {view.phase === 'foreign' && foreign ? <div className={styles.actions} data-testid="local-voice-foreign">
            <p>{foreign.owner.kind === 'patient' ? 'C’è da rivedere la registrazione di un altro paziente.'
                : foreign.owner.kind === 'first-visit' ? 'C’è da rivedere la registrazione di una prima visita aperta altrove.'
                    : 'Un altro utente ha una registrazione da rivedere.'}</p>
            {foreign.owner.kind === 'patient'
                ? <Link className="mf-button-secondary" href={`/patients/${foreign.owner.patientId}/modules?voce=nuova#registrazione`}>Apri la sua scheda</Link>
                : foreign.owner.kind === 'first-visit' && foreign.session
                    ? <Button variant="text" disabled={busy} onClick={() => void askDiscard(true)}>Scarta quella registrazione</Button> : null}
        </div> : null}

        {view.phase === 'live' && snapshot ? <>
            <div className={styles.actions}>
                {allowed.has('pause') ? <Button variant="secondary" disabled={busy} onClick={() => void recorder.pause()}><Pause size={16} aria-hidden="true" />Pausa</Button> : null}
                {allowed.has('resume') ? <Button variant="secondary" disabled={busy} onClick={() => void recorder.resume()}><Play size={16} aria-hidden="true" />Riprendi</Button> : null}
                {allowed.has('stop') ? <Button variant="secondary" disabled={busy} onClick={() => void recorder.stop()}><Square size={14} aria-hidden="true" />Termina</Button> : null}
                {snapshot.state === 'error' && !['audio-lost', 'permission-denied'].includes(snapshot.fault ?? '')
                    ? <Button variant="secondary" disabled={busy} onClick={() => void recorder.discard()}>Nuova registrazione</Button> : null}
            </div>
            {snapshot.state === 'ready' || snapshot.state === 'preparing' ? <p className={styles.muted} role="status">Avvio della trascrizione…</p> : null}
            {view.pending === 'stop' || snapshot.state === 'finalizing' ? <p className={styles.muted} role="status">Chiusura della trascrizione…</p> : null}
            {snapshot.live && (snapshot.live.confirmed || snapshot.live.provisional) ? <PrivacyBlur>
                <p className={styles.live} data-testid="local-voice-live" aria-label="Trascrizione in corso">
                    {snapshot.live.confirmed}{snapshot.live.provisional ? <span className={styles.provisional}> {snapshot.live.provisional}</span> : null}
                </p>
            </PrivacyBlur> : null}
        </> : null}

        {view.phase === 'review' && review ? <div className={styles.review}>
            <label htmlFor={`${ids}-text`}>Testo da rivedere</label>
            <PrivacyBlur>
                <textarea id={`${ids}-text`} data-testid="local-voice-review" value={review.text} rows={Math.min(18, Math.max(6, review.text.split('\n').length + 1))}
                    onChange={(event) => recorder.edit(event.currentTarget.value)} />
            </PrivacyBlur>
            {review.suggestions.length ? <div className={styles.suggestions} aria-label="Farmaci del paziente">
                {review.suggestions.map((item, index) => <Button key={`${item.start}-${item.original}`} variant="text" onClick={() => recorder.suggest(index)}>
                    {item.original} → {item.replacement}</Button>)}
            </div> : null}
            <div className={styles.actions}>
                {review.mode === 'visit' ? <Button variant="text" disabled={busy} onClick={() => recorder.swap()}>Scambia medico e paziente</Button> : null}
                <Button variant="text" disabled={busy} onClick={() => void askDiscard()}>Scarta</Button>
                <Button variant="secondary" disabled={busy || !review.text.trim()} onClick={() => void take()} data-testid="local-voice-take">{takeLabel}</Button>
            </div>
        </div> : null}
    </section>;
}

/** The secondary header command of a patient sheet: shown only where recording can work. */
export function useLocalVoiceReady(subject: string) {
    const [view] = useLocalVoiceRecorder(subject, 'availability');
    return view.availability === 'ready';
}
