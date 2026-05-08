'use client';

import { useLiveQuery } from '@/lib/live-query';
import { db } from '@/lib/db';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Activity, Clock, Filter, ShieldCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { differenceInYears } from 'date-fns';

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

export default function AnalyticsPage() {
    const patients = useLiveQuery(async () => {
        return await db.patients
            .filter(p => !p.isArchived)
            .toArray();
    });

    // Filters
    const [ageRange, setAgeRange] = useState<[number, number]>([0, 120]);
    const [auditDays, setAuditDays] = useState(30);
    const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
    const [auditLoading, setAuditLoading] = useState(true);
    const [auditError, setAuditError] = useState<string | null>(null);
    // Gender filter removed as unused for now

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
                        ? 'Solo gli admin possono consultare il cruscotto audit.'
                        : 'Impossibile caricare il riepilogo audit.');
                }

                const payload = await response.json() as AuditSummary;
                if (!active) return;
                setAuditSummary(payload);
            } catch (error) {
                if (controller.signal.aborted || !active) return;
                setAuditError(error instanceof Error ? error.message : 'Impossibile caricare il riepilogo audit.');
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

    // Derived Stats
    const stats = useMemo(() => {
        if (!patients) return null;

        const filtered = patients.filter(p => {
            if (!p.birthDate) return false;
            const age = differenceInYears(new Date(), new Date(p.birthDate));
            return age >= ageRange[0] && age <= ageRange[1];
        });

        // 1. Total & Distribution
        const total = filtered.length;
        // Fields not yet in schema
        const takenInCharge = 0; // filtered.filter(p => p.monitoringProfile === 'taken_in_charge').length;
        const extemp = 0; // filtered.filter(p => p.monitoringProfile === 'extemporaneous').length;

        // 2. Pathologies
        const pathCodes: Record<string, { count: number, desc: string }> = {};
        /*
        filtered.forEach(p => {
            p.diagnoses?.forEach(d => {
                const k = d.code;
                if (!pathCodes[k]) pathCodes[k] = { count: 0, desc: d.description };
                pathCodes[k].count++;
            });
        });
        */
        const topPathologies = Object.values(pathCodes)
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // 3. Age Distribution
        const ageDist = {
            '0-18': 0,
            '19-64': 0,
            '65-80': 0,
            '80+': 0
        };
        filtered.forEach(p => {
            if (!p.birthDate) return;
            const age = differenceInYears(new Date(), new Date(p.birthDate));
            if (age <= 18) ageDist['0-18']++;
            else if (age <= 64) ageDist['19-64']++;
            else if (age <= 80) ageDist['65-80']++;
            else ageDist['80+']++;
        });

        return {
            total,
            takenInCharge,
            extemp,
            topPathologies,
            ageDist
        };
    }, [patients, ageRange]);

    if (!patients) return <div className="p-10 text-center">Caricamento Analisi...</div>;

    return (
        // @Codex WUL-229 — analytics surfaces re-skinned to vitreous tier with MediFlow palette
        <div className="space-y-8">
            <div className="flex items-center gap-4">
                <Link href="/" className="mf-btn-secondary !p-2 !rounded-full" aria-label="Torna alla home">
                    <ArrowLeft className="w-5 h-5" />
                </Link>
                <div>
                    <h1 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--mf-ink)' }}>Cruscotto Clinico</h1>
                    <p style={{ color: 'var(--mf-muted)' }}>Analisi avanzata popolazione e patologie</p>
                </div>
            </div>

            <div className="mf-section flex flex-col md:flex-row gap-8 items-center">
                <div className="flex items-center gap-2 font-semibold" style={{ color: 'var(--mf-ink)' }}>
                    <Filter className="w-5 h-5" style={{ color: 'var(--mf-primary)' }} />
                    Filtri Popolazione
                </div>

                <div className="flex-1 w-full md:w-auto">
                    <label className="mf-eyebrow mb-1 block">Filtra per Età: {ageRange[0]} - {ageRange[1]} anni</label>
                    <div className="flex gap-4 items-center">
                        <input
                            type="range"
                            min="0"
                            max="120"
                            aria-label="Età minima"
                            value={ageRange[0]}
                            onChange={(e) => setAgeRange([parseInt(e.target.value), ageRange[1]])}
                            className="w-full"
                            style={{ accentColor: 'var(--mf-primary)' }}
                        />
                        <input
                            type="range"
                            min="0"
                            max="120"
                            aria-label="Età massima"
                            value={ageRange[1]}
                            onChange={(e) => setAgeRange([ageRange[0], parseInt(e.target.value)])}
                            className="w-full"
                            style={{ accentColor: 'var(--mf-primary)' }}
                        />
                    </div>
                </div>

                <div
                    className="px-4 py-2 rounded-full font-mono text-sm"
                    style={{
                        background: 'rgba(15, 123, 104, 0.12)',
                        color: 'var(--mf-primary)',
                        border: '1px solid rgba(15, 123, 104, 0.22)'
                    }}
                >
                    {stats?.total} Pazienti Selezionati
                </div>

                <div className="w-full md:w-auto">
                    <label className="mf-eyebrow mb-1 block">Finestra Audit</label>
                    <select
                        aria-label="Finestra audit"
                        value={auditDays}
                        onChange={(event) => setAuditDays(Number(event.target.value))}
                        className="mf-input mf-input-sm appearance-none cursor-pointer"
                    >
                        <option value={7}>Ultimi 7 giorni</option>
                        <option value={30}>Ultimi 30 giorni</option>
                        <option value={90}>Ultimi 90 giorni</option>
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div
                    className="mf-section border-l-[3px]"
                    style={{ borderLeftColor: 'var(--mf-primary)' }}
                >
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="mf-eyebrow">Presa in Carico</p>
                            <h3 className="text-3xl font-semibold mt-1" style={{ color: 'var(--mf-ink)' }}>{stats?.takenInCharge}</h3>
                        </div>
                        <Users className="w-7 h-7" style={{ color: 'rgba(15, 123, 104, 0.4)' }} />
                    </div>
                    <div className="mt-4 w-full rounded-full h-1.5 overflow-hidden" style={{ background: 'rgba(112, 106, 100, 0.18)' }}>
                        <div
                            className="h-full transition-all duration-1000 w-[var(--prog-width)]"
                            style={{
                                '--prog-width': `${(stats?.takenInCharge || 0) / (stats?.total || 1) * 100}%`,
                                background: 'linear-gradient(90deg, var(--mf-primary), #2aa37e)'
                            } as React.CSSProperties}
                        ></div>
                    </div>
                    <p className="text-xs mt-2 font-medium" style={{ color: 'var(--mf-primary)' }}>
                        {Math.round(((stats?.takenInCharge || 0) / (stats?.total || 1)) * 100)}% del totale
                    </p>
                </div>

                <div
                    className="mf-section border-l-[3px]"
                    style={{ borderLeftColor: 'var(--mf-warning)' }}
                >
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="mf-eyebrow">Estemporanei</p>
                            <h3 className="text-3xl font-semibold mt-1" style={{ color: 'var(--mf-ink)' }}>{stats?.extemp}</h3>
                        </div>
                        <Activity className="w-7 h-7" style={{ color: 'rgba(202, 138, 4, 0.5)' }} />
                    </div>
                    <div className="mt-4 w-full rounded-full h-1.5 overflow-hidden" style={{ background: 'rgba(112, 106, 100, 0.18)' }}>
                        <div
                            className="h-full transition-all duration-1000 w-[var(--prog-width)]"
                            style={{
                                '--prog-width': `${(stats?.extemp || 0) / (stats?.total || 1) * 100}%`,
                                background: 'linear-gradient(90deg, var(--mf-warning), #d8a13a)'
                            } as React.CSSProperties}
                        ></div>
                    </div>
                </div>

                <div
                    className="mf-section border-l-[3px]"
                    style={{ borderLeftColor: 'var(--mf-plum)' }}
                >
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="mf-eyebrow">Top Patologia</p>
                            <h3 className="text-xl font-semibold mt-1 truncate max-w-[200px]" title={stats?.topPathologies[0]?.desc} style={{ color: 'var(--mf-ink)' }}>
                                {stats?.topPathologies[0]?.desc || 'N/A'}
                            </h3>
                        </div>
                        <Activity className="w-7 h-7" style={{ color: 'rgba(94, 53, 95, 0.45)' }} />
                    </div>
                    <p className="text-xs mt-2 font-medium" style={{ color: 'var(--mf-plum)' }}>
                        {stats?.topPathologies[0]?.count || 0} casi registrati
                    </p>
                </div>
            </div>

            <div className="mf-section space-y-6">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--mf-ink)' }}>
                            <ShieldCheck className="w-5 h-5" style={{ color: 'var(--mf-success)' }} />
                            Audit Operativo
                        </h3>
                        <p className="text-sm" style={{ color: 'var(--mf-muted)' }}>
                            KPI PHI-safe sugli ultimi {auditDays} giorni da `audit_events`.
                        </p>
                    </div>
                </div>

                {auditLoading ? (
                    <div className="mf-section mf-section-tight text-sm" style={{ color: 'var(--mf-muted)' }}>Caricamento riepilogo audit...</div>
                ) : auditError ? (
                    <div className="mf-alert mf-alert-warning">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{auditError}</span>
                    </div>
                ) : auditSummary ? (
                    <>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                            <div
                                className="rounded-2xl p-4"
                                style={{ background: 'rgba(15, 123, 104, 0.08)', border: '1px solid rgba(15, 123, 104, 0.18)' }}
                            >
                                <p className="mf-eyebrow" style={{ color: 'var(--mf-primary)' }}>Eventi Totali</p>
                                <p className="mt-2 text-3xl font-semibold" style={{ color: 'var(--mf-ink)' }}>{auditSummary.totalEvents}</p>
                            </div>
                            <div
                                className="rounded-2xl p-4"
                                style={{ background: 'rgba(202, 138, 4, 0.1)', border: '1px solid rgba(202, 138, 4, 0.2)' }}
                            >
                                <p className="mf-eyebrow" style={{ color: 'var(--mf-warning)' }}>Failure + Denied</p>
                                <p className="mt-2 text-3xl font-semibold" style={{ color: 'var(--mf-ink)' }}>
                                    {auditSummary.outcomes.failure + auditSummary.outcomes.denied}
                                </p>
                            </div>
                            <div
                                className="rounded-2xl p-4"
                                style={{ background: 'rgba(15, 123, 104, 0.06)', border: '1px solid rgba(15, 123, 104, 0.16)' }}
                            >
                                <p className="mf-eyebrow" style={{ color: 'var(--mf-primary)' }}>Attori Distinti</p>
                                <p className="mt-2 text-3xl font-semibold" style={{ color: 'var(--mf-ink)' }}>{auditSummary.distinctActors}</p>
                            </div>
                            <div
                                className="rounded-2xl p-4"
                                style={{ background: 'rgba(94, 53, 95, 0.1)', border: '1px solid rgba(94, 53, 95, 0.2)' }}
                            >
                                <p className="mf-eyebrow" style={{ color: 'var(--mf-plum)' }}>Evento Top</p>
                                <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--mf-ink)' }}>
                                    {auditSummary.topEventTypes[0]?.eventType ?? 'Nessuno'}
                                </p>
                                <p className="mt-1 text-xs" style={{ color: 'var(--mf-plum)' }}>
                                    {auditSummary.topEventTypes[0]?.count ?? 0} occorrenze
                                </p>
                            </div>
                        </div>

                        <div className="mf-section mf-section-tight text-sm" style={{ color: 'var(--mf-muted)' }}>
                            <p className="font-semibold" style={{ color: 'var(--mf-ink)' }}>Distribuzione</p>
                            <div className="mt-3 flex flex-wrap gap-4">
                                <span>Success: <strong>{auditSummary.outcomes.success}</strong></span>
                                <span>Failure: <strong>{auditSummary.outcomes.failure}</strong></span>
                                <span>Denied: <strong>{auditSummary.outcomes.denied}</strong></span>
                                <span>Web/API/Native: <strong>{auditSummary.sourceSurfaces.web}/{auditSummary.sourceSurfaces.api}/{auditSummary.sourceSurfaces.native}</strong></span>
                            </div>
                            {auditSummary.isTruncated && (
                                <p className="mt-3 text-xs" style={{ color: 'var(--mf-warning)' }}>
                                    Riepilogo basato su un campione locale limitato agli ultimi 500 eventi filtrati.
                                </p>
                            )}
                        </div>
                    </>
                ) : null}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="mf-section">
                    <h3 className="text-lg font-semibold mb-6 flex items-center gap-2" style={{ color: 'var(--mf-ink)' }}>
                        <Clock className="w-5 h-5" style={{ color: 'var(--mf-muted)' }} />
                        Distribuzione Età
                    </h3>

                    <div className="space-y-4">
                        {Object.entries(stats?.ageDist || {}).map(([range, count]) => (
                            <div key={range}>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="font-medium" style={{ color: 'var(--mf-muted)' }}>{range} anni</span>
                                    <span className="font-semibold" style={{ color: 'var(--mf-ink)' }}>{count}</span>
                                </div>
                                <div className="w-full rounded-full h-3" style={{ background: 'rgba(112, 106, 100, 0.18)' }}>
                                    <div
                                        className="h-full rounded-full w-[var(--prog-width)]"
                                        style={{
                                            '--prog-width': `${(count / (stats?.total || 1)) * 100}%`,
                                            background: 'linear-gradient(90deg, var(--mf-plum), #7a4f7c)'
                                        } as React.CSSProperties}
                                    ></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mf-section">
                    <h3 className="text-lg font-semibold mb-6 flex items-center gap-2" style={{ color: 'var(--mf-ink)' }}>
                        <Activity className="w-5 h-5" style={{ color: 'var(--mf-critical)' }} />
                        Prevalenza Patologie (ICD-9/10)
                    </h3>

                    <div className="space-y-1 h-64 overflow-y-auto pr-2">
                        {stats?.topPathologies.map((path, idx) => (
                            <div key={idx} className="mf-popover-row">
                                <div
                                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                                    style={{ background: 'rgba(192, 57, 43, 0.12)', color: 'var(--mf-critical)' }}
                                >
                                    {idx + 1}
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-medium truncate" style={{ color: 'var(--mf-ink)' }}>{path.desc}</p>
                                </div>
                                <div className="text-sm font-semibold" style={{ color: 'var(--mf-muted)' }}>
                                    {path.count} <span className="text-[10px] font-normal" style={{ color: 'var(--mf-muted)' }}>casi</span>
                                </div>
                            </div>
                        ))}
                        {stats?.topPathologies.length === 0 && (
                            <p className="text-center italic mt-10" style={{ color: 'var(--mf-muted)' }}>Nessuna patologia codificata registrata.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
