'use client';

/* @Codex WUL-UIUX (Fase 4): Foglio clinico sinottico. Sostituisce la strip di
   conteggi (PatientClinicalSignals) in cima alla Scheda. Un foglio unico e
   delicato: il medico legge il paziente in pochi secondi (problema guida,
   terapie attive CON posologia, ultima misura con variazione, prossimo
   follow-up) e ogni riga e un anchor che apre a cascata la sezione completa.
   Presentazionale puro: nessun fetch, nessuna interpretazione clinica nuova,
   mai un "fuori range" senza range reale (la classificazione arriva gia fatta da
   lib/observation-range via la pagina). undefined = caricamento, [] / null =
   dato vero assente (stato onesto). */

import { useRuntimeTwinDesign } from '@/components/runtime-twin-design';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Diagnosis } from '@/lib/db';
import styles from '@/components/kree8/kree8-workspace-shell.module.css';
import reading from './twin-synoptic-sheet.module.css';

export interface SynopticTherapyLine {
    id: string;
    drugName: string;
    dosage?: string;
}

export interface SynopticDelta {
    direction: 'up' | 'down' | 'flat';
    label: string;
    /* @Codex WUL-UIUX: data della misura precedente ("dal 12 gen"), cosi la
       variazione non nasconde un salto temporale lungo (es. -10 kg dopo 6 mesi). */
    sinceLabel?: string;
}

export interface SynopticMeasure {
    display: string;
    valueLabel: string;
    dateLabel: string;
    delta?: SynopticDelta;
    outOfRange?: 'basso' | 'alto';
}

export interface SynopticSignal {
    label: string;
    value: string | number;
    tone?: 'neutral' | 'warning' | 'critical';
    href?: string;
}

export interface PatientSynopticSheetProps {
    notes?: string;
    leadDiagnosis?: Diagnosis;
    otherProblemsCount: number;
    signals: SynopticSignal[];
    therapies?: SynopticTherapyLine[];
    /* @Codex WUL-UIUX Fase 7: undefined finche la pipeline workspace non e
       pronta, cosi il totale non mostra zeri finti durante il caricamento. */
    therapiesTotal?: number;
    latestMeasure?: SynopticMeasure | null;
    nextCheckupLabel?: string;
    nextCheckupTitle?: string;
}

const SIGNAL_TONE: Record<NonNullable<SynopticSignal['tone']>, string> = {
    neutral: 'text-[color:var(--lume-ink)]',
    warning: styles.synopticWarning,
    critical: 'text-[color:var(--lume-signal-critical)]',
};

const THERAPY_CAP = 6;

function SkeletonLines({ rows }: { rows: number }) {
    return (
        <div className="space-y-1.5" aria-hidden>
            {Array.from({ length: rows }).map((_, index) => (
                <div key={index} className="mf-skeleton h-6" />
            ))}
        </div>
    );
}

function MicroLabel({ children }: { children: ReactNode }) {
    return (
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--lume-ink-muted)]">
            {children}
        </span>
    );
}

