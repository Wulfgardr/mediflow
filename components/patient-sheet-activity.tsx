'use client';

import type { Attachment, ClinicalEntry, Observation, Therapy } from '@/lib/db';
import { diaryContactsAfter, diaryTypeLabel, outOfRangeAfter } from '@/lib/patient-sheet-activity';
import { projectTherapyRecordUpdates, type projectVisitReference, recordDate } from '@/lib/patient-therapy-changes';
import { useState, type ReactNode } from 'react';
import { ChevronDown, History } from 'lucide-react';
import PrivacyBlur from './privacy-blur';
import { InkSectionHeading } from './ui/ink-state';
import styles from './twin-synoptic-sheet.module.css';

type TherapyUpdate = ReturnType<typeof projectTherapyRecordUpdates>[number];
type VisitReference = ReturnType<typeof projectVisitReference>;

export function SheetDate({ date }: { date: Date }) {
    return <time dateTime={date.toISOString()}>{date.toLocaleDateString('it-IT')}</time>;
}

function DayLabel({ date, now }: { date: Date; now: Date }) {
    const options: Intl.DateTimeFormatOptions = date.getFullYear() === now.getFullYear()
        ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' };
    return <time dateTime={date.toISOString()}>{date.toLocaleDateString('it-IT', options)}</time>;
}

export function therapyChangesSinceVisit(patientId: string, therapies: readonly Therapy[] | undefined, reference: VisitReference | undefined, now: Date) {
    const visit = reference?.latest;
    if (!visit || !therapies) return undefined;
    return new Map(projectTherapyRecordUpdates(patientId, therapies, now)
        .filter(row => row.date > visit.date && row.therapy.status === 'active')
        .map(row => [row.therapy.id, row.label]));
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
    return <div className={styles.fact}><dt>{label}<span className={styles.visuallyHidden}>: </span></dt><dd>{children}</dd></div>;
}

function ChangeRow({ name, detail, status, tone, children }: {
    name: ReactNode;
    detail?: ReactNode;
    status?: string;
    tone?: 'change' | 'critical';
    children: ReactNode;
}) {
    return <details className={styles.changeDetails}>
        <summary>
            <span className={styles.changeName}><strong>{name}</strong>{detail ? <span>{detail}</span> : null}</span>
            {status ? <span className={tone === 'critical' ? styles.chipCritical : styles.chipChange}>{status}</span> : null}
            <ChevronDown aria-hidden="true" size={14} />
        </summary>
        <dl className={styles.changeFacts}>{children}</dl>
    </details>;
}

function TherapyDetails({ update, entries, openDiary, grouped }: {
    update: TherapyUpdate;
    entries: readonly ClinicalEntry[];
    openDiary: (entryId: string) => void;
    grouped?: boolean;
}) {
    const { therapy, date, label } = update;
    const start = recordDate(therapy.startDate);
    const end = recordDate(therapy.endDate);
    const sameDay = entries.filter(entry => !entry.deletedAt && recordDate(entry.createdAt)?.toDateString() === date.toDateString());
    return <ChangeRow name={<PrivacyBlur>{therapy.drugName}</PrivacyBlur>} status={grouped ? undefined : label}>
        <Fact label="Stato attuale">{therapy.status === 'active' ? 'Attiva' : therapy.status === 'suspended' ? 'Sospesa' : 'Conclusa'} · <PrivacyBlur>{therapy.dosage}</PrivacyBlur></Fact>
        <Fact label="Prima">Valore precedente non conservato.</Fact>
        {therapy.motivation ? <Fact label="Indicazione"><PrivacyBlur>{therapy.motivation}</PrivacyBlur></Fact> : null}
        <Fact label="Date">{start ? <>Inizio <SheetDate date={start} /> · </> : null}{end ? <>Fine <SheetDate date={end} /> · </> : null}Data della scheda <SheetDate date={date} /></Fact>
        {sameDay.length ? <Fact label="Fonte">{sameDay.map(entry => <button key={entry.id} type="button" className={styles.sourceLink} onClick={() => openDiary(entry.id)}>
            Diario del <SheetDate date={date} /> · {diaryTypeLabel(entry.type)}
        </button>)}</Fact> : null}
    </ChangeRow>;
}

type ActivityRow = { id: string; date: Date; status: string; tone: 'change' | 'critical' | 'neutral'; content: (grouped: boolean) => ReactNode };

