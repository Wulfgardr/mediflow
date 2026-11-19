'use client';

import type { ReactNode, Ref } from 'react';
import { Activity, Heart, Pill, type LucideIcon } from 'lucide-react';
import type { Checkup, Diagnosis, Observation, Therapy } from '@/lib/db';
import { formatCountLabel } from '@/lib/format-count';
import { projectQuadroMeasures } from '@/lib/patient-quadro';
import PrivacyBlur from './privacy-blur';
import { DrugLabel } from './drug-label';
import { MeasureTrend, measureSeries } from './measure-trend';
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
    therapyChanges?: ReadonlyMap<string, string>;
    diary?: ReactNode;
    diaryTools?: { full: boolean; control: Ref<HTMLButtonElement>; show: () => void; resume: () => void };
    composer?: ReactNode;
    sources?: ReactNode;
    activity?: ReactNode;
    measures: QuadroRead<Observation>;
    checkups: QuadroRead<Checkup>;
}

function Section<T>({ name, read, count, empty, children, icon: Icon, action, id }: {
    name: string;
    read: QuadroRead<T>;
    count: string;
    empty: string;
    children: ReactNode;
    icon?: LucideIcon;
    action?: ReactNode;
    id?: string;
}) {
    const failed = read.error !== null && read.error !== undefined;
    return <section id={id} aria-label={name}>
        <header className={reading.islandHeader}>
            {Icon ? <span className={reading.islandIcon}><Icon size={16} aria-hidden="true" /></span> : null}
            <InkSectionHeading count={!read.loading && !failed && read.data !== undefined ? count : undefined}>{name}</InkSectionHeading>
            {action}
        </header>
        {failed ? <p className={register.empty} role="alert">Impossibile leggere {name.toLocaleLowerCase('it-IT')}.</p>
            : read.loading || read.data === undefined ? <p className={register.empty} role="status">Lettura {name.toLocaleLowerCase('it-IT')} in corso…</p>
                : read.data.length === 0 ? <p className={register.empty}>{empty}</p> : children}
    </section>;
}

function DateCell({ date }: { date?: Date }) {
    if (!date || !Number.isFinite(new Date(date).getTime())) return null;
    return <time dateTime={new Date(date).toISOString()}>{new Date(date).toLocaleDateString('it-IT')}</time>;
}

const rangeArrow = { alto: '↑', basso: '↓' } as const;

