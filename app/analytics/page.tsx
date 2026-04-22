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
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Link href="/" className="p-2 hover:bg-white rounded-full transition-colors">
                    <ArrowLeft className="w-6 h-6 text-gray-600" />
                </Link>
                <div>
                    <h1 className="text-3xl font-bold text-gray-800">Cruscotto Clinico</h1>
                    <p className="text-gray-500">Analisi avanzata popolazione e patologie</p>
                </div>
            </div>

            {/* Filters Bar */}
            <div className="glass-panel p-6 flex flex-col md:flex-row gap-8 items-center">
                <div className="flex items-center gap-2 text-gray-700 font-bold">
                    <Filter className="w-5 h-5 text-blue-600" />
                    Filtri Popolazione
                </div>

                <div className="flex-1 w-full md:w-auto">
                    <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">Filtra per Età: {ageRange[0]} - {ageRange[1]} anni</label>
                    <div className="flex gap-4 items-center">
                        <input
                            type="range"
                            min="0"
                            max="120"
                            aria-label="Età minima"
                            value={ageRange[0]}
                            onChange={(e) => setAgeRange([parseInt(e.target.value), ageRange[1]])}
                            className="w-full accent-blue-600"
                        />
                        <input
                            type="range"
                            min="0"
                            max="120"
                            aria-label="Età massima"
                            value={ageRange[1]}
                            onChange={(e) => setAgeRange([ageRange[0], parseInt(e.target.value)])}
                            className="w-full accent-blue-600"
                        />
                    </div>
                </div>

                <div className="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg font-mono text-sm">
                    {stats?.total} Pazienti Selezionati
                </div>

                <div className="w-full md:w-auto">
                    <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">Finestra Audit</label>
                    <select
                        aria-label="Finestra audit"
                        value={auditDays}
                        onChange={(event) => setAuditDays(Number(event.target.value))}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm"
                    >
                        <option value={7}>Ultimi 7 giorni</option>
                        <option value={30}>Ultimi 30 giorni</option>
                        <option value={90}>Ultimi 90 giorni</option>
                    </select>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass-panel p-6 border-l-4 border-l-blue-500">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-sm font-bold text-gray-400 uppercase">Presa in Carico</p>
                            <h3 className="text-3xl font-bold text-gray-800 mt-1">{stats?.takenInCharge}</h3>
                        </div>
                        <Users className="w-8 h-8 text-blue-200" />
                    </div>
                    <div className="mt-4 w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div
                            className="bg-blue-500 h-full transition-all duration-1000 w-[var(--prog-width)]"
                            style={{ '--prog-width': `${(stats?.takenInCharge || 0) / (stats?.total || 1) * 100}%` } as React.CSSProperties}
                        ></div>
                    </div>
                    <p className="text-xs text-blue-600 mt-2 font-medium">
                        {Math.round(((stats?.takenInCharge || 0) / (stats?.total || 1)) * 100)}% del totale
                    </p>
                </div>

                <div className="glass-panel p-6 border-l-4 border-l-orange-500">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-sm font-bold text-gray-400 uppercase">Estemporanei</p>
                            <h3 className="text-3xl font-bold text-gray-800 mt-1">{stats?.extemp}</h3>
                        </div>
                        <Activity className="w-8 h-8 text-orange-200" />
                    </div>
                    <div className="mt-4 w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div
                            className="bg-orange-500 h-full transition-all duration-1000 w-[var(--prog-width)]"
                            style={{ '--prog-width': `${(stats?.extemp || 0) / (stats?.total || 1) * 100}%` } as React.CSSProperties}
                        ></div>
                    </div>
                </div>

                <div className="glass-panel p-6 border-l-4 border-l-purple-500">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-sm font-bold text-gray-400 uppercase">Top Patologia</p>
                            <h3 className="text-xl font-bold text-gray-800 mt-1 truncate max-w-[200px]" title={stats?.topPathologies[0]?.desc}>
                                {stats?.topPathologies[0]?.desc || 'N/A'}
                            </h3>
                        </div>
                        <Activity className="w-8 h-8 text-purple-200" />
                    </div>
                    <p className="text-xs text-purple-600 mt-2 font-medium">
                        {stats?.topPathologies[0]?.count || 0} casi registrati
                    </p>
                </div>
            </div>

            <div className="glass-panel p-6 space-y-6">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-emerald-600" />
                            Audit Operativo
                        </h3>
                        <p className="text-sm text-gray-500">
                            KPI PHI-safe sugli ultimi {auditDays} giorni da `audit_events`.
                        </p>
                    </div>
                </div>

                {auditLoading ? (
                    <div className="rounded-xl border border-gray-200 bg-white/70 p-4 text-sm text-gray-500">Caricamento riepilogo audit...</div>
                ) : auditError ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-800 flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{auditError}</span>
                    </div>
                ) : auditSummary ? (
                    <>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Eventi Totali</p>
                                <p className="mt-2 text-3xl font-bold text-emerald-950">{auditSummary.totalEvents}</p>
                            </div>
                            <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Failure + Denied</p>
                                <p className="mt-2 text-3xl font-bold text-amber-950">
                                    {auditSummary.outcomes.failure + auditSummary.outcomes.denied}
                                </p>
                            </div>
                            <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Attori Distinti</p>
                                <p className="mt-2 text-3xl font-bold text-sky-950">{auditSummary.distinctActors}</p>
                            </div>
                            <div className="rounded-2xl border border-violet-100 bg-violet-50/80 p-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Evento Top</p>
                                <p className="mt-2 text-sm font-semibold text-violet-950">
                                    {auditSummary.topEventTypes[0]?.eventType ?? 'Nessuno'}
                                </p>
                                <p className="mt-1 text-xs text-violet-700">
                                    {auditSummary.topEventTypes[0]?.count ?? 0} occorrenze
                                </p>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-gray-200 bg-white/80 p-4 text-sm text-gray-600">
                            <p className="font-semibold text-gray-800">Distribuzione</p>
                            <div className="mt-3 flex flex-wrap gap-4">
                                <span>Success: <strong>{auditSummary.outcomes.success}</strong></span>
                                <span>Failure: <strong>{auditSummary.outcomes.failure}</strong></span>
                                <span>Denied: <strong>{auditSummary.outcomes.denied}</strong></span>
                                <span>Web/API/Native: <strong>{auditSummary.sourceSurfaces.web}/{auditSummary.sourceSurfaces.api}/{auditSummary.sourceSurfaces.native}</strong></span>
                            </div>
                            {auditSummary.isTruncated && (
                                <p className="mt-3 text-xs text-amber-700">
                                    Riepilogo basato su un campione locale limitato agli ultimi 500 eventi filtrati.
                                </p>
                            )}
                        </div>
                    </>
                ) : null}
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* Age Distribution */}
                <div className="glass-panel p-6">
                    <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
                        <Clock className="w-5 h-5 text-gray-400" />
                        Distribuzione Età
                    </h3>

                    <div className="space-y-4">
                        {Object.entries(stats?.ageDist || {}).map(([range, count]) => (
                            <div key={range}>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="font-medium text-gray-600">{range} anni</span>
                                    <span className="font-bold text-gray-800">{count}</span>
                                </div>
                                <div className="w-full bg-gray-100 rounded-full h-3">
                                    <div
                                        className="bg-indigo-500 h-full rounded-full opacity-80 w-[var(--prog-width)]"
                                        style={{ '--prog-width': `${(count / (stats?.total || 1)) * 100}%` } as React.CSSProperties}
                                    ></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Pathologies Ranking */}
                <div className="glass-panel p-6">
                    <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
                        <Activity className="w-5 h-5 text-red-500" />
                        Prevalenza Patologie (ICD-9/10)
                    </h3>

                    <div className="space-y-3 h-64 overflow-y-auto pr-2">
                        {stats?.topPathologies.map((path, idx) => (
                            <div key={idx} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg transition-colors border-b border-gray-50 last:border-0">
                                <div className="w-6 h-6 rounded-full bg-red-100 text-red-700 flex items-center justify-center text-xs font-bold shrink-0">
                                    {idx + 1}
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-gray-800 truncate">{path.desc}</p>
                                </div>
                                <div className="text-sm font-bold text-gray-600">
                                    {path.count} <span className="text-[10px] text-gray-400 font-normal">casi</span>
                                </div>
                            </div>
                        ))}
                        {stats?.topPathologies.length === 0 && (
                            <p className="text-center text-gray-400 italic mt-10">Nessuna patologia codificata registrata.</p>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}