function groupActivity(rows: ActivityRow[]) {
    const days = new Map<string, { date: Date; statuses: Map<string, ActivityRow[]> }>();
    for (const row of rows) {
        const dayKey = row.date.toDateString();
        const day = days.get(dayKey) ?? { date: row.date, statuses: new Map<string, ActivityRow[]>() };
        days.set(dayKey, day);
        const group = day.statuses.get(row.status) ?? [];
        group.push(row);
        day.statuses.set(row.status, group);
    }
    return days;
}

const statusWords: Record<string, string> = {
    Avviata: 'Avviate', Aggiornata: 'Aggiornate', Sospesa: 'Sospese', Conclusa: 'Concluse',
};

const outOfRange = 'Fuori intervallo';

export function PatientSheetActivity({ patientId, reference, now, entries, therapies, measures, attachments, proposalDate, unavailable, loading, openDiary, openDocument, showFullDiary }: {
    patientId: string;
    reference?: VisitReference;
    now: Date;
    entries?: ClinicalEntry[];
    therapies?: Therapy[];
    measures?: Observation[];
    attachments?: Attachment[];
    proposalDate?: Date | null;
    unavailable: boolean;
    loading: boolean;
    openDiary: (entryId: string) => void;
    openDocument: (attachmentId: string) => void;
    showFullDiary?: () => void;
}) {
    const [showDocuments, setShowDocuments] = useState(false);
    const visit = reference?.latest;
    const patientEntries = (entries ?? []).filter(entry => entry.patientId === patientId);
    const detail = (row: TherapyUpdate, grouped = false) => <TherapyDetails update={row} entries={patientEntries} openDiary={openDiary} grouped={grouped} />;
    const recent = projectTherapyRecordUpdates(patientId, therapies ?? [], now);
    const changed = visit ? recent.filter(row => row.date > visit.date) : [];
    const results = visit ? outOfRangeAfter((measures ?? []).filter(item => item.patientId === patientId), visit.date, now) : [];
    const contacts = visit ? diaryContactsAfter(patientEntries, visit.date) : [];
    const docs = visit ? (attachments ?? []).flatMap(file => {
        const date = recordDate(file.createdAt);
        return file.patientId === patientId && date && date > visit.date && date <= now ? [{ file, date }] : [];
    }) : [];
    const proposed = recordDate(proposalDate);
    const datedProposal = visit && proposed && proposed > visit.date && proposed <= now ? proposed : null;
    const mayShowDocuments = docs.length > 0 || datedProposal !== null;
    const rows: ActivityRow[] = [
        ...changed.map(row => ({ id: `therapy:${row.therapy.id}`, date: row.date, status: row.label, tone: 'change' as const, content: (grouped: boolean) => detail(row, grouped) })),
        ...results.map(row => ({
            id: `measure:${row.id}`, date: row.date, status: outOfRange, tone: 'critical' as const,
            content: (grouped: boolean) => <ChangeRow name={<PrivacyBlur>{row.display}</PrivacyBlur>} detail={<PrivacyBlur>{row.value}</PrivacyBlur>} status={grouped ? undefined : outOfRange} tone="critical">
                <Fact label="Prima">{row.previous ? <><PrivacyBlur>{row.previous.value}</PrivacyBlur> (<SheetDate date={row.previous.date} />)</> : 'Nessuna misura precedente nella stessa unità.'}</Fact>
                <Fact label="Ora"><PrivacyBlur>{row.value}</PrivacyBlur> · Misura del <SheetDate date={row.observed} /></Fact>
                <Fact label="Riferimento">{[row.low !== null ? `da ${row.low.toLocaleString('it-IT')}` : null, row.high !== null ? `fino a ${row.high.toLocaleString('it-IT')}` : null].filter(Boolean).join(' ')}</Fact>
            </ChangeRow>,
        })),
        ...(showDocuments ? docs.map(({ file, date }) => ({ id: `document:${file.id}`, date, status: 'Documenti', tone: 'neutral' as const,
            content: () => <button type="button" onClick={() => openDocument(file.id)} className={styles.sourceLink}>Documento aggiunto · <PrivacyBlur>{file.name}</PrivacyBlur></button> })) : []),
        ...(showDocuments && datedProposal ? [{ id: 'proposal', date: datedProposal, status: 'Proposte', tone: 'neutral' as const,
            content: () => <a href="#patient-insight" className={styles.sourceLink}>Proposta del Quadro paziente</a> }] : []),
    ].sort((left, right) => right.date.getTime() - left.date.getTime());
    const partial = unavailable || reference?.undated || (visit && (
        patientEntries.some(entry => !entry.deletedAt && !recordDate(entry.createdAt))
        || (therapies ?? []).some(therapy => therapy.patientId === patientId && !therapy.deletedAt
            && !recordDate(therapy.status === 'active' && (therapy.version ?? 1) <= 1 ? therapy.createdAt : therapy.updatedAt))
    ));
    const hasActivity = rows.length > 0 || contacts.length > 0 || mayShowDocuments;
    const heading = visit ? <>Dall&apos;ultima visita · <SheetDate date={visit.date} />{visit.author ? <> · <PrivacyBlur>{visit.author}</PrivacyBlur></> : null}</> : null;
    const therapyCount = changed.length;

    return <>
        {visit && hasActivity ? <section aria-label="Variazioni dall’ultima visita" className={styles.comparison}>
            <header className={styles.islandHeader}>
                <span className={styles.islandIcon}><History size={16} aria-hidden="true" /></span>
                <h2>Dall&apos;ultima visita</h2>
                <span className={styles.visitDate}><SheetDate date={visit.date} />{visit.author ? <> · <PrivacyBlur>{visit.author}</PrivacyBlur></> : null}</span>
            </header>
            {therapyCount || results.length || contacts.length ? <p className={styles.chips}>
                {therapyCount ? <span className={styles.chipChange}>{therapyCount} {therapyCount === 1 ? 'terapia' : 'terapie'}</span> : null}
                {results.length ? <span className={styles.chipCritical}>{results.length} {results.length === 1 ? 'valore fuori intervallo' : 'valori fuori intervallo'}</span> : null}
                {contacts.length ? <a href="#diario" className={styles.chipNeutral} onClick={showFullDiary ? event => {
                    event.preventDefault();
                    showFullDiary();
                } : undefined}>{contacts.join(' · ')}</a> : null}
            </p> : null}
            {partial ? <p className={styles.readState} role="status">Confronto incompleto. Alcuni dati non sono disponibili.</p> : null}
            <ul className={styles.changeList}>{Array.from(groupActivity(rows), ([key, day]) => <li key={key} className={styles.changeDateGroup}>
                <span className={styles.changeDay}><DayLabel date={day.date} now={now} /></span>
                {Array.from(day.statuses, ([status, items]) => {
                    const grouped = items.length > 1;
                    return <div key={status} className={styles.changeGroup} data-grouped={grouped ? 'true' : undefined}>
                        <ul className={styles.changeItems}>{items.map(row => <li key={row.id} data-change-item>{row.content(grouped)}</li>)}</ul>
                        {grouped || items[0].tone === 'neutral' ? <span className={items[0].tone === 'critical' ? styles.chipCritical : items[0].tone === 'neutral' ? styles.chipNeutralStatic : styles.chipChange}>
                            {grouped && statusWords[status] ? statusWords[status] : status}
                        </span> : null}
                    </div>;
                })}
            </li>)}</ul>
            {mayShowDocuments ? <label className={styles.activityToggle}><input type="checkbox" checked={showDocuments} onChange={event => setShowDocuments(event.target.checked)} />Mostra anche documenti e proposte</label> : null}
        </section> : <p className={styles.noComparison} role="status">{partial ? 'Confronto incompleto. Alcuni dati non sono disponibili.'
            : loading || !reference ? 'Lettura della cartella…'
                : visit ? <>{heading}: nessuna variazione registrata.</> : 'Nessuna visita registrata.'}</p>}
        {changed.length === 0 && recent.length > 0 ? <section aria-label="Ultime modifiche di terapia" className={styles.recentTherapies}>
            <InkSectionHeading>Ultime modifiche di terapia</InkSectionHeading>
            <ul className={styles.changeList}>{recent.slice(0, 4).map(row => <li key={row.therapy.id} className={styles.changeDateGroup}>
                <span className={styles.changeDay}><DayLabel date={row.date} now={now} /></span>{detail(row)}
            </li>)}</ul>
        </section> : null}
    </>;
}
