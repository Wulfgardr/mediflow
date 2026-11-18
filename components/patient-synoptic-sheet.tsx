'use client';

import type { ReactNode } from 'react';
import type { Checkup, Diagnosis, Observation, Therapy } from '@/lib/db';
import { formatCountLabel } from '@/lib/format-count';
import { projectQuadroMeasures } from '@/lib/patient-quadro';
import { projectLastRecordedTherapyChanges, THERAPY_CHANGE_LABELS } from '@/lib/patient-therapy-changes';
import { InkSectionHeading } from '@/components/ui/ink-state';
import register from './clinical-register.module.css';
import reading from './twin-synoptic-sheet.module.css';

interface QuadroRead<T> {
    data?: T[];
    loading: boolean;
    error: unknown;
}

export interface PatientSynopticSheetProps {
    clinicalSupport?: ReactNode;
    notesContent?: ReactNode;
    problems: QuadroRead<Diagnosis>;
    therapies: QuadroRead<Therapy>;
    therapyRecords?: QuadroRead<Therapy>;
    zones?: boolean;
    measures: QuadroRead<Observation>;
    checkups: QuadroRead<Checkup>;
}

function Section<T>({ name, read, count, empty, children }: {
    name: string;
    read: QuadroRead<T>;
    count: string;
    empty: string;
    children: ReactNode;
}) {
    const failed = read.error !== null && read.error !== undefined;
    return <section aria-label={name}>
        <InkSectionHeading count={!read.loading && !failed && read.data !== undefined ? count : undefined}>{name}</InkSectionHeading>
        {failed ? <p className={register.empty} role="alert">Impossibile leggere {name.toLocaleLowerCase('it-IT')}.</p>
            : read.loading || read.data === undefined ? <p className={register.empty} role="status">Lettura {name.toLocaleLowerCase('it-IT')} in corso…</p>
                : read.data.length === 0 ? <p className={register.empty}>{empty}</p> : children}
    </section>;
}

function DateCell({ date }: { date?: Date }) {
    if (!date || !Number.isFinite(new Date(date).getTime())) return null;
    return <time dateTime={new Date(date).toISOString()}>{new Date(date).toLocaleDateString('it-IT')}</time>;
}

function formatDay(date?: Date | null): string | null {
    if (!date || !Number.isFinite(new Date(date).getTime())) return null;
    return new Date(date).toLocaleDateString('it-IT');
}

function PatientSheetZones({ clinicalSupport, notesContent, problems, therapies, therapyRecords, measures, checkups }: PatientSynopticSheetProps) {
    const measureRows = projectQuadroMeasures(measures.data ?? []);
    const therapyChanges = projectLastRecordedTherapyChanges(therapyRecords?.data ?? [], 4);
    return <section id="quadro" aria-label="Riepilogo clinico" className={`${register.register} ${reading.zones}`}>
        <div className={reading.zone} data-zone="facts">
            <Section name="Problemi" read={problems} count={formatCountLabel(problems.data?.length ?? 0, 'problema', 'problemi')} empty="Nessun problema registrato.">
                <table className={reading.rows} aria-label="Problemi">
                    <thead className="sr-only"><tr><th scope="col">Problema</th></tr></thead>
                    <tbody>{problems.data?.map((problem, index) => <tr key={`${problem.system}-${problem.code}-${index}`}>
                        <td><span>{problem.description}</span><small><span className="lume-code">{problem.code}</span>{formatDay(problem.date) ? <> · dal <DateCell date={problem.date} /></> : null}</small></td>
                    </tr>)}</tbody>
                </table>
            </Section>
            {notesContent ? <div className={reading.notes}>{notesContent}</div> : null}
        </div>
        <div className={reading.zone} data-zone="care">
            {clinicalSupport}
            {therapyRecords ? <Section name="Variazioni di terapia" read={{ ...therapyRecords, data: therapyRecords.data === undefined ? undefined : therapyChanges }} count={formatCountLabel(therapyChanges.length, 'ultima', 'ultime')} empty="Nessuna variazione di terapia registrata.">
                <table className={reading.rows} aria-label="Variazioni di terapia">
                    <thead className="sr-only"><tr><th scope="col">Farmaco ed evento</th></tr></thead>
                    <tbody>{therapyChanges.map(change => <tr key={change.id}>
                        <td><span>{change.drugName}</span><small>{THERAPY_CHANGE_LABELS[change.kind]} il <DateCell date={change.date} /></small></td>
                    </tr>)}</tbody>
                </table>
            </Section> : null}
            <Section name="Terapie attive" read={therapies} count={formatCountLabel(therapies.data?.length ?? 0, 'attiva', 'attive')} empty="Nessuna terapia attiva.">
                <table className={reading.rows} aria-label="Terapie attive">
                    <thead className="sr-only"><tr><th scope="col">Farmaco e posologia</th></tr></thead>
                    <tbody>{therapies.data?.map(therapy => <tr key={therapy.id}>
                        <td><span>{therapy.drugName}</span><small>{therapy.dosage}</small></td>
                    </tr>)}</tbody>
                </table>
            </Section>
            <Section name="Parametri recenti" read={{ ...measures, data: measures.data === undefined ? undefined : measureRows }} count={formatCountLabel(measureRows.length, 'parametro', 'parametri')} empty="Nessuna misura registrata.">
                <table className={reading.rows} aria-label="Parametri recenti">
                    <thead className="sr-only"><tr><th scope="col">Parametro</th><th scope="col">Valore</th></tr></thead>
                    <tbody>{measureRows.map(measure => <tr key={measure.id}>
                        <td><span>{measure.display}</span><small><DateCell date={measure.date} />{measure.delta ? ` · ${measure.delta}` : ''}</small></td>
                        <td className={`${reading.value} ${measure.outOfRange ? register.critical : ''}`}>{measure.valueLabel}{measure.outOfRange ? ` · ${measure.outOfRange}` : ''}</td>
                    </tr>)}</tbody>
                </table>
            </Section>
            <Section name="Controlli aperti" read={checkups} count={formatCountLabel(checkups.data?.length ?? 0, 'aperto', 'aperti')} empty="Nessun controllo aperto.">
                <table className={reading.rows} aria-label="Controlli aperti">
                    <thead className="sr-only"><tr><th scope="col">Controllo</th><th scope="col">Scadenza</th></tr></thead>
                    <tbody>{checkups.data?.map(checkup => <tr key={checkup.id}><td>{checkup.title}</td><td className={reading.value}><DateCell date={checkup.date} /></td></tr>)}</tbody>
                </table>
            </Section>
        </div>
    </section>;
}

