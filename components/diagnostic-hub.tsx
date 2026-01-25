
'use client';

import { useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Loader2, Play, Server, Database, Activity, Globe } from 'lucide-react';
import { cn } from '@/lib/utils'; // Assuming cn exists, else use template literals

interface ServiceCheck {
    id: string;
    name: string;
    icon: React.ReactNode;
    description: string;
    checkFn: () => Promise<{ status: 'ok' | 'error'; message?: string; latency?: number }>;
}

export default function DiagnosticHub() {
    const [results, setResults] = useState<Record<string, { status: 'idle' | 'running' | 'ok' | 'error'; message?: string; latency?: number }>>({});
    const [isRunningAll, setIsRunningAll] = useState(false);

    const checks: ServiceCheck[] = [
        {
            id: 'db',
            name: 'Database (SQLite)',
            icon: <Database className="w-4 h-4" />,
            description: 'Verifica lettura/scrittura su database locale',
            checkFn: async () => {
                const start = performance.now();
                // We use auth/check as a proxy for DB health since it reads from DB
                const res = await fetch('/api/auth/check');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                await res.json();
                return { status: 'ok', latency: Math.round(performance.now() - start) };
            }
        },
        {
            id: 'ai',
            name: 'AI Neural Engine',
            icon: <Activity className="w-4 h-4" />,
            description: 'Verifica connettività al provider AI (Ollama/MLX)',
            checkFn: async () => {
                const start = performance.now();
                // Dynamically import to ensure client-side execution
                const { AIService } = await import('@/lib/ai-service');
                const ai = await AIService.create(); // Uses saved settings

                // Add timeout
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Timeout (60s)")), 60000)
                );

                const alive = await Promise.race([
                    ai.ping(),
                    timeoutPromise
                ]);

                if (!alive) throw new Error("Ping fallito");
                return { status: 'ok', latency: Math.round(performance.now() - start) };
            }
        },
        {
            id: 'icd',
            name: 'ICD-11 API Proxy',
            icon: <Globe className="w-4 h-4" />,
            description: 'Accesso ai servizi WHO/API locali per le diagnosi',
            checkFn: async () => {
                const start = performance.now();
                const res = await fetch('/api/icd/proxy?q=diabete');
                if (!res.ok) throw new Error("API non raggiungibile");
                const data = await res.json();
                // ICD API returns strict object, not array. Check for generic success keys or just lack of error.
                if (!data || (data.error && data.status !== 'online')) throw new Error("Risposta API invalida");
                return { status: 'ok', latency: Math.round(performance.now() - start) };
            }
        },
        {
            id: 'api',
            name: 'Next.js API Routes',
            icon: <Server className="w-4 h-4" />,
            description: 'Risposta endpoint base',
            checkFn: async () => {
                const start = performance.now();
                const res = await fetch('/api/settings/aiProvider'); // Simple GET
                if (!res.ok) throw new Error("API Error");
                return { status: 'ok', latency: Math.round(performance.now() - start) };
            }
        }
    ];

    const runCheck = async (check: ServiceCheck) => {
        setResults(prev => ({ ...prev, [check.id]: { status: 'running' } }));
        try {
            const res = await check.checkFn();
            setResults(prev => ({ ...prev, [check.id]: { status: 'ok', latency: res.latency, message: res.message } }));
        } catch (e: any) {
            const msg = e?.message || "Errore sconosciuto";
            setResults(prev => ({ ...prev, [check.id]: { status: 'error', message: msg } }));
        }
    };

    const runAll = async () => {
        setIsRunningAll(true);
        // Sequential to avoid slamming the connection pool? Parallel is cooler.
        await Promise.all(checks.map(runCheck));
        setIsRunningAll(false);
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                        <Activity className="w-5 h-5 text-indigo-500" />
                        Diagnostica di Sistema
                    </h2>
                    <p className="text-xs text-gray-500">Verifica lo stato dei sottosistemi.</p>
                </div>
                <button
                    onClick={runAll}
                    disabled={isRunningAll}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 text-sm font-bold shadow-md shadow-indigo-200 dark:shadow-none"
                >
                    {isRunningAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Esegui Test Completo
                </button>
            </div>

            <div className="grid grid-cols-1 gap-3">
                {checks.map(check => {
                    const res = results[check.id] || { status: 'idle' };
                    return (
                        <div key={check.id} className="group flex items-center justify-between p-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 hover:border-indigo-100 transition-all">
                            <div className="flex items-center gap-4">
                                <div className={cn(
                                    "p-2 rounded-lg transition-colors",
                                    res.status === 'ok' ? "bg-green-100 text-green-600" :
                                        res.status === 'error' ? "bg-red-100 text-red-600" :
                                            res.status === 'running' ? "bg-indigo-50 text-indigo-600" :
                                                "bg-gray-100 text-gray-500"
                                )}>
                                    {res.status === 'running' ? <Loader2 className="w-4 h-4 animate-spin" /> :
                                        res.status === 'ok' ? <CheckCircle className="w-4 h-4" /> :
                                            res.status === 'error' ? <XCircle className="w-4 h-4" /> :
                                                check.icon}
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{check.name}</p>
                                    <p className="text-[10px] text-gray-400">{check.description}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                {res.status === 'ok' && (
                                    <span className="text-xs font-mono text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100">
                                        {res.latency}ms
                                    </span>
                                )}
                                {res.status === 'error' && (
                                    <span className="text-xs text-red-500 font-medium max-w-[150px] truncate" title={res.message}>
                                        {res.message}
                                    </span>
                                )}
                                <button
                                    onClick={() => runCheck(check)}
                                    disabled={res.status === 'running'}
                                    className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                    title="Esegui singolo test"
                                >
                                    <Play className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
