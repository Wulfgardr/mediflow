'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Server,
    Brain,
    Stethoscope,
    Play,
    RefreshCw,
    CheckCircle2,
    XCircle,
    Loader2,
    ExternalLink,
    Copy,
    Check
} from 'lucide-react';

interface ServiceStatus {
    status: 'running' | 'stopped' | 'checking';
    url: string;
    port: string;
    env: 'native' | 'docker';
    lastCheck?: Date;
}

interface Services {
    app: ServiceStatus;
    ai: ServiceStatus;
    icd: ServiceStatus;
}

export default function ServiceArchitecturePanel() {
    const [services, setServices] = useState<Services>({
        app: { status: 'running', url: 'http://localhost', port: '3000', env: 'native' },
        ai: { status: 'checking', url: 'http://127.0.0.1', port: '11434', env: 'native' },
        icd: { status: 'checking', url: 'http://localhost', port: '8888', env: 'docker' }
    });
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

    const checkServices = useCallback(async () => {
        setIsRefreshing(true);

        // Check AI (Ollama)
        try {
            // Dynamically import to ensure client-side execution and correct settings resolution
            const { AIService } = await import('@/lib/ai-service');
            const ai = await AIService.create();

            // Add timeout (60s to match DiagnosticHub)
            const timeoutPromise = new Promise<boolean>((_, reject) =>
                setTimeout(() => reject(new Error("Timeout (60s)")), 60000)
            );

            const alive = await Promise.race([
                ai.ping(),
                timeoutPromise
            ]);

            setServices(prev => ({
                ...prev,
                ai: { ...prev.ai, status: alive ? 'running' : 'stopped', lastCheck: new Date() }
            }));
        } catch {
            setServices(prev => ({
                ...prev,
                ai: { ...prev.ai, status: 'stopped', lastCheck: new Date() }
            }));
        }

        // Check ICD-11
        try {
            const icdResponse = await fetch('/api/icd/proxy?uri=/icd/release/11/2024-01/mms', {
                signal: AbortSignal.timeout(5000)
            });
            setServices(prev => ({
                ...prev,
                icd: { ...prev.icd, status: icdResponse.ok ? 'running' : 'stopped', lastCheck: new Date() }
            }));
        } catch {
            setServices(prev => ({
                ...prev,
                icd: { ...prev.icd, status: 'stopped', lastCheck: new Date() }
            }));
        }

        setIsRefreshing(false);
    }, []);

    useEffect(() => {
        checkServices();
        const interval = setInterval(checkServices, 30000); // Check every 30s
        return () => clearInterval(interval);
    }, [checkServices]);

    const copyCommand = (command: string, id: string) => {
        navigator.clipboard.writeText(command);
        setCopiedCommand(id);
        setTimeout(() => setCopiedCommand(null), 2000);
    };

    const getStatusIcon = (status: ServiceStatus['status']) => {
        switch (status) {
            case 'running':
                return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
            case 'stopped':
                return <XCircle className="w-4 h-4 text-red-500" />;
            case 'checking':
                return <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />;
        }
    };

    const getStatusColor = (status: ServiceStatus['status']) => {
        switch (status) {
            case 'running':
                return 'border-emerald-500/50 bg-emerald-500/5';
            case 'stopped':
                return 'border-red-500/50 bg-red-500/5';
            case 'checking':
                return 'border-amber-500/50 bg-amber-500/5';
        }
    };

    const getStatusText = (status: ServiceStatus['status']) => {
        switch (status) {
            case 'running':
                return 'Attivo';
            case 'stopped':
                return 'Spento';
            case 'checking':
                return 'Verifica...';
        }
    };

    return (
        <div className="glass-panel p-6 mb-6">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl text-white">
                        <Server className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-800 dark:text-white">Architettura Servizi</h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Visualizza lo stato dei componenti MediFlow</p>
                    </div>
                </div>
                <button
                    onClick={checkServices}
                    disabled={isRefreshing}
                    className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                    title="Aggiorna stato"
                >
                    <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Visual Architecture */}
            <div className="relative">
                {/* Connection Lines (SVG) */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
                    {/* App (Center) to AI (Left) */}
                    <line
                        x1="50%" y1="50%" x2="16.666%" y2="50%"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        className="text-gray-300 dark:text-gray-600"
                    />
                    {/* App (Center) to ICD (Right) */}
                    <line
                        x1="50%" y1="50%" x2="83.333%" y2="50%"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        className="text-gray-300 dark:text-gray-600"
                    />
                </svg>

                {/* Service Nodes */}
                <div className="grid grid-cols-3 gap-4 relative z-10">

                    {/* AI Node (Moved to First) */}
                    <div className={`rounded-2xl border-2 p-4 transition-all ${getStatusColor(services.ai.status)}`}>
                        <div className="flex flex-col items-center text-center space-y-2">
                            <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-xl">
                                <Brain className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                            </div>
                            <div>
                                <h3 className="font-bold text-gray-800 dark:text-white">AI Engine</h3>
                                <p className="text-xs text-gray-500">Ollama</p>
                            </div>
                            <div className="text-xs font-mono text-gray-600 dark:text-gray-400">
                                :{services.ai.port}
                            </div>
                            <div className="flex items-center gap-1.5">
                                {getStatusIcon(services.ai.status)}
                                <span className="text-xs font-medium">{getStatusText(services.ai.status)}</span>
                            </div>
                            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded-full">
                                {services.ai.env}
                            </span>

                            {services.ai.status === 'stopped' && (
                                <div className="mt-2 space-y-2 w-full">
                                    <button
                                        onClick={() => copyCommand('ollama serve', 'ai')}
                                        className="w-full px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                                    >
                                        {copiedCommand === 'ai' ? (
                                            <><Check className="w-3 h-3" /> Copiato!</>
                                        ) : (
                                            <><Copy className="w-3 h-3" /> ollama serve</>
                                        )}
                                    </button>
                                    <a
                                        href="https://ollama.com"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[10px] text-purple-600 hover:underline flex items-center justify-center gap-1"
                                    >
                                        <ExternalLink className="w-3 h-3" /> Scarica Ollama
                                    </a>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* App Node (Moved to Center) */}
                    <div className={`rounded-2xl border-2 p-4 transition-all ${getStatusColor(services.app.status)}`}>
                        <div className="flex flex-col items-center text-center space-y-2">
                            <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
                                <Server className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                                <h3 className="font-bold text-gray-800 dark:text-white">App</h3>
                                <p className="text-xs text-gray-500">Next.js</p>
                            </div>
                            <div className="text-xs font-mono text-gray-600 dark:text-gray-400">
                                :{services.app.port}
                            </div>
                            <div className="flex items-center gap-1.5">
                                {getStatusIcon(services.app.status)}
                                <span className="text-xs font-medium">{getStatusText(services.app.status)}</span>
                            </div>
                            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-full">
                                {services.app.env}
                            </span>
                        </div>
                    </div>

                    {/* ICD Node (Right) */}
                    <div className={`rounded-2xl border-2 p-4 transition-all ${getStatusColor(services.icd.status)}`}>
                        <div className="flex flex-col items-center text-center space-y-2">
                            <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl">
                                <Stethoscope className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <div>
                                <h3 className="font-bold text-gray-800 dark:text-white">ICD-11</h3>
                                <p className="text-xs text-gray-500">WHO API</p>
                            </div>
                            <div className="text-xs font-mono text-gray-600 dark:text-gray-400">
                                :{services.icd.port}
                            </div>
                            <div className="flex items-center gap-1.5">
                                {getStatusIcon(services.icd.status)}
                                <span className="text-xs font-medium">{getStatusText(services.icd.status)}</span>
                            </div>
                            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 rounded-full">
                                {services.icd.env}
                            </span>

                            {services.icd.status === 'stopped' && (
                                <div className="mt-2 space-y-2 w-full">
                                    <button
                                        onClick={() => copyCommand('docker compose up -d icd-api', 'icd')}
                                        className="w-full px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                                    >
                                        {copiedCommand === 'icd' ? (
                                            <><Check className="w-3 h-3" /> Copiato!</>
                                        ) : (
                                            <><Play className="w-3 h-3" /> Avvia Docker</>
                                        )}
                                    </button>
                                    <p className="text-[10px] text-gray-500">
                                        docker compose up -d icd-api
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Legend */}
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-white/10">
                <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-gray-500">
                    <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Attivo</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5 text-red-500" />
                        <span>Spento</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 text-amber-500" />
                        <span>Verifica...</span>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                        <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded">NATIVO</span>
                        <span>= Sul tuo Mac</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 rounded">DOCKER</span>
                        <span>= In container</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
