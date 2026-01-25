'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { Activity, Brain, Users, FileText, AlertCircle, Clock, CheckCircle } from 'lucide-react';
import Link from 'next/link';
import PrivacyBlur from '@/components/privacy-blur';
import { useClinicalAlerts } from '@/lib/hooks/use-clinical-alerts';

export default function DashboardInsights() {
    // 1. Fetch Global Stats
    const stats = useLiveQuery(async () => {
        const patientCount = await db.patients.filter(p => !p.isArchived).count();
        const entryCount = await db.entries.count();
        const aiInsightCount = await db.patients.filter(p => !p.isArchived && !!p.aiSummary).count();
        const therapyCount = await db.therapies.count();

        return { patientCount, entryCount, aiInsightCount, therapyCount };
    }, []);

    // 2. Proactive Clinical Insights (Calculated on the fly)
    const suggestions = useClinicalAlerts();

    if (!stats) return <div className="p-4 animate-pulse">Caricamento Dashboard...</div>;

    return (
        <div className="space-y-6 mb-8 relative">

            {/* Usage Analytics Strip (Mini Dashboard) */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-white dark:bg-[#161b22] p-4 rounded-xl shadow-sm border border-indigo-50 dark:border-[#30363d] flex flex-col items-center justify-center gap-1">
                    <div className="flex items-center gap-2 text-indigo-600 mb-1">
                        <Users className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase">Pazienti</span>
                    </div>
                    <span className="text-2xl font-bold text-gray-800 dark:text-white">
                        <PrivacyBlur intensity="lg">{stats.patientCount}</PrivacyBlur>
                    </span>
                </div>
                <div className="bg-white dark:bg-[#161b22] p-4 rounded-xl shadow-sm border border-indigo-50 dark:border-[#30363d] flex flex-col items-center justify-center gap-1">
                    <div className="flex items-center gap-2 text-emerald-600 mb-1">
                        <FileText className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase">Voci Diario</span>
                    </div>
                    <span className="text-2xl font-bold text-gray-800 dark:text-white">
                        <PrivacyBlur intensity="lg">{stats.entryCount}</PrivacyBlur>
                    </span>
                </div>
                <div className="bg-white dark:bg-[#161b22] p-4 rounded-xl shadow-sm border border-indigo-50 dark:border-[#30363d] flex flex-col items-center justify-center gap-1">
                    <div className="flex items-center gap-2 text-violet-600 mb-1">
                        <Brain className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase">AI Insights</span>
                    </div>
                    <span className="text-2xl font-bold text-gray-800 dark:text-white">
                        <PrivacyBlur intensity="lg">{stats.aiInsightCount}</PrivacyBlur>
                    </span>
                    <span className="text-[10px] text-gray-400">{(stats.patientCount > 0 ? (stats.aiInsightCount / stats.patientCount * 100).toFixed(0) : 0)}% copertura</span>
                </div>
                <div className="bg-white dark:bg-[#161b22] p-4 rounded-xl shadow-sm border border-indigo-50 dark:border-[#30363d] flex flex-col items-center justify-center gap-1">
                    <div className="flex items-center gap-2 text-amber-600 mb-1">
                        <Activity className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase">Utilizzo</span>
                    </div>
                    {/* Fake Usage Index based on entries per patient */}
                    <span className="text-lg font-bold text-gray-800 dark:text-white">
                        <PrivacyBlur intensity="lg">
                            {(stats.patientCount > 0 ? (stats.entryCount / stats.patientCount).toFixed(1) : 0)}
                        </PrivacyBlur>
                        <span className="text-xs font-normal text-gray-400"> voci/paz</span>
                    </span>
                </div>

                {/* Advanced Analytics Link */}
                <Link href="/analytics" className="bg-indigo-600 hover:bg-indigo-700 p-4 rounded-xl shadow-lg shadow-indigo-200 border border-transparent flex flex-col items-center justify-center gap-2 text-white transition-all transform hover:scale-105 active:scale-95 col-span-2 md:col-span-1">
                    <div className="flex items-center gap-2 mb-1">
                        <Activity className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold uppercase text-center">Analisi Avanzata</span>
                    <span className="text-[10px] opacity-80 text-center">Cruscotto & Report</span>
                </Link>
            </div>

            {/* Proactive Insights Section */}
            {suggestions && (
                <div className={`rounded-2xl p-6 text-white shadow-xl relative overflow-hidden transition-all duration-500 ${suggestions.length > 0
                    ? 'bg-gradient-to-r from-slate-800 to-slate-900'
                    : 'bg-gradient-to-r from-emerald-600 to-teal-700'
                    }`}>

                    <div className="absolute top-0 right-0 p-8 opacity-10">
                        {suggestions.length > 0 ? (
                            <Activity className="w-48 h-48 text-white" />
                        ) : (
                            <CheckCircle className="w-48 h-48 text-white" />
                        )}
                    </div>

                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2 relative z-10">
                        {suggestions.length > 0 ? (
                            <AlertCircle className="w-5 h-5 text-indigo-300" />
                        ) : (
                            <CheckCircle className="w-5 h-5 text-emerald-200" />
                        )}
                        Caposala Digitale
                    </h3>

                    {suggestions.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 relative z-10">
                            {suggestions.map(alert => (
                                <Link href={`/patients/${alert.patientId}`} key={alert.id} className="group">
                                    <div className={`h-full p-4 rounded-xl border backdrop-blur-sm transition-all hover:scale-105 active:scale-95 cursor-pointer ${alert.severity === 'high'
                                        ? 'bg-red-500/20 border-red-500/30 hover:bg-red-500/30'
                                        : 'bg-white/10 border-white/10 hover:bg-white/20'
                                        }`}>
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="font-bold text-sm truncate pr-2">
                                                <PrivacyBlur>{alert.patientName}</PrivacyBlur>
                                            </span>
                                            {alert.type === 'scale' ? <Activity className="w-4 h-4 opacity-70" /> : <Clock className="w-4 h-4 opacity-70" />}
                                        </div>
                                        <p className="text-xs opacity-80 leading-relaxed">
                                            {alert.message}
                                        </p>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <div className="relative z-10 flex flex-col items-start gap-2">
                            <p className="text-lg font-medium text-emerald-50">
                                Tutto in ordine!
                            </p>
                            <p className="text-sm text-emerald-100 max-w-lg">
                                Tutti i pazienti attivi sono stati aggiornati di recente (30gg) e le valutazioni ADI sono in regola. Ottimo lavoro!
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
