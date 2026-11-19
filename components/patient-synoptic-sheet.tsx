'use client';

import type { ReactNode, Ref } from 'react';
import { Activity, Heart, Pill, type LucideIcon } from 'lucide-react';
import type { Checkup, Diagnosis, Observation, Therapy } from '@/lib/db';
import { formatCountLabel } from '@/lib/format-count';
import { projectQuadroMeasures } from '@/lib/patient-quadro';
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

export function PatientSynopticSheet({ clinicalSupport, notesContent, problems, therapies, measures, checkups, diary, diaryTools, composer, sources, activity }: PatientSynopticSheetProps) {
    const measureRows = projectQuadroMeasures(measures.data ?? []);
    const stable = <>
        <Section name="Problemi" id="riepilogo-problemi" icon={diary ? Heart : undefined} action={diary && !composer ? <a href="#clinica" className={reading.islandAction}>Clinica</a> : undefined} read={problems} count={formatCountLabel(problems.data?.length ?? 0, 'problema', 'problemi')} empty="Nessun problema registrato.">
            <table className={`${register.table} ${reading.problems}`} aria-label="Problemi">
                <thead><tr><th scope="col">Codice</th><th scope="col">Descrizione</th><th scope="col" className={`${register.secondaryColumn} ${reading.secondaryColumn}`}>Da quando</th></tr></thead>
                <tbody>{problems.data?.map((problem, index) => <tr key={`${problem.system}-${problem.code}-${index}`}>
                    <td className="lume-code">{problem.code}</td><td><PrivacyBlur>{problem.description}</PrivacyBlur>{diary && problem.date ? <small><DateCell date={problem.date} /></small> : null}</td><td className={`${register.secondaryColumn} ${reading.secondaryColumn}`}><DateCell date={problem.date} /></td>
                </tr>)}</tbody>
            </table>
        </Section>
        <Section name="Terapie attive" id="riepilogo-terapie" icon={diary ? Pill : undefined} action={diary && !composer ? <a href="#terapie" className={reading.islandAction}>Terapie</a> : undefined} read={therapies} count={formatCountLabel(therapies.data?.length ?? 0, 'attiva', 'attive')} empty="Nessuna terapia attiva.">
            <table className={`${register.table} ${reading.therapies}`} aria-label="Terapie attive">
                <thead><tr><th scope="col">Nome e dose</th><th scope="col">Posologia</th><th scope="col" className={`${register.secondaryColumn} ${reading.secondaryColumn}`}>ATC</th></tr></thead>
                <tbody>{therapies.data?.map(therapy => <tr key={therapy.id}>
                    <td><PrivacyBlur>{therapy.drugName}</PrivacyBlur>{diary && therapy.atc ? <small className="lume-code">{therapy.atc}</small> : null}</td><td><PrivacyBlur>{therapy.dosage}</PrivacyBlur></td><td className={`${register.secondaryColumn} ${reading.secondaryColumn} lume-code`}>{therapy.atc}</td>
                </tr>)}</tbody>
            </table>
        </Section>
    </>;
    const context = <>
        <Section name="Parametri recenti" icon={diary ? Activity : undefined} action={diary && !composer ? <a href="#parametri" className={reading.islandAction}>Andamento</a> : undefined} read={{ ...measures, data: measures.data === undefined ? undefined : measureRows }} count={formatCountLabel(measureRows.length, 'parametro', 'parametri')} empty="Nessuna misura registrata.">
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
    </>;
    const stableWithNotes = <>{stable}{notesContent ? <div className={reading.notes}>{notesContent}</div> : null}</>;
    return <section id="quadro" aria-label="Riepilogo clinico" className={`${register.register} ${reading.sheet}`} data-overview={diary ? 'true' : undefined} data-writing={composer ? 'true' : undefined} data-full-diary={diaryTools?.full ? 'true' : undefined}>
        {diary ? <div className={reading.overview}>
            <nav aria-label="Nel riepilogo" className={reading.overviewIndex}>
                <a href="#riepilogo-cambiato">Cambiato</a>
                <a href="#riepilogo-terapie">Terapie</a>
                <a href="#riepilogo-problemi">Problemi</a>
                <a href="#riepilogo-contesto">Contesto</a>
            </nav>
            <section aria-labelledby="riepilogo-cambiato" className={reading.middle}>
                <h2 id="riepilogo-cambiato" className={reading.zoneTitle}>Cambiato</h2>
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
                <section aria-labelledby="riepilogo-stabile" className={reading.stable}>
                    <h2 id="riepilogo-stabile" className={reading.zoneTitle}>Stabile</h2>
                    {stableWithNotes}
                </section>
                <aside aria-labelledby="riepilogo-contesto" className={reading.context}>
                    <h2 id="riepilogo-contesto" className={reading.zoneTitle}>Contesto</h2>
                    {clinicalSupport ? <div className={reading.support}>{clinicalSupport}</div> : null}
                    <div className={reading.contextRows}>{context}{composer ? null : sources}</div>
                </aside>
            </div>
        </div> : <>{stableWithNotes}{context}</>}
    </section>;
}