export function PatientSynopticSheet({
    notes,
    leadDiagnosis,
    otherProblemsCount,
    signals,
    therapies,
    therapiesTotal,
    latestMeasure,
    nextCheckupLabel,
    nextCheckupTitle,
}: PatientSynopticSheetProps) {
    const { proposal, composition } = useRuntimeTwinDesign();
    const visibleTherapies = therapies ? therapies.slice(0, THERAPY_CAP) : [];
    const extraTherapies = therapiesTotal !== undefined ? therapiesTotal - visibleTherapies.length : 0;

    /* @Codex: a selective reading surface uses only supplied records. Absent
       secondary modules stay in navigation; no empty specialist cards. */
    if (proposal) return (
      <section id="quadro" aria-label="Riepilogo clinico" className={reading.sheet} data-layout={composition}>
        <div className={reading.main}>
          <div className={reading.problem}>
            <div className={reading.sectionHead}><h2>Quadro clinico</h2><a href="#identita">Diagnosi e dati paziente</a></div>
            {leadDiagnosis ? <><p className={reading.diagnosis}>{leadDiagnosis.description || leadDiagnosis.code}</p><p className={reading.meta}>{[leadDiagnosis.code, leadDiagnosis.system, otherProblemsCount > 0 ? `altre ${otherProblemsCount} diagnosi` : null].filter(Boolean).join(' · ')}</p></>
              : <p className={reading.muted}>Diagnosi non registrata. <a href="#identita">Completa la scheda</a></p>}
            {notes?.trim() ? <div className={reading.notes}><h3>Note in cartella</h3><p>{notes.length > 320 ? `${notes.slice(0, 320).trimEnd()}…` : notes}</p>{notes.length > 320 ? <details><summary>Leggi la nota completa</summary><p>{notes}</p></details> : null}</div> : null}
          </div>
          {therapies === undefined || visibleTherapies.length > 0 ? <div className={reading.therapies}>
            <div className={reading.sectionHead}><h2>Terapie attive <span className={reading.count}>{therapiesTotal ?? ''}</span></h2><a href="#terapie">Gestisci</a></div>
            {therapies === undefined ? <SkeletonLines rows={2} /> : <ul>{visibleTherapies.map(therapy => <li key={therapy.id}><strong>{therapy.drugName}</strong><span>{therapy.dosage || 'Posologia non registrata'}</span></li>)}</ul>}
            {extraTherapies > 0 ? <a href="#terapie" className={reading.more}>Vedi tutte le {therapiesTotal} terapie</a> : null}
          </div> : null}
        </div>
        <aside className={reading.context} aria-label="Contesto della cartella">
          {signals.filter(signal => Number(signal.value) !== 0 && signal.label !== 'Da rivedere').map(signal => <div className={reading.fact} key={signal.label}><span>{signal.label}</span>{signal.href ? <a href={signal.href} className={SIGNAL_TONE[signal.tone ?? 'neutral']}>{signal.value}</a> : <strong>{signal.value}</strong>}</div>)}
          {latestMeasure ? <div className={reading.measure}>
            <div className={reading.sectionHead}><h3>Ultima misura</h3><a href="#parametri">Apri</a></div>
            <p>{latestMeasure.display}</p><strong className={latestMeasure.outOfRange ? 'text-[color:var(--lume-signal-critical)]' : undefined}>{latestMeasure.valueLabel}{latestMeasure.outOfRange ? ` · ${latestMeasure.outOfRange}` : ''}</strong>
            <span>{latestMeasure.dateLabel}</span>
            {latestMeasure.delta ? <small>{latestMeasure.delta.direction === 'up' ? 'In aumento' : latestMeasure.delta.direction === 'down' ? 'In calo' : 'Stabile'} · {latestMeasure.delta.label} {latestMeasure.delta.sinceLabel}</small> : null}
          </div> : null}
          {nextCheckupLabel ? <div className={reading.followup}><h3>Controllo pianificato</h3><a href="#follow-up">{nextCheckupLabel}</a>{nextCheckupTitle ? <p>{nextCheckupTitle}</p> : null}</div> : null}
        </aside>
      </section>
    );

    return (
        <section id="quadro" aria-labelledby="synoptic-title" className={styles.synoptic}>
            <div className="mb-4">
                <p className={styles.sectionLabel}>Quadro clinico</p>
                <h2 id="synoptic-title" className={styles.sectionTitle}>{proposal ? 'Quadro clinico' : 'Baseline e dati verificabili'}</h2>
                {proposal ? <div className={styles.synopticNotes}><strong>Note in cartella</strong><p>{notes?.trim() || 'Nessuna nota generale registrata.'}</p></div> : null}
            </div>

            {/* Problema guida (prima diagnosi di qualunque sistema) */}
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <MicroLabel>Problema guida</MicroLabel>
                    {leadDiagnosis ? (
                        <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                            <span className={`${styles.synopticCode} lume-registro shrink-0`} data-testid="lume-register-value">{leadDiagnosis.code}</span>
                            <span aria-hidden="true">·</span>
                            <span className="text-[15px] font-semibold leading-6 text-[color:var(--lume-ink)]">{leadDiagnosis.description}</span>
                            <span className="text-[11px] uppercase tracking-wide text-[color:var(--lume-ink-muted)]">{leadDiagnosis.system}</span>
                        </div>
                    ) : (
                        <p className="mt-1 text-sm text-[color:var(--lume-ink-muted)]">Nessuna diagnosi codificata in scheda.</p>
                    )}
                </div>
                {otherProblemsCount > 0 ? (
                    <span className="shrink-0 whitespace-nowrap text-[11px] text-[color:var(--lume-ink-muted)]">+{otherProblemsCount} problemi</span>
                ) : null}
            </div>

            {/* C. Segnali di contesto */}
            {signals.length > 0 ? (
                <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
                    {signals.map((signal) => {
                        const body = (
                            <>
                                <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--lume-ink-muted)]">{signal.label}</span>
                                <span className={`lume-registro mt-0.5 block text-[18px] font-semibold leading-none ${SIGNAL_TONE[signal.tone ?? 'neutral']}`} data-testid="lume-register-value">
                                    {signal.value}
                                </span>
                            </>
                        );
                        return signal.href ? (
                            <a
                                key={signal.label}
                                href={signal.href}
                                className={`${styles.synopticLink} px-1 py-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2`}
                            >
                                {body}
                            </a>
                        ) : (
                            <div key={signal.label}>{body}</div>
                        );
                    })}
                </div>
            ) : null}

            <hr className="my-4 border-0 border-t border-[color:color-mix(in_srgb,var(--lume-ink)_8%,transparent)]" />

            <div className={styles.synopticDetails}>
                {/* @Codex: keep medication, dose and count within one readable group. */}
                <div className={styles.synopticDetail}>
                    <a href="#terapie" className={styles.synopticDetailHeading}>
                        <MicroLabel>Terapie attive</MicroLabel>
                        <span className={`${styles.synopticCount} lume-registro`} data-testid="lume-register-value">{therapiesTotal ?? '–'}</span>
                    </a>
                    {therapies === undefined ? (
                        <div className="mt-2"><SkeletonLines rows={3} /></div>
                    ) : therapies.length === 0 ? (
                        <p className="mt-2 text-sm text-[color:var(--lume-ink-muted)]">Nessuna terapia attiva.</p>
                    ) : (
                        <ul className="mt-1 divide-y divide-[color:color-mix(in_srgb,var(--lume-ink)_6%,transparent)]">
                            {visibleTherapies.map((therapy) => (
                                <li key={therapy.id} className={styles.synopticTherapy}>
                                    <span className="text-[13px] font-medium leading-5 text-[color:var(--lume-ink)]">{therapy.drugName}</span>
                                    {therapy.dosage ? (
                                        <span className={styles.synopticDetailMeta}>{therapy.dosage}</span>
                                    ) : null}
                                </li>
                            ))}
                            {extraTherapies > 0 ? (
                                <li className="py-1">
                                    <a href="#terapie" className="text-[12px] font-medium text-[color:var(--lume-ink-muted)] transition-colors hover:text-[color:var(--lume-ink)]">
                                        +{extraTherapies} altre terapie
                                    </a>
                                </li>
                            ) : null}
                        </ul>
                    )}
                </div>

                {/* F. Ultima misura + G. Follow-up */}
                <div className="contents">
                    <div className={styles.synopticDetail}>
                        <a href="#parametri" className={styles.synopticDetailHeading}>
                            <MicroLabel>Ultima misura</MicroLabel>
                        </a>
                        {latestMeasure === undefined ? (
                            <div className="mt-2"><SkeletonLines rows={1} /></div>
                        ) : latestMeasure === null ? (
                            <p className="mt-1 text-sm text-[color:var(--lume-ink-muted)]">Nessun parametro registrato.</p>
                        ) : (
                            <div className={styles.synopticMeasure}>
                                <span className="text-[13px] text-[color:var(--lume-ink)]">{latestMeasure.display}</span>
                                <span className={`lume-registro text-[15px] font-semibold ${latestMeasure.outOfRange ? 'text-[color:var(--lume-signal-critical)]' : 'text-[color:var(--lume-ink)]'}`} data-testid="lume-register-value">
                                    {latestMeasure.valueLabel}
                                </span>
                                {latestMeasure.delta ? (
                                    <span className="inline-flex items-center gap-0.5 text-[12px] text-[color:var(--lume-ink-muted)]">
                                        {latestMeasure.delta.direction === 'up' ? (
                                            <TrendingUp className="h-3.5 w-3.5" aria-label="in aumento" />
                                        ) : latestMeasure.delta.direction === 'down' ? (
                                            <TrendingDown className="h-3.5 w-3.5" aria-label="in calo" />
                                        ) : (
                                            <Minus className="h-3.5 w-3.5" aria-label="stabile" />
                                        )}
                                        <span className="lume-registro" data-testid="lume-register-value">{latestMeasure.delta.label}</span>
                                        {latestMeasure.delta.sinceLabel ? (
                                            <span className="lume-registro text-[color:var(--lume-ink-muted)]" data-testid="lume-register-value">{latestMeasure.delta.sinceLabel}</span>
                                        ) : null}
                                    </span>
                                ) : null}
                                <span className={styles.synopticDetailMeta}>Rilevata il {latestMeasure.dateLabel}</span>
                            </div>
                        )}
                    </div>

                    <div className={styles.synopticDetail}>
                        <a href="#follow-up" className={styles.synopticDetailHeading}>
                            <MicroLabel>Prossimo follow-up</MicroLabel>
                        </a>
                        {nextCheckupLabel ? (
                            <div className={styles.synopticMeasure}>
                                <span className={`lume-registro text-[13px] font-semibold ${styles.synopticWarning}`} data-testid="lume-register-value">{nextCheckupLabel}</span>
                                {nextCheckupTitle ? <span className={styles.synopticDetailMeta}>{nextCheckupTitle}</span> : null}
                            </div>
                        ) : (
                            <p className="mt-1 text-sm text-[color:var(--lume-ink-muted)]">Nessun follow-up pianificato.</p>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}
