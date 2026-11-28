'use client';

import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import PrivacyBlur from '@/components/privacy-blur';
import surface from '@/components/record-surface.module.css';
import { db, type Patient } from '@/lib/db';
import { useLiveQueryState } from '@/lib/live-query';
import { daySessionCandidates, readDaySession, type DaySessionDecision, type DaySessionEntry } from '@/lib/day-session';
import { daySessionStorageKey, openDaySession, recordDaySessionDecision, replaceDaySession, updateDaySession, type DaySessionScope } from '@/lib/day-session-storage';
import css from './day-session.module.css';

const changed = 'mediflow:day-session-changed';
const serverSnapshot = () => null;
function subscribe(notify: () => void) {
    window.addEventListener('storage', notify);
    window.addEventListener(changed, notify);
    return () => { window.removeEventListener('storage', notify); window.removeEventListener(changed, notify); };
}

const date = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeZone: 'UTC' });
const time = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
const dayLabel = (day: string) => date.format(new Date(`${day}T00:00:00Z`));
const patientName = (patient: Patient) => `${patient.firstName} ${patient.lastName}`;
const readPatients = () => db.patients.toArray({ signal: db.getSessionReadSignal(), rejectAuthUnavailable: true });

function Time({ at }: { at: number | null }) {
    if (at === null) return <span>Ora assente</span>;
    const instant = new Date(at * 1000);
    return <time dateTime={instant.toISOString()}>{time.format(instant)}</time>;
}

function Dictation({ text }: { text: string }) {
    return <details><summary>Leggi il dettato</summary><p className={css.transcript}><PrivacyBlur>{text}</PrivacyBlur></p></details>;
}

function DaySessionTray({ entries, patients, busy, decide }: {
    entries: DaySessionEntry[]; patients: Patient[] | undefined; busy: boolean;
    decide: (entry: DaySessionEntry, decision: DaySessionDecision) => void;
}) {
    return <section className={surface.tray} aria-labelledby="day-session-tray">
        <h2 id="day-session-tray">Da collegare</h2>
        {entries.length === 0 ? <p>Nessun tratto da collegare.</p> : <ol className={css.list}>
            {entries.map(entry => {
                const candidates = patients ? daySessionCandidates(entry, patients) : [];
                const priority = candidates.length > 1 && candidates[0].score > candidates[1].score;
                return <li key={entry.id}>
                    <article className={surface.island} aria-label={entry.source}>
                        <h3>{entry.source} · <Time at={entry.at} /></h3>
                        {entry.text && <Dictation text={entry.text} />}
                        {patients && candidates.length === 0 && <p>Nessuna scheda suggerita.</p>}
                        {candidates.length > 0 && <>
                            <p>{candidates.length === 1 ? 'Scheda suggerita' : priority ? 'Più schede compatibili. Verifica prima di collegare.' : 'Più schede compatibili con la stessa priorità.'}</p>
                            <ol className={css.list}>
                                {candidates.map(({ patient, reasons }, index) => <li key={patient.id} className={css.candidate}>
                                    <div id={`${entry.id}-candidate-${index}`}><PrivacyBlur><strong>{patientName(patient)}</strong>{patient.birthDate && <> · {date.format(patient.birthDate)}</>}
                                        {patient.taxCode && <> · {patient.taxCode}</>}</PrivacyBlur><div>{priority && index === 0 && <strong>Prima proposta · </strong>}{reasons.join(' · ')}</div></div>
                                    <Button variant="secondary" disabled={busy} aria-label={`Collega a ${patientName(patient)}`} aria-describedby={`${entry.id}-candidate-${index}`}
                                        onClick={() => decide(entry, { kind: 'linked', patientId: patient.id })}>Collega</Button>
                                </li>)}
                            </ol>
                        </>}
                        <div className={css.actions}><Button variant="text" disabled={busy} onClick={() => decide(entry, { kind: 'discarded' })}>Scarta tratto</Button></div>
                    </article>
                </li>;
            })}
        </ol>}
    </section>;
}

function DayTimeline({ entries, patients }: { entries: DaySessionEntry[]; patients: Patient[] }) {
    const timeline = entries.flatMap(entry => [
        { key: entry.id, at: entry.at, entry, document: null },
        ...entry.documents.map((document, index) => ({ key: `${entry.id}/pdf/${index}`, at: document.at, entry, document })),
    ]).sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.key.localeCompare(b.key));
    return <section className={surface.tray} aria-labelledby="day-session-timeline">
        <h2 id="day-session-timeline">Cronologia</h2>
        <ol className={css.list}>
            {timeline.map(({ key, at, entry, document }) => {
                const linked = entry.decision?.kind === 'linked' ? entry.decision.patientId : null;
                const patient = linked ? patients.find(patient => patient.id === linked && !patient.isArchived && !patient.deletedAt) : undefined;
                return <li className={`${surface.island} ${css.event}`} key={key}>
                    <Time at={at} />
                    <div><strong>{document ? document.receipt ? 'Promemoria ricetta' : 'PDF' : entry.type === 'third' ? 'Tratto di terzi' : entry.type === 'pending' ? 'Dettato' : 'Visita'}</strong>
                        <span> · {entry.source}</span>
                        {document ? <div><PrivacyBlur>{document.name}</PrivacyBlur>{!document.assigned && (document.nearby ? ' · PDF vicino' : ' · Da verificare')}</div> : <>
                            {entry.decision?.kind === 'discarded' && <div>Scartato</div>}
                            {linked && <div>{patient ? <>Collegato a <Link className={css.patientLink} href={`/patients/${patient.id}/modules`}><PrivacyBlur>{patientName(patient)}</PrivacyBlur></Link></> : 'Scheda collegata non disponibile'}</div>}
                            {!entry.decision && entry.type === 'pending' && <div>Da collegare</div>}
                            {entry.text && (entry.type === 'visit' || linked) && <Dictation text={entry.text} />}
                        </>}
                    </div>
                </li>;
            })}
        </ol>
    </section>;
}

