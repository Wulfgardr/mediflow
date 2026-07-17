'use client';

import { differenceInYears } from 'date-fns';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Kree8WorkspaceShell } from '@/components/kree8/kree8-workspace-shell';
import { db, type Diagnosis, type Patient } from '@/lib/db';
import { useLiveQuery } from '@/lib/live-query';

import styles from './analytics.module.css';

/* @Codex LUME-110/68 */
type AuditSummary = {
    days: number;
    totalEvents: number;
    distinctActors: number;
    outcomes: Record<'success' | 'failure' | 'denied', number>;
    sourceSurfaces: Record<'web' | 'native' | 'api' | 'job', number>;
    topEventTypes: Array<{ eventType: string; count: number }>;
    isTruncated: boolean;
};

type AgeBucket = '0-18' | '19-64' | '65-80' | '80+';

type DiagnosisStat = {
    key: string;
    description: string;
    system: string;
    code: string;
    count: number;
};

type AnalyticsStats = {
    totalInRange: number;
    withBirthDate: number;
    withoutBirthDate: number;
    adiCount: number;
    withDiagnoses: number;
    ageDist: Record<AgeBucket, number>;
    topDiagnoses: DiagnosisStat[];
};

const ANALYTICS_NAV_ITEMS = [
    { href: '#domanda', label: 'Domanda', meta: 'fuoco' },
    { href: '#indicatori', label: 'Indicatori', meta: 'lettura' },
    { href: '#eta', label: 'Età', meta: 'grafico' },
    { href: '#diagnosi', label: 'Diagnosi', meta: 'tabella' },
    { href: '#audit', label: 'Audit', meta: 'locale' },
];

const EMPTY_AGE_DIST: Record<AgeBucket, number> = {
    '0-18': 0,
    '19-64': 0,
    '65-80': 0,
    '80+': 0,
};

function normalizeAgeRange(range: [number, number]): [number, number] {
    return range[0] <= range[1] ? range : [range[1], range[0]];
}

function toDate(value: Patient['birthDate']): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getAgeBucket(age: number): AgeBucket {
    if (age <= 18) return '0-18';
    if (age <= 64) return '19-64';
    if (age <= 80) return '65-80';
    return '80+';
}

function diagnosisKey(diagnosis: Diagnosis): string {
    const system = diagnosis.system?.trim() || 'ICD';
    const code = diagnosis.code?.trim() || 'senza-codice';
    const description = diagnosis.description?.trim() || code;
    return `${system}:${code}:${description.toLocaleLowerCase('it-IT')}`;
}

function buildAnalyticsStats(patients: Patient[], ageRange: [number, number]): AnalyticsStats {
    const now = new Date();
    const [minAge, maxAge] = normalizeAgeRange(ageRange);
    const ageDist: Record<AgeBucket, number> = { ...EMPTY_AGE_DIST };
    const diagnosisCounts = new Map<string, DiagnosisStat>();
    let totalInRange = 0;
    let withBirthDate = 0;
    let withoutBirthDate = 0;
    let adiCount = 0;
    let withDiagnoses = 0;

    for (const patient of patients) {
        const birthDate = toDate(patient.birthDate);
        if (!birthDate) {
            withoutBirthDate += 1;
            continue;
        }

        withBirthDate += 1;
        const age = differenceInYears(now, birthDate);
        if (age < minAge || age > maxAge) continue;

        totalInRange += 1;
        if (patient.isAdi) adiCount += 1;
        ageDist[getAgeBucket(age)] += 1;

        if (!patient.diagnoses?.length) continue;
        withDiagnoses += 1;
        for (const diagnosis of patient.diagnoses) {
            const key = diagnosisKey(diagnosis);
            const current = diagnosisCounts.get(key);
            if (current) {
                current.count += 1;
                continue;
            }
            diagnosisCounts.set(key, {
                key,
                description: diagnosis.description?.trim() || diagnosis.code || 'Diagnosi senza descrizione',
                system: diagnosis.system?.trim() || 'ICD',
                code: diagnosis.code?.trim() || 'n/d',
                count: 1,
            });
        }
    }

    return {
        totalInRange,
        withBirthDate,
        withoutBirthDate,
        adiCount,
        withDiagnoses,
        ageDist,
        topDiagnoses: Array.from(diagnosisCounts.values())
            .sort((left, right) => right.count - left.count)
            .slice(0, 10),
    };
}

function percent(part: number, total: number): number {
    return total > 0 ? Math.round((part / total) * 100) : 0;
}

function ProgressLine({ label, value, total }: { label: string; value: number; total: number }) {
    const percentage = percent(value, total);
    return (
        <div className={styles.progressTrack} role="img" aria-label={`${label}: ${value}, ${percentage}%`}>
            <span className={styles.progressFill} style={{ width: `${percentage}%` }} />
        </div>
    );
}

function SectionHeading({ label, title, description }: { label: string; title: string; description: string }) {
    return (
        <div className={styles.sectionHeading}>
            <p className={styles.sectionLabel}>{label}</p>
            <div>
                <h2>{title}</h2>
                <p>{description}</p>
            </div>
        </div>
    );
}

