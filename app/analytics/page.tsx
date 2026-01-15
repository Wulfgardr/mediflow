'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useState, useMemo } from 'react';
import { ArrowLeft, Users, Activity, Clock, Filter } from 'lucide-react';
import Link from 'next/link';
import { differenceInYears } from 'date-fns';

export default function AnalyticsPage() {
    const patients = useLiveQuery(async () => {
        return await db.patients
            .filter(p => !p.deletedAt && !p.isArchived)
            .toArray();
    });

    // Filters
    const [ageRange, setAgeRange] = useState<[number, number]>([0, 120]);
    // Gender filter removed as unused for now

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
        const takenInCharge = filtered.filter(p => p.monitoringProfile === 'taken_in_charge').length;
        const extemp = filtered.filter(p => p.monitoringProfile === 'extemporaneous').length;

        // 2. Pathologies
        const pathCodes: Record<string, { count: number, desc: string }> = {};
        filtered.forEach(p => {
            p.diagnoses?.forEach(d => {
                const k = d.code;
                if (!pathCodes[k]) pathCodes[k] = { count: 0, desc: d.description };
                pathCodes[k].count++;
            });
        });
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
        <div className="space-y-8 bg-gray-50 min-h-screen p-8">
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
                            value={ageRange[0]}
                            onChange={(e) => setAgeRange([parseInt(e.target.value), ageRange[1]])}
                            className="w-full accent-blue-600"
                        />
                        <input
                            type="range"
                            min="0"
                            max="120"
                            value={ageRange[1]}
                            onChange={(e) => setAgeRange([ageRange[0], parseInt(e.target.value)])}
                            className="w-full accent-blue-600"
                        />
                    </div>
                </div>

                <div className="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg font-mono text-sm">
                    {stats?.total} Pazienti Selezionati
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
                        <div className="bg-blue-500 h-full transition-all duration-1000" style={{ width: `${(stats?.takenInCharge || 0) / (stats?.total || 1) * 100}%` }}></div>
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
                        <div className="bg-orange-500 h-full transition-all duration-1000" style={{ width: `${(stats?.extemp || 0) / (stats?.total || 1) * 100}%` }}></div>
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
                                        className="bg-indigo-500 h-full rounded-full opacity-80"
                                        style={{ width: `${(count / (stats?.total || 1)) * 100}%` }}
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
