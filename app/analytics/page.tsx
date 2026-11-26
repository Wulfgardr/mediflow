'use client';

import { formatCountLabel } from '@/lib/format-count';
import { differenceInYears } from 'date-fns';
import { Activity, AlertTriangle, BarChart3, Filter, ListChecks, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Kree8WorkspaceShell } from '@/components/kree8/kree8-workspace-shell';
import { useRuntimeTwinDesign } from '@/components/runtime-twin-design';
import { RangeInput } from '@/components/range-input';
import { db } from '@/lib/db';
import { buildAnalyticsStats, isAnalyticsPatient, normalizeAgeRange } from '@/lib/patient-analytics';
import { useLiveQueryState } from '@/lib/live-query';
import { subscribeClientAccountAuthority } from '@/lib/security/client-auth-api';
import { readCockpitRows } from '@/components/kree8/cockpit-read-snapshot';
import { ViewState } from '@/components/ui/view-state';

import surface from '@/components/record-surface.module.css';
import styles from './analytics.module.css';

/* LUME-110/68 */
type AuditSummary = {
    days: number;
    totalEvents: number;
    importedEvents: number;
    unattestedEvents: number;
    unattestedIsTruncated: boolean;
    importedIsTruncated: boolean;
    distinctActors: number;
    outcomes: Record<'success' | 'failure' | 'denied', number>;
    sourceSurfaces: Record<'web' | 'native' | 'api' | 'job', number>;
    topEventTypes: Array<{ eventType: string; count: number }>;
    isTruncated: boolean;
};

const ANALYTICS_NAV_ITEMS = [
    { href: '#domanda', label: 'Domanda', meta: 'fuoco' },
    { href: '#indicatori', label: 'Indicatori', meta: 'lettura' },
    { href: '#eta', label: 'Età', meta: 'grafico' },
    { href: '#diagnosi', label: 'Diagnosi', meta: 'tabella' },
    { href: '#audit', label: 'Audit', meta: 'locale' },
];

function percent(part: number, total: number): number {
    return total > 0 ? Math.round((part / total) * 100) : 0;
}

function ProgressLine({ label, value, total }: { label: string; value: number; total: number }) {
    const percentage = percent(value, total);
    return (
        <div className={styles.progressTrack} role="img" aria-label={`${label}: ${value}, ${percentage}%`}>
            <span
                className={styles.progressFill}
                data-testid="analytics-progress-fill"
                style={{ width: `${percentage}%` }}
            />
        </div>
    );
}