export function PatientSynopticSheet({ clinicalSupport, notesContent, problems, therapies, therapyChanges, measures, checkups, diary, diaryTools, composer, sources, activity }: PatientSynopticSheetProps) {
    const measureRows = projectQuadroMeasures(measures.data ?? []);
    const overview = Boolean(diary);
    const secondary = `${register.secondaryColumn} ${reading.secondaryColumn}`;
    const stable = <>
        <Section name="Problemi" id="riepilogo-problemi" icon={overview ? Heart : undefined} action={overview && !composer ? <a href="#clinica" className={reading.islandAction}>Clinica</a> : undefined} read={problems} count={formatCountLabel(problems.data?.length ?? 0, 'problema', 'problemi')} empty="Nessun problema registrato.">
            <table role="table" className={`${register.table} ${reading.problems}`} aria-label="Problemi">
                <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Descrizione</th><th role="columnheader" scope="col">Codice</th><th role="columnheader" scope="col" className={secondary}>Da quando</th></tr></thead>
                <tbody role="rowgroup">{problems.data?.map((problem, index) => <tr role="row" key={`${problem.system}-${problem.code}-${index}`}>
                    <td role="cell"><PrivacyBlur>{problem.description}</PrivacyBlur>{overview && problem.date ? <small>dal <DateCell date={problem.date} /></small> : null}</td>
                    <td role="cell" className={`lume-code ${reading.codeColumn}`}>{problem.code}</td>
                    <td role="cell" className={secondary}><DateCell date={problem.date} /></td>
                </tr>)}</tbody>
            </table>
        </Section>
        <Section name="Terapie attive" id="riepilogo-terapie" icon={overview ? Pill : undefined} action={overview && !composer ? <a href="#terapie" className={reading.islandAction}>Terapie</a> : undefined} read={therapies} count={formatCountLabel(therapies.data?.length ?? 0, 'attiva', 'attive')} empty="Nessuna terapia attiva.">
            <table role="table" className={`${register.table} ${reading.therapies}`} aria-label="Terapie attive">
                <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Nome e dose</th><th role="columnheader" scope="col">Posologia</th><th role="columnheader" scope="col" className={secondary}>ATC</th></tr></thead>
                <tbody role="rowgroup">{therapies.data?.map(therapy => {
                    const change = therapyChanges?.get(therapy.id);
                    return <tr role="row" key={therapy.id} data-changed={change ? 'true' : undefined}>
                        <td role="cell">{overview ? <DrugLabel name={therapy.drugName} /> : <PrivacyBlur>{therapy.drugName}</PrivacyBlur>}{overview && therapy.atc ? <small className="lume-code">{therapy.atc}</small> : null}</td>
                        <td role="cell"><PrivacyBlur>{therapy.dosage}</PrivacyBlur></td>
                        <td role="cell" className={`${secondary} lume-code`}>{therapy.atc}</td>
                        {overview && change ? <td role="cell" className={reading.rowStatus}><span className={reading.chipChange}>{change}</span></td> : null}
                    </tr>;
                })}</tbody>
            </table>
        </Section>
    </>;
    const context = <>
        <Section name="Parametri recenti" icon={overview ? Activity : undefined} action={overview && !composer ? <a href="#parametri" className={reading.islandAction}>Andamento</a> : undefined} read={{ ...measures, data: measures.data === undefined ? undefined : measureRows }} count={formatCountLabel(measureRows.length, 'parametro', 'parametri')} empty="Nessuna misura registrata.">
            <table role="table" className={`${register.table} ${reading.measures}`} aria-label="Parametri recenti">
                <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Nome</th><th role="columnheader" scope="col" className={reading.value}>Valore</th><th role="columnheader" scope="col">Data</th><th role="columnheader" scope="col" className={secondary}>Variazione</th></tr></thead>
                <tbody role="rowgroup">{measureRows.map(measure => {
                    const series = overview ? measureSeries(measures.data ?? [], measure.id) : [];
                    return <tr role="row" key={measure.id} data-trend={series.length > 1 ? 'true' : undefined}>
                    <td role="cell">{measure.display}</td>
                    <td role="cell" className={`${reading.value} ${measure.outOfRange ? register.critical : ''}`}>
                        {overview && measure.outOfRange ? <span aria-hidden="true" className={reading.rangeArrow}>{rangeArrow[measure.outOfRange]}</span> : null}
                        {measure.valueLabel}{measure.outOfRange ? <span className={overview ? reading.visuallyHidden : undefined}>{` · ${measure.outOfRange}`}</span> : null}
                        {overview && measure.delta ? <small>{measure.delta}</small> : null}
                    </td>
                    <td role="cell"><DateCell date={measure.date} /></td><td role="cell" className={secondary}>{measure.delta}</td>
                    {series.length > 1 ? <td role="presentation" className={reading.trendCell}><MeasureTrend series={series} critical={Boolean(measure.outOfRange)} /></td> : null}
                </tr>;
                })}</tbody>
            </table>
        </Section>
        <Section name="Controlli aperti" read={checkups} count={formatCountLabel(checkups.data?.length ?? 0, 'aperto', 'aperti')} empty="Nessun controllo aperto.">
            <table className={`${register.table} ${reading.checkups}`} aria-label="Controlli aperti">
                <thead><tr><th scope="col">Nome</th><th scope="col">Scadenza</th></tr></thead>
                <tbody>{checkups.data?.map(checkup => <tr key={checkup.id}><td>{checkup.title}</td><td><DateCell date={checkup.date} /></td></tr>)}</tbody>
            </table>
        </Section>
    </>;
    const stableWithNotes = <>{stable}{notesContent ? <div className={reading.notes}>{notesContent}</div> : null}</>;
    return <section id="quadro" aria-label="Riepilogo clinico" className={`${register.register} ${reading.sheet}`} data-overview={overview ? 'true' : undefined} data-writing={composer ? 'true' : undefined} data-full-diary={diaryTools?.full ? 'true' : undefined}>
        {overview ? <div className={reading.overview}>
            <nav aria-label="Nel riepilogo" className={reading.overviewIndex}>
                <a href="#riepilogo-cambiato">Cambiato</a>
                <a href="#riepilogo-terapie">Terapie</a>
                <a href="#riepilogo-problemi">Problemi</a>
                <a href="#riepilogo-contesto">Contesto</a>
            </nav>
            <section aria-labelledby="riepilogo-cambiato" data-record-tray="cambiato" className={reading.middle}>
                <h2 id="riepilogo-cambiato" className={reading.zoneTitle}>Cambiato dall’ultima visita</h2>
                <div className={reading.activity}>{activity}</div>
                {diaryTools ? <div className={reading.diaryTools} data-reading={diaryTools.full}>
                    <button ref={diaryTools.control} type="button" aria-controls="diario"
                        aria-label={diaryTools.full ? 'Torna alla bozza dal diario' : undefined}
                        onClick={diaryTools.full ? diaryTools.resume : diaryTools.show}>
                        {diaryTools.full ? 'Torna alla bozza' : 'Tutto il diario'}
                    </button>
                </div> : null}
                {diary}
                {diaryTools ? null : <a href="#diario" className={`mf-button-text ${reading.fullDiary}`}>Tutto il diario</a>}
            </section>
            <div className={reading.side}>
                {composer ? <div className={reading.composer}>{composer}</div> : null}
                <section aria-labelledby="riepilogo-stabile" data-record-tray="stabile" className={reading.stable}>
                    <h2 id="riepilogo-stabile" className={reading.zoneTitle}>Stabile</h2>
                    {stableWithNotes}
                </section>
                <aside aria-labelledby="riepilogo-contesto" data-record-tray="contesto" className={reading.context}>
                    <h2 id="riepilogo-contesto" className={reading.zoneTitle}>Contesto</h2>
                    {clinicalSupport ? <div className={reading.support}>{clinicalSupport}</div> : null}
                    <div className={reading.contextRows}>{context}{composer ? null : sources}</div>
                </aside>
            </div>
        </div> : <>{stableWithNotes}{context}</>}
    </section>;
}
