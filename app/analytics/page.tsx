'use client';

import { Kree8WorkspaceShell } from '@/components/kree8/kree8-workspace-shell';
import { db, type Diagnosis, type Patient } from '@/lib/db';
import { useLiveQuery } from '@/lib/live-query';
import { differenceInYears } from 'date-fns';
import { Activity, AlertTriangle, ClipboardList, Clock, Filter, ShieldCheck, Stethoscope, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

/* @Codex */
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
    { href: '#popolazione', label: 'Popolazione', meta: 'filtri' },
    { href: '#indicatori', label: 'Indicatori', meta: 'schede' },
    { href: '#audit', label: 'Audit', meta: 'tracciato' },
    { href: '#eta', label: 'Età', meta: 'fasce' },
    { href: '#diagnosi', label: 'Diagnosi', meta: 'top 10' },
];

const EMPTY_AGE_DIST: Record<AgeBucket, number> = {
    '0-18': 0,
    '19-64': 0,
    '65-80': 0,
    '80+': 0,
};

type ToneKey = 'info' | 'success' | 'warning' | 'critical';

const K8_TONES: Record<ToneKey, { accent: string; soft: string; line: string }> = {
    info: {
        accent: '#1d4ed8',
        soft: '#dbeafe',
        line: 'rgba(29, 78, 216, 0.24)',
    },
    success: {
        accent: '#15803d',
        soft: '#dcfce7',
        line: 'rgba(21, 128, 61, 0.24)',
    },
    warning: {
        accent: '#92400e',
        soft: '#fef3c7',
        line: 'rgba(146, 64, 14, 0.24)',
    },
    critical: {
        accent: '#9a3412',
        soft: '#ffe2dd',
        line: 'rgba(154, 52, 18, 0.24)',
    },
};

function normalizeAgeRange(range: [number, number]) {
    return range[0] <= range[1] ? range : [range[1], range[0]];
}

function toDate(value: Patient['birthDate']) {
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

function diagnosisKey(diagnosis: Diagnosis) {
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

        if (patient.diagnoses?.length) {
            withDiagnoses += 1;
            for (const diagnosis of patient.diagnoses) {
                const key = diagnosisKey(diagnosis);
                const current = diagnosisCounts.get(key);
                if (current) {
                    current.count += 1;
                } else {
                    diagnosisCounts.set(key, {
                        key,
                        description: diagnosis.description?.trim() || diagnosis.code || 'Diagnosi senza descrizione',
                        system: diagnosis.system?.trim() || 'ICD',
                        code: diagnosis.code?.trim() || 'n/d',
                        count: 1,
                    });
                }
            }
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
            .sort((a, b) => b.count - a.count)
            .slice(0, 10),
    };
}

function percent(part: number, total: number) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
}

function ProgressLine({ value, total, tone }: { value: number; total: number; tone: ToneKey }) {
    return (
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--lume-ink) 12%, transparent)' }}>
            <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{ width: `${percent(value, total)}%`, background: K8_TONES[tone].accent }}
            />
        </div>
    );
}