function SectionHeading({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
    return <div className={surface.islandHeader}>
        <span className={surface.islandIcon} aria-hidden="true"><Icon size={16} /></span>
        <h2>{title}</h2>
    </div>;
}

export default function AnalyticsPage() {
    const { proposal } = useRuntimeTwinDesign();
    const navItems = proposal
        ? ANALYTICS_NAV_ITEMS.map(({ href, label }) => ({ href, label: href === '#domanda' ? 'Popolazione' : label }))
        : ANALYTICS_NAV_ITEMS;
    const snapshotVisibility = useRef({ valid: true });
    const [, invalidateVisibleSnapshot] = useState(0);
    useEffect(() => {
        snapshotVisibility.current = { valid: true };
        const hide = () => {
            snapshotVisibility.current.valid = false;
            invalidateVisibleSnapshot(value => value + 1);
        };
        const show = () => {
            if (!snapshotVisibility.current.valid) snapshotVisibility.current = { valid: true };
        };
        window.addEventListener('pagehide', hide);
        window.addEventListener('pageshow', show);
        return () => {
            snapshotVisibility.current.valid = false;
            window.removeEventListener('pagehide', hide);
            window.removeEventListener('pageshow', show);
        };
    }, []);
    const patientRead = useLiveQueryState(
        () => readCockpitRows(options => db.patients.filter(isAnalyticsPatient).toArray(options), snapshotVisibility.current),
        [], undefined, ['patients', 'patients_to_ambulatories'],
    );
    const { refresh: refreshPatients } = patientRead;
    useEffect(() => subscribeClientAccountAuthority(() => {
        invalidateVisibleSnapshot(value => value + 1);
        refreshPatients();
    }), [refreshPatients]);
    const currentRows = patientRead.data?.isCurrent() ? patientRead.data.rows : undefined;
    const readFailed = !patientRead.loading && Boolean(patientRead.error || (patientRead.data && !currentRows));
    const patients = !patientRead.loading && !readFailed ? currentRows : undefined;
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
        () => patients ? buildAnalyticsStats(patients, ageRange, differenceInYears) : null,
        [patients, ageRange],
    );

    if (!patients || !stats) {
        return (
            <Kree8WorkspaceShell
                variant="overview"
                title="Analisi"
                navItems={navItems}
            >
                {readFailed ? <ViewState state="error" title="Schede non leggibili"
                    detail="Impossibile leggere le schede. Gli aggregati non sono mostrati. Usa «Riprova» per ripetere la lettura."
                    action={{ label: 'Riprova', onClick: refreshPatients }} />
                    : <p className={styles.loadingState} role="status">Sto preparando l’analisi locale.</p>}
            </Kree8WorkspaceShell>
        );
    }

    const populationSummary = `${formatCountLabel(stats.totalInRange, 'scheda', 'schede')} tra ${normalizedAgeRange[0]} e ${normalizedAgeRange[1]} anni`;
    return (
        <Kree8WorkspaceShell
            variant="overview"
            title="Analisi"
            navItems={navItems}
        >
            <div className={styles.content}>
                {patients.length === 0 && <ViewState state="empty" title="Nessuna scheda attiva disponibile per l’analisi." />}
                <section
                    id="domanda"
                    className={`${surface.tray} ${styles.columns}`}
                    data-record-tray="popolazione"
                    data-testid="analytics-focus-surface"
                    data-lume-analytics-focus="true"
                >
                    <div className={surface.island}>
                        <SectionHeading icon={Users} title="Schede attive nel filtro" />
                        <p
                            className={`${styles.primaryValue} lume-registro`}
                            data-testid="analytics-primary-value"
                            data-lume-register-value="true"
                        >
                            {populationSummary}
                        </p>
                        <p className={styles.mutedNote}>
                            {stats.totalInRange > 0
                                ? `${percent(stats.totalInRange, stats.withBirthDate)}% delle schede con età nota.`
                                : 'Nessuna scheda attiva con età nota rientra nel filtro corrente.'}
                        </p>
                    </div>

                    <div className={`${surface.island} ${styles.filterField}`} data-testid="analytics-filter-field">
                        <SectionHeading icon={Filter} title="Fascia d’età" />
                        <label>
                            <span>Età minima</span>
                            <strong className="lume-registro">{formatCountLabel(ageRange[0], 'anno', 'anni')}</strong>
                            <RangeInput
                                min={0}
                                max={120}
                                aria-label="Età minima"
                                aria-valuetext={formatCountLabel(ageRange[0], 'anno', 'anni')}
                                value={ageRange[0]}
                                onChange={(event) => setAgeRange([Number(event.target.value), ageRange[1]])}
                            />
                        </label>
                        <label>
                            <span>Età massima</span>
                            <strong className="lume-registro">{formatCountLabel(ageRange[1], 'anno', 'anni')}</strong>
                            <RangeInput
                                min={0}
                                max={120}
                                aria-label="Età massima"
                                aria-valuetext={formatCountLabel(ageRange[1], 'anno', 'anni')}
                                value={ageRange[1]}
                                onChange={(event) => setAgeRange([ageRange[0], Number(event.target.value)])}
                            />
                        </label>
                    </div>
                </section>

                <div className={`${surface.tray} ${styles.columns}`} data-record-tray="distribuzione">
                    <section id="indicatori" className={`${surface.island} ${styles.layerSection}`} data-testid="analytics-layer-section">
                        <SectionHeading icon={Activity} title="Profilo della popolazione" />
                        <dl className={styles.factList}>
                            <div className={styles.factRow}>
                                <dt>Assistenza domiciliare integrata</dt>
                                <dd><span className="lume-registro" data-lume-register-value="true">{stats.adiCount}</span> {stats.adiCount === 1 ? 'scheda' : 'schede'}</dd>
                            </div>
                            <div className={styles.factRow}>
                                <dt>Con almeno una diagnosi registrata</dt>
                                <dd><span className="lume-registro" data-lume-register-value="true">{stats.withDiagnoses}</span> {stats.withDiagnoses === 1 ? 'scheda' : 'schede'}</dd>
                            </div>
                            <div className={styles.factRow}>
                                <dt>Senza data di nascita, escluse dal filtro</dt>
                                <dd><span className="lume-registro" data-lume-register-value="true">{stats.withoutBirthDate}</span> {stats.withoutBirthDate === 1 ? 'scheda' : 'schede'}</dd>
                            </div>
                        </dl>
                    </section>

                    <section id="eta" className={`${surface.island} ${styles.layerSection}`}>
                        <SectionHeading icon={BarChart3} title="Distribuzione per fascia d’età" />
                        <div className={styles.chart} aria-label="Distribuzione delle schede per fascia d’età">
                            {Object.entries(stats.ageDist).map(([range, count]) => (
                                <div key={range}>
                                    <div className={styles.chartDatum}>
                                        <span>{range} anni</span>
                                        <strong className="lume-registro" data-lume-register-value="true">{count}</strong>
                                    </div>
                                    <ProgressLine label={`${range} anni`} value={count} total={stats.totalInRange} />
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
                <div className={surface.tray} data-record-tray="diagnosi">
                    <section id="diagnosi" className={`${surface.island} ${styles.layerSection}`}>
                        <SectionHeading icon={ListChecks} title="Diagnosi più ricorrenti" />
                        <div
                            className={styles.tableScroller}
                            data-testid="analytics-table-overflow"
                            data-horizontal-overflow="declared"
                            tabIndex={0}
                            aria-label="Tabella diagnosi"
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
                                            <td className="lume-code" data-lume-register-value="true">{diagnosis.system} {diagnosis.code}</td>
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
                </div>
                <div className={surface.tray} data-record-tray="audit">
                    <section id="audit" className={`${surface.island} ${styles.layerSection}`}>
                        <div className={styles.auditHeading}>
                            <div className={styles.auditContext}>
                                <SectionHeading icon={ShieldCheck} title="Attività della postazione" />
                                <p className={styles.mutedNote}>Lo storico importato è escluso dai conteggi degli eventi locali.</p>
                            </div>
                            <label className={styles.compactField}>
                                <span>{proposal ? 'Periodo' : 'Finestra audit'}</span>
                                <select className={surface.field} aria-label={proposal ? 'Periodo audit' : 'Finestra audit'} value={auditDays} onChange={(event) => setAuditDays(Number(event.target.value))}>
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
                                <dl className={styles.factList}>
                                    <div className={styles.factRow}>
                                        <dt>Eventi locali registrati</dt>
                                        <dd className="lume-registro" data-lume-register-value="true">{auditSummary.totalEvents}</dd>
                                    </div>
                                    <div className={styles.factRow}>
                                        <dt>Completati, errori, negati</dt>
                                        <dd className="lume-registro" data-lume-register-value="true">
                                            {auditSummary.outcomes.success} / {auditSummary.outcomes.failure} / {auditSummary.outcomes.denied}
                                        </dd>
                                    </div>
                                    <div className={styles.factRow}>
                                        <dt>Eventi importati, esaminati separatamente</dt>
                                        <dd>{auditSummary.importedEvents}{auditSummary.importedIsTruncated ? ' o più' : ''}</dd>
                                    </div>
                                    <div className={styles.factRow}>
                                        <dt>Origine non attestata, esaminati separatamente</dt>
                                        <dd>{auditSummary.unattestedEvents}{auditSummary.unattestedIsTruncated ? ' o più' : ''}</dd>
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
                                            {auditSummary.topEventTypes[0] ? `, ${formatCountLabel(auditSummary.topEventTypes[0].count, 'occorrenza', 'occorrenze')}` : ''}
                                        </dd>
                                    </div>
                                </dl>
                                {auditSummary.isTruncated ? (
                                    <p className={styles.mutedNote}>Riepilogo calcolato sui primi 200 eventi locali nel filtro.</p>
                                ) : null}
                            </div>
                        ) : (
                            <p className={styles.emptyState}>Nessun riepilogo audit disponibile.</p>
                        )}
                    </section>
                </div>
            </div>
        </Kree8WorkspaceShell>
    );
}
