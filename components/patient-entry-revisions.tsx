'use client';

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiConflictError, db, type ClinicalEntry } from '@/lib/db';
import { LEGACY_REVISION_MESSAGE } from '@/lib/diary-revision-envelope';
import { clinicalRichTextToPlainText } from '@/lib/clinical-rich-text';
import { isEncryptedFieldValue, isLockedDataPlaceholder } from '@/lib/locked-field-guard';
import { notifyDbChange, useLiveQueryState } from '@/lib/live-query';
import { ClinicalRichTextContent } from './clinical-rich-text-content';
import { ClinicalRichTextEditor } from './clinical-rich-text-editor';
import PrivacyBlur from './privacy-blur';
import { Button } from './ui/button';

const dateTime = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' });

function correction(date: string, author: string | null, historical: boolean) {
    return <>{historical ? 'Sostituita il' : 'Rettificata il'} <time dateTime={date}>{dateTime.format(new Date(date))}</time> · <PrivacyBlur>{author ?? 'Autore non disponibile'}</PrivacyBlur></>;
}

function History({ entry, version, current }: { entry: ClinicalEntry; version: number; current: ReactNode }) {
    const [cursors, setCursors] = useState([0]);
    const [selected, setSelected] = useState<number | null>(null);
    const cursor = cursors.at(-1) ?? 0;
    const { data, loading, error, refresh } = useLiveQueryState(
        () => db.readEntryRevisions(entry.patientId, entry.id, version, cursor),
        [entry.patientId, entry.id, version, cursor], undefined, ['entries'],
    );

    if (loading) return <>{current}<p role="status">Lettura dello storico…</p></>;
    if (error || !data) return <>{current}<p role="alert">Storico non disponibile. <Button type="button" variant="text" onClick={refresh}>Riprova</Button></p></>;

    const row = data.revisions.find(revision => revision.version === selected);
    const stamp = row ?? data.latestCorrection;
    const page = (next: number[]) => {
        setSelected(null);
        setCursors(next);
    };

    return <section aria-label="Versioni della nota" className="space-y-3">
        <p>{data.availableSince ? <>Storico dal <time dateTime={data.availableSince}>{dateTime.format(new Date(data.availableSince))}</time></>
            : 'Lo storico inizia con la prima rettifica registrata dalla versione 0.9.1.'}</p>
        {data.revisions.length ? <div className="flex flex-wrap gap-2" role="group" aria-label="Seleziona versione">
            {cursors.length > 1 ? <Button type="button" variant="text" onClick={() => page(cursors.slice(0, -1))}>Versioni meno recenti</Button> : null}
            {data.revisions.map(revision => <Button key={revision.version} type="button" variant="secondary"
                aria-pressed={row?.version === revision.version} onClick={() => setSelected(revision.version)}>Versione {revision.version}</Button>)}
            {data.hasMore ? <Button type="button" variant="text" onClick={() => page([...cursors, data.revisions.at(-1)!.version])}>Versioni più recenti</Button> : null}
            <Button type="button" variant="secondary" aria-pressed={!row} onClick={() => setSelected(null)}>Versione attuale {version}</Button>
        </div> : null}
        <div aria-live="polite" className="min-w-0">
            <p>{row ? `Versione ${row.version}` : `Versione attuale ${version}`}{stamp ? <> · {correction(stamp.correctedAt, stamp.correctedBy, Boolean(row))}</> : null}</p>
            {row ? <>
                {row.title !== null ? <h5><PrivacyBlur>{row.title}</PrivacyBlur></h5> : null}
                {row.content !== null ? <PrivacyBlur><ClinicalRichTextContent content={row.content} /></PrivacyBlur> : <p>Testo precedente non disponibile.</p>}
            </> : current}
        </div>
    </section>;
}

function CorrectionEditor({ entry, version, close }: { entry: ClinicalEntry; version: number; close: () => void }) {
    const initial = useRef({ title: entry.title, content: entry.content, version }).current;
    const [title, setTitle] = useState(initial.title);
    const [content, setContent] = useState(initial.content);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const submitting = useRef(false);
    const changed = title.trim() !== initial.title || content !== initial.content;
    const valid = title.trim().length > 0 && clinicalRichTextToPlainText(content).trim().length > 0;
    const stale = initial.version !== version;

    async function save(event: FormEvent) {
        event.preventDefault();
        if (submitting.current || stale || !valid || !changed) return;
        submitting.current = true;
        setPending(true);
        setError('');
        try {
            const signal = db.getSessionReadSignal();
            signal.throwIfAborted();
            await db.correctDiaryEntry(entry, {
                version: initial.version,
                ...(title.trim() !== initial.title ? { title: title.trim() } : {}),
                ...(content !== initial.content ? { content } : {}),
            }, signal);
            signal.throwIfAborted();
            close();
        } catch (error) {
            if (error instanceof ApiConflictError) notifyDbChange('entries');
            setError(error instanceof ApiConflictError ? 'La voce è cambiata. Chiudi la rettifica e riapri la versione attuale.'
                : error instanceof Error && error.message === LEGACY_REVISION_MESSAGE ? LEGACY_REVISION_MESSAGE
                    : 'Salvataggio non verificato. Riprova.');
        } finally {
            submitting.current = false;
            setPending(false);
        }
    }

    return <form aria-label="Rettifica voce" className="space-y-3" onSubmit={save}>
        <label className="block">Titolo<input className="mf-input block w-full" value={title} onChange={event => setTitle(event.target.value)} /></label>
        <ClinicalRichTextEditor label="Testo della rettifica" value={content} onChange={setContent} />
        {stale || error ? <p role="alert">{error || 'La voce è cambiata. Chiudi la rettifica e riapri la versione attuale.'}</p> : null}
        <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || stale || !changed || !valid}>Salva rettifica</Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={close}>Annulla</Button>
        </div>
    </form>;
}

export function PatientEntryRevisions({ entry, children }: { entry: ClinicalEntry; children: ReactNode }) {
    const [history, setHistory] = useState(false);
    const [editing, setEditing] = useState(false);
    const version = entry.version;
    if (!version) return children;
    const readable = [entry.title, entry.content].every(value => !isLockedDataPlaceholder(value) && !isEncryptedFieldValue(value));

    return <div className="space-y-3">
        {history ? <History key={version} entry={entry} version={version} current={children} /> : children}
        {!editing ? <div className="flex flex-wrap gap-2">
            {readable ? <Button type="button" variant="text" onClick={() => { setHistory(false); setEditing(true); }}>Rettifica</Button> : null}
            <Button type="button" variant="text" aria-expanded={history} onClick={() => setHistory(open => !open)}>Storico delle rettifiche</Button>
        </div> : null}
        {editing ? <CorrectionEditor entry={entry} version={version} close={() => setEditing(false)} /> : null}
    </div>;
}