export default function AnalyticsPage() {
    const patients = useLiveQuery(async () => {
        return await db.patients
            .filter((patient) => !patient.isArchived)
            .toArray();
    });

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
                if (!active) return;
                setAuditSummary(payload);
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
    const stats = useMemo(() => {
        if (!patients) return null;
        return buildAnalyticsStats(patients, ageRange);
    }, [patients, ageRange]);

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
                <div className="mf-section p-6 text-sm" style={{ color: 'var(--lume-ink-muted)' }}>
                    Sto preparando il cruscotto locale.
                </div>
            </Kree8WorkspaceShell>
        );
    }

    const topDiagnosis = stats.topDiagnoses[0];

    return (
        <Kree8WorkspaceShell
            eyebrow="Analisi"
            title="Cruscotto locale"
            subtitle="Popolazione registrata e audit operativo, senza dati fuori dal dispositivo."
            backHref="/?area=incarico"
            backLabel="Torna ai pazienti"
            statusLabel={`${stats.totalInRange} schede in ${normalizedAgeRange[0]}-${normalizedAgeRange[1]} anni · ${stats.withoutBirthDate} senza data nascita`}
            navItems={ANALYTICS_NAV_ITEMS}
        >
            <section id="popolazione" className="mf-section lume-focal space-y-5 p-5 scroll-mt-32">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div className="min-w-0">
                        <p className="section-kicker">Popolazione</p>
                        <h2 className="mt-1 text-xl font-semibold" style={{ color: 'var(--lume-ink)' }}>Filtro età</h2>
                        <p className="mt-1 text-sm" style={{ color: 'var(--lume-ink-muted)' }}>
                            Il filtro considera le schede attive con data di nascita compilata.
                        </p>
                    </div>
                    <div
                        className="inline-flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                        style={{
                            background: K8_TONES.info.soft,
                            color: K8_TONES.info.accent,
                            border: `1px solid ${K8_TONES.info.line}`,
                        }}
                    >
                        <Filter className="h-4 w-4" />
                        {normalizedAgeRange[0]}-{normalizedAgeRange[1]} anni
                    </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px] lg:items-end">
                    <div className="grid min-w-0 gap-4">
                        <label className="min-w-0">
                            <span className="mf-eyebrow mb-2 flex items-center justify-between gap-3">
                                <span>Età minima</span>
                                <strong className="lume-registro">{ageRange[0]} anni</strong>
                            </span>
                            <input
                                type="range"
                                min="0"
                                max="120"
                                aria-label="Età minima"
                                value={ageRange[0]}
                                onChange={(event) => setAgeRange([Number(event.target.value), ageRange[1]])}
                                className="w-full"
                                style={{ accentColor: K8_TONES.info.accent }}
                            />
                        </label>
                        <label className="min-w-0">
                            <span className="mf-eyebrow mb-2 flex items-center justify-between gap-3">
                                <span>Età massima</span>
                                <strong className="lume-registro">{ageRange[1]} anni</strong>
                            </span>
                            <input
                                type="range"
                                min="0"
                                max="120"
                                aria-label="Età massima"
                                value={ageRange[1]}
                                onChange={(event) => setAgeRange([ageRange[0], Number(event.target.value)])}
                                className="w-full"
                                style={{ accentColor: K8_TONES.info.accent }}
                            />
                        </label>
                    </div>
                    <label>
                        <span className="mf-eyebrow mb-2 block">Finestra audit</span>
                        <select
                            aria-label="Finestra audit"
                            value={auditDays}
                            onChange={(event) => setAuditDays(Number(event.target.value))}
                            className="mf-input mf-input-sm w-full cursor-pointer appearance-none"
                        >
                            <option value={7}>Ultimi 7 giorni</option>
                            <option value={30}>Ultimi 30 giorni</option>
                            <option value={90}>Ultimi 90 giorni</option>
                        </select>
                    </label>
                </div>
            </section>

            <section id="indicatori" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 scroll-mt-32">
                <div className="mf-section p-5">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="mf-eyebrow">Schede nel filtro</p>
                            <p className="lume-registro mt-2 text-3xl font-semibold" style={{ color: 'var(--lume-ink)' }}>{stats.totalInRange}</p>
                        </div>
                        <Users className="h-7 w-7" style={{ color: K8_TONES.info.accent }} />
                    </div>
                    <ProgressLine value={stats.totalInRange} total={Math.max(stats.withBirthDate, 1)} tone="info" />
                    <p className="mt-2 text-xs font-medium" style={{ color: K8_TONES.info.accent }}>
                        {percent(stats.totalInRange, stats.withBirthDate)}% delle schede con età nota
                    </p>
                </div>

                <div className="mf-section p-5">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="mf-eyebrow">ADI attive</p>
                            <p className="lume-registro mt-2 text-3xl font-semibold" style={{ color: 'var(--lume-ink)' }}>{stats.adiCount}</p>
                        </div>
                        <Stethoscope className="h-7 w-7" style={{ color: K8_TONES.warning.accent }} />
                    </div>
                    <ProgressLine value={stats.adiCount} total={stats.totalInRange} tone="warning" />
                    <p className="mt-2 text-xs font-medium" style={{ color: K8_TONES.warning.accent }}>
                        {percent(stats.adiCount, stats.totalInRange)}% delle schede filtrate
                    </p>
                </div>

                <div className="mf-section p-5">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="mf-eyebrow">Con diagnosi</p>
                            <p className="lume-registro mt-2 text-3xl font-semibold" style={{ color: 'var(--lume-ink)' }}>{stats.withDiagnoses}</p>
                        </div>
                        <ClipboardList className="h-7 w-7" style={{ color: K8_TONES.success.accent }} />
                    </div>
                    <ProgressLine value={stats.withDiagnoses} total={stats.totalInRange} tone="success" />
                    <p className="mt-2 text-xs font-medium" style={{ color: K8_TONES.success.accent }}>
                        {percent(stats.withDiagnoses, stats.totalInRange)}% delle schede filtrate
                    </p>
                </div>

                <div className="mf-section p-5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="mf-eyebrow">Diagnosi più ricorrente</p>
                            <p className="mt-2 truncate text-base font-semibold" title={topDiagnosis?.description} style={{ color: 'var(--lume-ink)' }}>
                                {topDiagnosis?.description ?? 'Non disponibile'}
                            </p>
                        </div>
                        <Activity className="h-7 w-7 shrink-0" style={{ color: K8_TONES.critical.accent }} />
                    </div>
                    <p className="mt-4 text-xs font-medium" style={{ color: K8_TONES.critical.accent }}>
                        {topDiagnosis ? `${topDiagnosis.count} schede · ${topDiagnosis.system} ${topDiagnosis.code}` : 'Nessuna diagnosi codificata nel filtro'}
                    </p>
                </div>
            </section>

            <section id="audit" className="mf-section space-y-5 p-5 scroll-mt-32">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                        <p className="section-kicker">Audit</p>
                        <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold" style={{ color: 'var(--lume-ink)' }}>
                            <ShieldCheck className="h-5 w-5" style={{ color: K8_TONES.success.accent }} />
                            Attività locale
                        </h2>
                        <p className="mt-1 text-sm" style={{ color: 'var(--lume-ink-muted)' }}>
                            Log operativo degli ultimi {auditDays} giorni, senza contenuti clinici.
                        </p>
                    </div>
                </div>

                {auditLoading ? (
                    <div className="mf-section mf-section-tight p-4 text-sm" style={{ color: 'var(--lume-ink-muted)' }}>Sto leggendo il tracciato locale...</div>
                ) : auditError ? (
                    <div
                        className="flex gap-2 rounded-[18px] border p-4 text-sm"
                        style={{
                            background: K8_TONES.warning.soft,
                            borderColor: K8_TONES.warning.line,
                            color: K8_TONES.warning.accent,
                        }}
                    >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{auditError}</span>
                    </div>
                ) : auditSummary ? (
                    <>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            <AuditCard label="Eventi" value={auditSummary.totalEvents} tone="info" />
                            <AuditCard label="Completati" value={auditSummary.outcomes.success} tone="success" />
                            <AuditCard label="Attori" value={auditSummary.distinctActors} tone="info" />
                            <AuditCard
                                label="Evento più frequente"
                                value={auditSummary.topEventTypes[0]?.eventType ?? 'Nessuno'}
                                note={`${auditSummary.topEventTypes[0]?.count ?? 0} occorrenze`}
                                tone="critical"
                            />
                        </div>

                        <div className="mf-section mf-section-tight p-4 text-sm" style={{ color: 'var(--lume-ink-muted)' }}>
                            <p className="font-semibold" style={{ color: 'var(--lume-ink)' }}>Esiti e origine</p>
                            <div className="mt-3 flex flex-wrap gap-4">
                                <span>Completati: <strong className="lume-registro">{auditSummary.outcomes.success}</strong></span>
                                <span>Errori: <strong className="lume-registro">{auditSummary.outcomes.failure}</strong></span>
                                <span>Negati: <strong className="lume-registro">{auditSummary.outcomes.denied}</strong></span>
                                <span>Web/API/Native: <strong className="lume-registro">{auditSummary.sourceSurfaces.web}/{auditSummary.sourceSurfaces.api}/{auditSummary.sourceSurfaces.native}</strong></span>
                            </div>
                            {auditSummary.isTruncated && (
                                <p className="mt-3 text-xs" style={{ color: K8_TONES.warning.accent }}>
                                    Riepilogo calcolato sui primi 500 eventi nel filtro.
                                </p>
                            )}
                        </div>
                    </>
                ) : null}
            </section>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <section id="eta" className="mf-section p-5 scroll-mt-32">
                    <h2 className="flex items-center gap-2 text-lg font-semibold" style={{ color: 'var(--lume-ink)' }}>
                        <Clock className="h-5 w-5" style={{ color: 'var(--lume-ink-muted)' }} />
                        Fasce d’età
                    </h2>

                    <div className="mt-5 space-y-4">
                        {Object.entries(stats.ageDist).map(([range, count]) => (
                            <div key={range}>
                                <div className="mb-1 flex justify-between gap-4 text-sm">
                                    <span className="font-medium" style={{ color: 'var(--lume-ink-muted)' }}>{range} anni</span>
                                    <span className="lume-registro font-semibold" style={{ color: 'var(--lume-ink)' }}>{count}</span>
                                </div>
                                <ProgressLine value={count} total={stats.totalInRange} tone="info" />
                            </div>
                        ))}
                    </div>
                </section>

                <section id="diagnosi" className="mf-section p-5 scroll-mt-32">
                    <h2 className="flex items-center gap-2 text-lg font-semibold" style={{ color: 'var(--lume-ink)' }}>
                        <Activity className="h-5 w-5" style={{ color: K8_TONES.critical.accent }} />
                        Diagnosi registrate
                    </h2>

                    <div className="mt-5 max-h-72 space-y-2 overflow-y-auto pr-2">
                        {stats.topDiagnoses.map((diagnosis, index) => (
                            <div
                                key={diagnosis.key}
                                className="flex items-center gap-3 rounded-[14px] border p-3"
                                style={{
                                    background: 'var(--lume-surface-field)',
                                    borderColor: 'color-mix(in srgb, var(--lume-ink) 12%, transparent)',
                                }}
                            >
                                <div
                                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                                    style={{ background: K8_TONES.critical.soft, color: K8_TONES.critical.accent }}
                                >
                                    {index + 1}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium" style={{ color: 'var(--lume-ink)' }}>{diagnosis.description}</p>
                                    <p className="lume-registro text-xs" style={{ color: 'var(--lume-ink-muted)' }}>{diagnosis.system} {diagnosis.code}</p>
                                </div>
                                <div className="lume-registro text-sm font-semibold" style={{ color: 'var(--lume-ink-muted)' }}>
                                    {diagnosis.count} <span className="text-[10px] font-normal">schede</span>
                                </div>
                            </div>
                        ))}
                        {stats.topDiagnoses.length === 0 && (
                            <p className="mt-10 text-center text-sm italic" style={{ color: 'var(--lume-ink-muted)' }}>
                                Nessuna diagnosi codificata nel filtro corrente.
                            </p>
                        )}
                    </div>
                </section>
            </div>
        </Kree8WorkspaceShell>
    );
}

function AuditCard({
    label,
    value,
    note,
    tone,
}: {
    label: string;
    value: number | string;
    note?: string;
    tone: ToneKey;
}) {
    const palette = K8_TONES[tone];

    return (
        <div
            className="rounded-[var(--lume-radius-card)] p-4"
            style={{
                background: 'var(--lume-surface-field)',
                border: '1px solid color-mix(in srgb, var(--lume-ink) 12%, transparent)',
                boxShadow: 'none',
            }}
        >
            <p className="mf-eyebrow" style={{ color: palette.accent }}>{label}</p>
            <p className="lume-registro mt-2 truncate text-2xl font-semibold" title={String(value)} style={{ color: 'var(--lume-ink)' }}>{value}</p>
            {note ? <p className="mt-1 text-xs" style={{ color: palette.accent }}>{note}</p> : null}
        </div>
    );
}
