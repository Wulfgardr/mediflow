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

import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';

import PrivacyBlur from '@/components/privacy-blur';
import type { Diagnosis, Patient } from '@/lib/db';

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
    patient: Patient;
    ageLabel: string;
    leadDiagnosis?: Diagnosis;
    otherProblemsCount: number;
    signals: SynopticSignal[];
    therapies?: SynopticTherapyLine[];
    therapiesTotal: number;
    latestMeasure?: SynopticMeasure | null;
    nextCheckupLabel?: string;
    nextCheckupTitle?: string;
    actions: ReactNode;
}

const SIGNAL_TONE: Record<NonNullable<SynopticSignal['tone']>, string> = {
    neutral: 'text-[color:var(--mf-ink)]',
    warning: 'text-[color:var(--mf-warning)]',
    critical: 'text-[color:var(--mf-critical)]',
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
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
            {children}
        </span>
    );
}

export function PatientSynopticSheet({
    patient,
    ageLabel,
    leadDiagnosis,
    otherProblemsCount,
    signals,
    therapies,
    therapiesTotal,
    latestMeasure,
    nextCheckupLabel,
    nextCheckupTitle,
    actions,
}: PatientSynopticSheetProps) {
    const visibleTherapies = therapies ? therapies.slice(0, THERAPY_CAP) : [];
    const extraTherapies = therapiesTotal - visibleTherapies.length;

    return (
        <section aria-labelledby="synoptic-name" className="patient-detail-section border p-5 md:p-6">
            {/* A. Identita compatta */}
            <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                    <h2 id="synoptic-name" className="text-[17px] font-semibold leading-tight text-[color:var(--mf-ink)]">
                        <PrivacyBlur>{patient.lastName} {patient.firstName}</PrivacyBlur>
                    </h2>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-[color:var(--mf-muted)]">
                        {patient.taxCode ? (
                            <PrivacyBlur intensity="sm"><span className="font-mono uppercase">{patient.taxCode}</span></PrivacyBlur>
                        ) : null}
                        <span>{ageLabel}</span>
                        {patient.isArchived ? <span className="text-[color:var(--mf-muted)]">· Archiviato</span> : null}
                    </p>
                </div>
                <div className="shrink-0">{actions}</div>
            </header>

            <hr className="my-4 border-0 border-t border-[color:var(--glass-border,rgba(15,23,42,0.08))]" />

            {/* B. Problema guida (prima diagnosi di qualunque sistema) */}
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <MicroLabel>Problema guida</MicroLabel>
                    {leadDiagnosis ? (
                        <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                            <span className="patient-code-pill patient-code-pill-plum shrink-0">{leadDiagnosis.code}</span>
                            <span className="text-[15px] font-semibold leading-6 text-[color:var(--mf-ink)]">{leadDiagnosis.description}</span>
                            <span className="text-[11px] uppercase tracking-wide text-[color:var(--mf-muted)]">{leadDiagnosis.system}</span>
                        </div>
                    ) : (
                        <p className="mt-1 text-sm text-[color:var(--mf-muted)]">Nessuna diagnosi codificata in scheda.</p>
                    )}
                </div>
                {otherProblemsCount > 0 ? (
                    <span className="shrink-0 whitespace-nowrap text-[11px] text-[color:var(--mf-muted)]">+{otherProblemsCount} problemi</span>
                ) : null}
            </div>

            {/* C. Segnali di contesto */}
            {signals.length > 0 ? (
                <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
                    {signals.map((signal) => {
                        const body = (
                            <>
                                <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">{signal.label}</span>
                                <span className={`mt-0.5 block text-[18px] font-semibold leading-none tabular-nums ${SIGNAL_TONE[signal.tone ?? 'neutral']}`}>
                                    {signal.value}
                                </span>
                            </>
                        );
                        return signal.href ? (
                            <a
                                key={signal.label}
                                href={signal.href}
                                className="rounded-[10px] px-1 py-0.5 transition-colors hover:bg-[color:rgba(15,23,42,0.04)] focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/5"
                            >
                                {body}
                            </a>
                        ) : (
                            <div key={signal.label}>{body}</div>
                        );
                    })}
                </div>
            ) : null}

            <hr className="my-4 border-0 border-t border-[color:var(--glass-border,rgba(15,23,42,0.08))]" />

            <div className="grid gap-4 md:grid-cols-2">
                {/* D. Terapie attive */}
                <div className="min-w-0">
                    <a href="#terapie" className="mf-listrow !px-1 !py-0.5 justify-between">
                        <MicroLabel>Terapie attive</MicroLabel>
                        <span className="text-[11px] text-[color:var(--mf-muted)]">{therapiesTotal || 0}</span>
                    </a>
                    {therapies === undefined ? (
                        <div className="mt-2"><SkeletonLines rows={3} /></div>
                    ) : therapies.length === 0 ? (
                        <p className="mt-2 text-sm text-[color:var(--mf-muted)]">Nessuna terapia attiva.</p>
                    ) : (
                        <ul className="mt-1 divide-y divide-[color:var(--glass-border,rgba(15,23,42,0.06))]">
                            {visibleTherapies.map((therapy) => (
                                <li key={therapy.id} className="flex items-baseline justify-between gap-3 py-1">
                                    <span className="min-w-0 truncate text-[13px] font-medium text-[color:var(--mf-ink)]">{therapy.drugName}</span>
                                    {therapy.dosage ? (
                                        <span className="shrink-0 text-[12px] text-[color:var(--mf-muted)]">{therapy.dosage}</span>
                                    ) : null}
                                </li>
                            ))}
                            {extraTherapies > 0 ? (
                                <li className="py-1">
                                    <a href="#terapie" className="text-[12px] font-medium text-[color:var(--mf-muted)] transition-colors hover:text-[color:var(--mf-ink)]">
                                        +{extraTherapies} altre terapie
                                    </a>
                                </li>
                            ) : null}
                        </ul>
                    )}
                </div>

                {/* F. Ultima misura + G. Follow-up */}
                <div className="min-w-0 space-y-4">
                    <div>
                        <a href="#parametri" className="mf-listrow !px-1 !py-0.5 justify-between">
                            <MicroLabel>Ultima misura</MicroLabel>
                        </a>
                        {latestMeasure === undefined ? (
                            <div className="mt-2"><SkeletonLines rows={1} /></div>
                        ) : latestMeasure === null ? (
                            <p className="mt-1 text-sm text-[color:var(--mf-muted)]">Nessun parametro registrato.</p>
                        ) : (
                            <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                                <span className="text-[13px] text-[color:var(--mf-ink)]">{latestMeasure.display}</span>
                                <span className={`text-[15px] font-semibold tabular-nums ${latestMeasure.outOfRange ? 'text-[color:var(--mf-critical)]' : 'text-[color:var(--mf-ink)]'}`}>
                                    {latestMeasure.valueLabel}
                                </span>
                                {latestMeasure.delta ? (
                                    <span className="inline-flex items-center gap-0.5 text-[12px] text-[color:var(--mf-muted)]">
                                        {latestMeasure.delta.direction === 'up' ? (
                                            <TrendingUp className="h-3.5 w-3.5" aria-label="in aumento" />
                                        ) : latestMeasure.delta.direction === 'down' ? (
                                            <TrendingDown className="h-3.5 w-3.5" aria-label="in calo" />
                                        ) : (
                                            <Minus className="h-3.5 w-3.5" aria-label="stabile" />
                                        )}
                                        <span className="tabular-nums">{latestMeasure.delta.label}</span>
                                        {latestMeasure.delta.sinceLabel ? (
                                            <span className="text-[color:var(--mf-muted)]">{latestMeasure.delta.sinceLabel}</span>
                                        ) : null}
                                    </span>
                                ) : null}
                                <span className="text-[11px] text-[color:var(--mf-muted)]">{latestMeasure.dateLabel}</span>
                            </div>
                        )}
                    </div>

                    <div>
                        <a href="#follow-up" className="mf-listrow !px-1 !py-0.5 justify-between">
                            <MicroLabel>Prossimo follow-up</MicroLabel>
                        </a>
                        {nextCheckupLabel ? (
                            <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                                <span className="text-[13px] font-semibold text-[color:var(--mf-warning)]">{nextCheckupLabel}</span>
                                {nextCheckupTitle ? <span className="min-w-0 truncate text-[12px] text-[color:var(--mf-muted)]">{nextCheckupTitle}</span> : null}
                            </div>
                        ) : (
                            <p className="mt-1 text-sm text-[color:var(--mf-muted)]">Nessun follow-up pianificato.</p>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}