export function DaySession({ scope }: { scope: DaySessionScope }) {
    const key = daySessionStorageKey(scope);
    const read = useCallback(() => window.localStorage.getItem(key), [key]);
    const encrypted = useSyncExternalStore(subscribe, read, serverSnapshot);
    const result = useLiveQueryState(async () => ({ encrypted, entries: await openDaySession(scope, encrypted, db) }), [encrypted, key], undefined, []);
    const patients = useLiveQueryState(readPatients, [], undefined, ['patients']);
    const [selectedDay, setSelectedDay] = useState('');
    const [busy, setBusy] = useState(false);
    const folderInput = useRef<HTMLInputElement>(null);
    const [feedback, setFeedback] = useState<{ error: boolean; message: string }>();
    const entries = result.data?.encrypted === encrypted ? result.data.entries : undefined;
    const days = [...new Set((entries ?? []).map(entry => entry.day))].sort().reverse();
    const day = days.includes(selectedDay) ? selectedDay : days[0];
    const timeline = (entries ?? []).filter(entry => entry.day === day);
    const pending = timeline.filter(entry => entry.type === 'pending' && !entry.decision).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

    const run = async (update: (entries: DaySessionEntry[]) => Promise<DaySessionEntry[]> | DaySessionEntry[], done: string, failure: string) => {
        setBusy(true);
        setFeedback(undefined);
        const signal = db.getSessionReadSignal();
        try {
            await updateDaySession(scope, db, localStorage, navigator.locks, signal, update);
            window.dispatchEvent(new Event(changed));
            if (!signal.aborted) { setFeedback({ error: false, message: done }); return true; }
        } catch {
            if (!signal.aborted) setFeedback({ error: true, message: failure });
        } finally {
            if (!signal.aborted) setBusy(false);
        }
        return false;
    };
    const importDay = async (files: File[]) => {
        let importedDay = '';
        const saved = await run(async entries => {
            const imported = await readDaySession(files);
            importedDay = imported[0].day;
            return replaceDaySession(entries, imported);
        }, 'Giornata importata.', 'Importazione non riuscita. Scegli una cartella ambulatorio-AAAAMMGG con i file della giornata.');
        if (saved) setSelectedDay(importedDay);
    };
    const decide = (entry: DaySessionEntry, decision: DaySessionDecision) => {
        void run(async entries => {
            if (decision.kind === 'linked' && !daySessionCandidates(entry, await readPatients()).some(({ patient }) => patient.id === decision.patientId)) {
                throw new Error('Day session candidate changed');
            }
            return recordDaySessionDecision(entries, entry, decision);
        }, decision.kind === 'linked' ? 'Tratto collegato nella seduta.' : 'Tratto scartato.', 'Decisione non salvata. Rileggi la seduta e riprova.');
    };

    return <div className={css.session}>
        <section className={surface.island} aria-labelledby="day-session-import">
            <h2 id="day-session-import">Importa una giornata dal kit</h2>
            <p>I collegamenti restano in questo browser. Per registrare dati clinici, apri la scheda.</p>
            <div className={css.actions}>
                <Button variant="secondary" disabled={busy || Boolean(result.error)} onClick={() => folderInput.current?.click()}>Scegli cartella</Button>
                <input hidden ref={folderInput} type="file" aria-label="Cartella della giornata" {...({ webkitdirectory: '' } as Record<string, string>)}
                    onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (files.length) void importDay(files); }} />
            </div>
            {days.length > 1 && <label className={css.control}>Giorno<select value={day} onChange={event => setSelectedDay(event.target.value)}>
                {days.map(value => <option key={value} value={value}>{dayLabel(value)}</option>)}
            </select></label>}
            {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
            {Boolean(result.error) && <p role="alert">La seduta conservata in questo browser non è leggibile.</p>}
            {Boolean(patients.error) && <p role="alert">Schede non disponibili. <Button variant="text" onClick={patients.refresh}>Riprova</Button></p>}
        </section>
        {day && <><h2>{dayLabel(day)}</h2>
            <div className={css.review}>
                <DaySessionTray entries={pending} patients={patients.error ? undefined : patients.data} busy={busy} decide={decide} />
                <DayTimeline entries={timeline} patients={patients.data ?? []} />
            </div>
        </>}
    </div>;
}