export function PatientSynopticSheet(props: PatientSynopticSheetProps) {
    if (props.zones) return <PatientSheetZones {...props} />;
    const { clinicalSupport, notesContent, problems, therapies, measures, checkups } = props;
    const measureRows = projectQuadroMeasures(measures.data ?? []);
    return <section id="quadro" aria-label="Riepilogo clinico" className={`${register.register} ${reading.sheet}`}>
        {clinicalSupport}
        <Section name="Problemi" read={problems} count={formatCountLabel(problems.data?.length ?? 0, 'problema', 'problemi')} empty="Nessun problema registrato.">
            <table className={`${register.table} ${reading.problems}`} aria-label="Problemi">
                <thead><tr><th scope="col">Codice</th><th scope="col">Descrizione</th><th scope="col" className={register.secondaryColumn}>Da quando</th></tr></thead>
                <tbody>{problems.data?.map((problem, index) => <tr key={`${problem.system}-${problem.code}-${index}`}>
                    <td className="lume-code">{problem.code}</td><td>{problem.description}</td><td className={register.secondaryColumn}><DateCell date={problem.date} /></td>
                </tr>)}</tbody>
            </table>
        </Section>
        <Section name="Terapie attive" read={therapies} count={formatCountLabel(therapies.data?.length ?? 0, 'attiva', 'attive')} empty="Nessuna terapia attiva.">
            <table className={`${register.table} ${reading.therapies}`} aria-label="Terapie attive">
                <thead><tr><th scope="col">Nome e dose</th><th scope="col">Posologia</th><th scope="col" className={register.secondaryColumn}>ATC</th></tr></thead>
                <tbody>{therapies.data?.map(therapy => <tr key={therapy.id}>
                    <td>{therapy.drugName}</td><td>{therapy.dosage}</td><td className={`${register.secondaryColumn} lume-code`}>{therapy.atc}</td>
                </tr>)}</tbody>
            </table>
        </Section>
        <Section name="Parametri recenti" read={{ ...measures, data: measures.data === undefined ? undefined : measureRows }} count={formatCountLabel(measureRows.length, 'parametro', 'parametri')} empty="Nessuna misura registrata.">
            <table className={`${register.table} ${reading.measures}`} aria-label="Parametri recenti">
                <thead><tr><th scope="col">Nome</th><th scope="col" className={reading.value}>Valore</th><th scope="col">Data</th><th scope="col" className={register.secondaryColumn}>Variazione</th></tr></thead>
                <tbody>{measureRows.map(measure => <tr key={measure.id}>
                    <td>{measure.display}</td><td className={`${reading.value} ${measure.outOfRange ? register.critical : ''}`}>{measure.valueLabel}{measure.outOfRange ? ` · ${measure.outOfRange}` : ''}</td>
                    <td><DateCell date={measure.date} /></td><td className={register.secondaryColumn}>{measure.delta}</td>
                </tr>)}</tbody>
            </table>
        </Section>
        <Section name="Controlli aperti" read={checkups} count={formatCountLabel(checkups.data?.length ?? 0, 'aperto', 'aperti')} empty="Nessun controllo aperto.">
            <table className={register.table} aria-label="Controlli aperti">
                <thead><tr><th scope="col">Nome</th><th scope="col">Scadenza</th></tr></thead>
                <tbody>{checkups.data?.map(checkup => <tr key={checkup.id}><td>{checkup.title}</td><td><DateCell date={checkup.date} /></td></tr>)}</tbody>
            </table>
        </Section>
        {notesContent ? <div className={reading.notes}>{notesContent}</div> : null}
    </section>;
}
