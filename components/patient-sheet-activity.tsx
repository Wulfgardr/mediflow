'use client';

import type { Attachment, ClinicalEntry, Observation, Therapy } from '@/lib/db';
import { diaryContactsAfter, diaryTypeLabel, outOfRangeAfter } from '@/lib/patient-sheet-activity';
import { projectTherapyRecordUpdates, type projectVisitReference, recordDate } from '@/lib/patient-therapy-changes';
import { useState } from 'react';
import PrivacyBlur from './privacy-blur';
import { InkSectionHeading } from './ui/ink-state';
import styles from './twin-synoptic-sheet.module.css';

type TherapyUpdate = ReturnType<typeof projectTherapyRecordUpdates>[number];

export function SheetDate({ date }: { date: Date }) {
    return <time dateTime={date.toISOString()}>{date.toLocaleDateString('it-IT')}</time>;
}

function TherapyDetails({ update, entries, openDiary }: {
    update: TherapyUpdate;
    entries: readonly ClinicalEntry[];
    openDiary: (entryId: string) => void;
}) {
    const { therapy, date, label } = update;
    const start = recordDate(therapy.startDate);
    const end = recordDate(therapy.endDate);
    const sameDay = entries.filter(entry => !entry.deletedAt && recordDate(entry.createdAt)?.toDateString() === date.toDateString());
    return <details className={styles.changeDetails}>
        <summary><strong><PrivacyBlur>{therapy.drugName}</PrivacyBlur></strong><span>{label}</span></summary>
        <p>Stato attuale: {therapy.status === 'active' ? 'Attiva' : therapy.status === 'suspended' ? 'Sospesa' : 'Conclusa'} · <PrivacyBlur>{therapy.dosage}</PrivacyBlur></p>
        {therapy.motivation ? <p>Indicazione: <PrivacyBlur>{therapy.motivation}</PrivacyBlur></p> : null}
        <p>{start ? <>Inizio <SheetDate date={start} /> · </> : null}{end ? <>Fine <SheetDate date={end} /> · </> : null}Data della scheda <SheetDate date={date} /></p>
        <p>Valore precedente non conservato.</p>
        {sameDay.map(entry => <button key={entry.id} type="button" className="mf-button-text" onClick={() => openDiary(entry.id)}>
            Diario del <SheetDate date={date} /> · {diaryTypeLabel(entry.type)}
        </button>)}
    </details>;
}

export function PatientSheetActivity({ patientId, reference, now, entries, therapies, measures, attachments, proposalDate, unavailable, openDiary, openDocument }: {
    patientId: string;
    reference?: ReturnType<typeof projectVisitReference>;
    now: Date;
    entries?: ClinicalEntry[];
    therapies?: Therapy[];
    measures?: Observation[];
    attachments?: Attachment[];
    proposalDate?: Date | null;
    unavailable: boolean;
    openDiary: (entryId: string) => void;
    openDocument: (attachmentId: string) => void;
}) {
    const [showDocuments, setShowDocuments] = useState(false);
    const visit = reference?.latest;
    const patientEntries = (entries ?? []).filter(entry => entry.patientId === patientId);
    const detail = (row: TherapyUpdate) => <TherapyDetails update={row} entries={patientEntries} openDiary={openDiary} />;
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
    const rows = [
        ...changed.map(row => ({ id: `therapy:${row.therapy.id}`, date: row.date, content: detail(row) })),
        ...results.map(row => ({
            id: `measure:${row.id}`, date: row.date,
            content: <details className={styles.changeDetails}>
                <summary><strong><PrivacyBlur>{row.display} · {row.value}</PrivacyBlur></strong><span className={styles.outOfRange}>▲ Fuori intervallo</span></summary>
                <p>{row.previous ? <><PrivacyBlur>{row.previous.value}</PrivacyBlur> (<SheetDate date={row.previous.date} />) → </> : null}<PrivacyBlur>{row.value}</PrivacyBlur> · Misura del <SheetDate date={row.observed} /></p>
                <p>Riferimento {row.low !== null ? `da ${row.low.toLocaleString('it-IT')}` : ''}{row.high !== null ? ` fino a ${row.high.toLocaleString('it-IT')}` : ''}</p>
                {!row.previous ? <p>Nessuna misura precedente.</p> : null}
            </details>,
        })),
        ...(showDocuments ? docs.map(({ file, date }) => ({ id: `document:${file.id}`, date,
            content: <button type="button" onClick={() => openDocument(file.id)} className="mf-button-text">Documento aggiunto · <PrivacyBlur>{file.name}</PrivacyBlur></button> })) : []),
        ...(showDocuments && datedProposal ? [{ id: 'proposal', date: datedProposal, content: <a href="#patient-insight" className="mf-button-text">Proposta del Quadro paziente</a> }] : []),
    ].sort((left, right) => right.date.getTime() - left.date.getTime());
    const partial = unavailable || reference?.undated || (visit && (
        patientEntries.some(entry => !entry.deletedAt && !recordDate(entry.createdAt))
        || (therapies ?? []).some(therapy => therapy.patientId === patientId && !therapy.deletedAt
            && !recordDate(therapy.status === 'active' && (therapy.version ?? 1) <= 1 ? therapy.createdAt : therapy.updatedAt))
    ));
    const hasActivity = rows.length > 0 || contacts.length > 0 || mayShowDocuments;
    const heading = visit ? <>Dall&apos;ultima visita · <SheetDate date={visit.date} />{visit.author ? <> · <PrivacyBlur>{visit.author}</PrivacyBlur></> : null}</> : null;

    return <>
        {visit && hasActivity ? <section aria-label="Variazioni dall’ultima visita" className={styles.comparison}>
            <h2>{heading}</h2>
            {partial ? <p className={styles.readState} role="status">Confronto incompleto. Alcuni dati non sono disponibili.</p> : null}
            <ul className={styles.changeList}>{rows.map((row, index) => <li key={row.id}>
                {index === 0 || row.date.toDateString() !== rows[index - 1].date.toDateString() ? <span className={styles.changeDay}><SheetDate date={row.date} /></span> : null}
                {row.content}
            </li>)}</ul>
            {contacts.length ? <a href="#diario" className="mf-button-text">Nel diario dopo la visita: {contacts.join(', ')}</a> : null}
            {mayShowDocuments ? <label className={styles.activityToggle}><input type="checkbox" checked={showDocuments} onChange={event => setShowDocuments(event.target.checked)} />Mostra anche documenti e proposte</label> : null}
        </section> : <p className={styles.noComparison} role="status">{partial ? 'Confronto incompleto. Alcuni dati non sono disponibili.'
            : !reference ? 'Lettura del diario…'
                : visit ? <>{heading}: nessuna variazione registrata.</> : 'Nessuna visita registrata.'}</p>}
        {changed.length === 0 && recent.length > 0 ? <section aria-label="Ultime modifiche di terapia">
            <InkSectionHeading>Ultime modifiche di terapia</InkSectionHeading>
            <ul className={styles.changeList}>{recent.slice(0, 4).map(row => <li key={row.therapy.id}>
                <span className={styles.changeDay}><SheetDate date={row.date} /></span>{detail(row)}
            </li>)}</ul>
        </section> : null}
    </>;
}