export default function AnalyticsPage() {
    const patients = useLiveQuery(async () => db.patients
        .filter((patient) => !patient.isArchived)
        .toArray());
    const [ageRange, setAgeRange] = useState<[number, number]>([0, 120]);
    const [auditDays, setAuditDays] = useState(30);
    const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
    const [auditLoading, setAuditLoading] = useState(true);
    const [auditError, setAuditError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        let active = true;

        async function loadAuditSummary() {
            setAuditLoading(true);
            setAuditError(null);
            try {
                const response = await fetch(`/api/system/audit?view=summary&days=${auditDays}&limit=500`, {
                    signal: controller.signal,
                });
                if (!response.ok) {
                    throw new Error(response.status === 403
                        ? 'Serve un account admin per vedere l’audit locale.'
                        : 'Non riesco a leggere l’audit locale.');
                }
                const payload = await response.json() as AuditSummary;
                if (active) setAuditSummary(payload);
            } catch (error) {
                if (controller.signal.aborted || !active) return;
                setAuditError(error instanceof Error ? error.message : 'Non riesco a leggere l’audit locale.');
                setAuditSummary(null);
            } finally {
                if (active) setAuditLoading(false);
            }
        }

        void loadAuditSummary();
        return () => {
            active = false;
            controller.abort();
        };
    }, [auditDays]);

    const normalizedAgeRange = normalizeAgeRange(ageRange);
    const stats = useMemo(
        () => patients ? buildAnalyticsStats(patients, ageRange) : null,
        [patients, ageRange],
    );

    if (!patients || !stats) {
        return (
            <Kree8WorkspaceShell
                eyebrow="Analisi"
                title="Cruscotto locale"
                subtitle="Popolazione registrata e audit operativo, senza dati fuori dal dispositivo."
                backHref="/?area=incarico"
                backLabel="Torna ai pazienti"
                statusLabel="Sto leggendo dal Mac..."
                navItems={ANALYTICS_NAV_ITEMS}
            >
                <p className={styles.loadingState} role="status">Sto preparando l’analisi locale.</p>
            </Kree8WorkspaceShell>
        );
    }

    return (
        <Kree8WorkspaceShell
            eyebrow="Analisi"
            title="Cruscotto locale"
            subtitle="Una domanda alla volta sui dati già registrati in questa postazione."
            backHref="/?area=incarico"
            backLabel="Torna ai pazienti"
            statusLabel={`${stats.totalInRange} schede tra ${normalizedAgeRange[0]} e ${normalizedAgeRange[1]} anni`}
            navItems={ANALYTICS_NAV_ITEMS}
        >
            <section
                id="domanda"
                className={styles.focusSurface}
                data-testid="analytics-focus-surface"
                data-lume-analytics-focus="true"
            >
                <div className={styles.answer}>
                    <p className={styles.sectionLabel}>Domanda operativa</p>
                    <h2>Quante schede attive rientrano nella fascia d’età scelta?</h2>
                    <p
                        className={`${styles.primaryValue} lume-registro`}
                        data-testid="analytics-primary-value"
                        data-lume-register-value="true"
                    >
                        {stats.totalInRange}
                    </p>
                    <p className={styles.mutedNote}>
                        {stats.totalInRange > 0
                            ? `${percent(stats.totalInRange, stats.withBirthDate)}% delle schede con età nota.`
                            : 'Nessuna scheda attiva con età nota rientra nel filtro corrente.'}
                    </p>
                </div>

                <div className={styles.filterField} data-testid="analytics-filter-field">
                    <p className={styles.sectionLabel}>Filtro quieto</p>
                    <label>
                        <span>Età minima</span>
                        <strong className="lume-registro">{ageRange[0]} anni</strong>
                        <input
                            type="range"
                            min="0"
                            max="120"
                            aria-label="Età minima"
                            value={ageRange[0]}
                            onChange={(event) => setAgeRange([Number(event.target.value), ageRange[1]])}
                        />
                    </label>
                    <label>
                        <span>Età massima</span>
                        <strong className="lume-registro">{ageRange[1]} anni</strong>
                        <input
                            type="range"
                            min="0"
                            max="120"
                            aria-label="Età massima"
                            value={ageRange[1]}
                            onChange={(event) => setAgeRange([ageRange[0], Number(event.target.value)])}
                        />
                    </label>
                </div>
            </section>

            <section id="indicatori" className={styles.layerSection} data-testid="analytics-layer-section">
                <SectionHeading
                    label="Indicatori"
                    title="Lettura della popolazione filtrata"
                    description="Valori di contesto, subordinati alla risposta principale."
                />
                <dl className={styles.factList}>
                    <div className={styles.factRow}>
                        <dt>Assistenza domiciliare integrata</dt>
                        <dd><span className="lume-registro" data-lume-register-value="true">{stats.adiCount}</span> schede</dd>
                    </div>
                    <div className={styles.factRow}>
                        <dt>Con almeno una diagnosi registrata</dt>
                        <dd><span className="lume-registro" data-lume-register-value="true">{stats.withDiagnoses}</span> schede</dd>
                    </div>
                    <div className={styles.factRow}>
                        <dt>Senza data di nascita, escluse dal filtro</dt>
                        <dd><span className="lume-registro" data-lume-register-value="true">{stats.withoutBirthDate}</span> schede</dd>
                    </div>
                </dl>
            </section>

            <section id="eta" className={styles.layerSection}>
                <SectionHeading
                    label="Grafico"
                    title="Distribuzione per fascia d’età"
                    description="Ogni barra usa come base le schede comprese nel filtro."
                />
                <div className={styles.chart} aria-label="Distribuzione delle schede per fascia d’età">
                    {Object.entries(stats.ageDist).map(([range, count]) => (
                        <div className={styles.chartRow} key={range}>
                            <div className={styles.chartDatum}>
                                <span>{range} anni</span>
                                <strong className="lume-registro" data-lume-register-value="true">{count}</strong>
                            </div>
                            <ProgressLine label={`${range} anni`} value={count} total={stats.totalInRange} />
                        </div>
                    ))}
                </div>
            </section>

            <section id="diagnosi" className={styles.layerSection}>
                <SectionHeading
                    label="Tabella"
                    title="Diagnosi più ricorrenti"
                    description="Descrizione, sistema di codifica e numero di schede nel filtro corrente."
                />
                <div
                    className={styles.tableScroller}
                    data-testid="analytics-table-overflow"
                    data-horizontal-overflow="declared"
                    tabIndex={0}
                    aria-label="Tabella diagnosi, scorrimento orizzontale disponibile se necessario"
                >
                    <table className={styles.dataTable}>
                        <thead>
                            <tr>
                                <th scope="col">Diagnosi</th>
                                <th scope="col">Codice</th>
                                <th scope="col">Schede</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.topDiagnoses.map((diagnosis) => (
                                <tr key={diagnosis.key}>
                                    <td>{diagnosis.description}</td>
                                    <td className="lume-registro" data-lume-register-value="true">{diagnosis.system} {diagnosis.code}</td>
                                    <td className="lume-registro" data-lume-register-value="true">{diagnosis.count}</td>
                                </tr>
                            ))}
                            {stats.topDiagnoses.length === 0 ? (
                                <tr>
                                    <td colSpan={3} className={styles.emptyState}>
                                        Nessuna diagnosi codificata nel filtro corrente.
                                    </td>
                                </tr>
                            ) : null}
                        </tbody>
                    </table>
                </div>
            </section>

            <section id="audit" className={styles.layerSection}>
                <div className={styles.auditHeading}>
                    <SectionHeading
                        label="Audit locale"
                        title="Attività della postazione"
                        description="Eventi tecnici senza contenuti clinici."
                    />
                    <label className={styles.compactField}>
                        <span>Finestra audit</span>
                        <select aria-label="Finestra audit" value={auditDays} onChange={(event) => setAuditDays(Number(event.target.value))}>
                            <option value={7}>Ultimi 7 giorni</option>
                            <option value={30}>Ultimi 30 giorni</option>
                            <option value={90}>Ultimi 90 giorni</option>
                        </select>
                    </label>
                </div>

                {auditLoading ? (
                    <p className={styles.emptyState} role="status">Sto leggendo il tracciato locale.</p>
                ) : auditError ? (
                    <p className={styles.warningState} role="status">
                        <AlertTriangle aria-hidden="true" />
                        {auditError}
                    </p>
                ) : auditSummary ? (
                    <div className={styles.auditResult}>
                        <ShieldCheck aria-hidden="true" />
                        <dl className={styles.factList}>
                            <div className={styles.factRow}>
                                <dt>Eventi registrati</dt>
                                <dd className="lume-registro" data-lume-register-value="true">{auditSummary.totalEvents}</dd>
                            </div>
                            <div className={styles.factRow}>
                                <dt>Completati, errori, negati</dt>
                                <dd className="lume-registro" data-lume-register-value="true">
                                    {auditSummary.outcomes.success} / {auditSummary.outcomes.failure} / {auditSummary.outcomes.denied}
                                </dd>
                            </div>
                            <div className={styles.factRow}>
                                <dt>Attori distinti</dt>
                                <dd className="lume-registro" data-lume-register-value="true">{auditSummary.distinctActors}</dd>
                            </div>
                            <div className={styles.factRow}>
                                <dt>Evento più frequente</dt>
                                <dd>
                                    <span className="lume-registro" data-lume-register-value="true">
                                        {auditSummary.topEventTypes[0]?.eventType ?? 'Nessun evento'}
                                    </span>
                                    {auditSummary.topEventTypes[0] ? `, ${auditSummary.topEventTypes[0].count} occorrenze` : ''}
                                </dd>
                            </div>
                        </dl>
                        {auditSummary.isTruncated ? (
                            <p className={styles.mutedNote}>Riepilogo calcolato sui primi 500 eventi nel filtro.</p>
                        ) : null}
                    </div>
                ) : (
                    <p className={styles.emptyState}>Nessun riepilogo audit disponibile.</p>
                )}
            </section>
        </Kree8WorkspaceShell>
    );
}
