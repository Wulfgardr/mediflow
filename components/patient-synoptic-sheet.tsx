'use client';

import type { ReactNode } from 'react';
import type { Checkup, Diagnosis, Observation, Therapy } from '@/lib/db';
import { formatCountLabel } from '@/lib/format-count';
import { projectQuadroMeasures } from '@/lib/patient-quadro';
import type { projectTherapyDatesSinceVisit } from '@/lib/patient-therapy-changes';
import PrivacyBlur from './privacy-blur';
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
    diary?: ReactNode;
    composer?: ReactNode;
    sources?: ReactNode;
    comparison?: ReturnType<typeof projectTherapyDatesSinceVisit>;
    comparisonUnavailable?: boolean;
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

export function PatientSynopticSheet({ clinicalSupport, notesContent, problems, therapies, measures, checkups, diary, composer, sources, comparison, comparisonUnavailable }: PatientSynopticSheetProps) {
    const measureRows = projectQuadroMeasures(measures.data ?? []);
    const stable = <>
        <Section name="Problemi" read={problems} count={formatCountLabel(problems.data?.length ?? 0, 'problema', 'problemi')} empty="Nessun problema registrato.">
            <table className={`${register.table} ${reading.problems}`} aria-label="Problemi">
                <thead><tr><th scope="col">Codice</th><th scope="col">Descrizione</th><th scope="col" className={`${register.secondaryColumn} ${reading.secondaryColumn}`}>Da quando</th></tr></thead>
                <tbody>{problems.data?.map((problem, index) => <tr key={`${problem.system}-${problem.code}-${index}`}>
                    <td className="lume-code">{problem.code}</td><td><PrivacyBlur>{problem.description}</PrivacyBlur>{diary && problem.date ? <small><DateCell date={problem.date} /></small> : null}</td><td className={`${register.secondaryColumn} ${reading.secondaryColumn}`}><DateCell date={problem.date} /></td>
                </tr>)}</tbody>
            </table>
        </Section>
        <Section name="Terapie attive" read={therapies} count={formatCountLabel(therapies.data?.length ?? 0, 'attiva', 'attive')} empty="Nessuna terapia attiva.">
            <table className={`${register.table} ${reading.therapies}`} aria-label="Terapie attive">
                <thead><tr><th scope="col">Nome e dose</th><th scope="col">Posologia</th><th scope="col" className={`${register.secondaryColumn} ${reading.secondaryColumn}`}>ATC</th></tr></thead>
                <tbody>{therapies.data?.map(therapy => <tr key={therapy.id}>
                    <td><PrivacyBlur>{therapy.drugName}</PrivacyBlur>{diary && therapy.atc ? <small className="lume-code">{therapy.atc}</small> : null}</td><td><PrivacyBlur>{therapy.dosage}</PrivacyBlur></td><td className={`${register.secondaryColumn} ${reading.secondaryColumn} lume-code`}>{therapy.atc}</td>
                </tr>)}</tbody>
            </table>
        </Section>
    </>;
    const context = <>
        {clinicalSupport}
        {sources}
        <Section name="Parametri recenti" read={{ ...measures, data: measures.data === undefined ? undefined : measureRows }} count={formatCountLabel(measureRows.length, 'parametro', 'parametri')} empty="Nessuna misura registrata.">
            <table className={`${register.table} ${reading.measures}`} aria-label="Parametri recenti">
                <thead><tr><th scope="col">Nome</th><th scope="col" className={reading.value}>Valore</th><th scope="col">Data</th><th scope="col" className={`${register.secondaryColumn} ${reading.secondaryColumn}`}>Variazione</th></tr></thead>
                <tbody>{measureRows.map(measure => <tr key={measure.id}>
                    <td>{measure.display}</td><td className={`${reading.value} ${measure.outOfRange ? register.critical : ''}`}>{measure.valueLabel}{measure.outOfRange ? ` · ${measure.outOfRange}` : ''}{diary && measure.delta ? <small>{measure.delta}</small> : null}</td>
                    <td><DateCell date={measure.date} /></td><td className={`${register.secondaryColumn} ${reading.secondaryColumn}`}>{measure.delta}</td>
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
    </>;
    return <section id="quadro" aria-label="Riepilogo clinico" className={`${register.register} ${reading.sheet}`} data-overview={diary ? 'true' : undefined} data-writing={composer ? 'true' : undefined}>
        {diary ? <>
            <div className={reading.stable}>{stable}</div>
            <div className={reading.middle}>
                {comparison === undefined ? null : <TherapyComparison comparison={comparison} unavailable={comparisonUnavailable} showLinks={!composer} />}
                {diary}
            </div>
            <aside aria-label={composer ? 'Scrittura e fonti' : 'Contesto della cartella'} className={reading.context}>
                {composer ?? context}
            </aside>
        </> : <>{stable}{context}</>}
    </section>;
}

function TherapyComparison({ comparison, unavailable, showLinks }: {
    comparison: ReturnType<typeof projectTherapyDatesSinceVisit>;
    unavailable?: boolean;
    showLinks: boolean;
}) {
    if (!comparison) return <p className={reading.noComparison}>
        {unavailable ? 'Confronto con la visita precedente non disponibile.' : 'Nessuna visita precedente disponibile per il confronto.'}
    </p>;

    const renderRows = (changes: typeof comparison.changes) => <ul className={reading.changeList}>{changes.map(change =>
        <li key={`${change.therapyId}:${change.kind}`}>
            <DateCell date={change.date} />
            <strong><PrivacyBlur>{change.drugName}</PrivacyBlur></strong>
            <span>{change.kind === 'start' ? 'Inizio' : 'Conclusione'}</span>
        </li>
    )}</ul>;

    return <section aria-label="Variazioni di terapia" className={reading.comparison}>
        <h2>Variazioni di terapia</h2>
        <p className={reading.readState}>Dopo la visita del <DateCell date={comparison.visitDate} /></p>
        {comparison.changes.length ? renderRows(comparison.changes.slice(0, 2)) : <p className={reading.readState}>Nessun inizio o conclusione con data successiva.</p>}
        <details className={reading.changeDetails}>
            <summary>{comparison.changes.length > 2 ? 'Altre variazioni e fonti' : 'Fonti del confronto'}</summary>
            {comparison.changes.length > 2 ? renderRows(comparison.changes.slice(2)) : null}
            <p>Il confronto usa le date di inizio e conclusione riportate nelle schede terapia. Lo storico di sospensioni e posologie non è disponibile qui.</p>
            {showLinks ? <div>
                <a href="#terapie" className="mf-button-text">Apri Terapie</a>
                <a href="#diario" className="mf-button-text">Apri il diario</a>
            </div> : null}
        </details>
    </section>;
}
