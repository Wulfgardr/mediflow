
'use client';

import { useState } from 'react';
import { CheckCircle, XCircle, Loader2, Play, Server, Database, Activity, Globe } from 'lucide-react';
import { getICDReadiness, icdReadinessMessage } from '@/lib/icd-service';
import { checkAuthHealthRequest } from '@/lib/security/client-auth-api';
import { SETTINGS_PRIMARY_BUTTON_CLASS } from '@/components/settings/settings-ui';
import styles from '@/components/settings/evidence-pages.module.css';

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
            name: 'Controllo autenticazione',
            icon: <Database className="w-4 h-4" />,
            description: 'Verifica la risposta del controllo di autenticazione.',
            checkFn: async () => {
                const start = performance.now();
                // We use auth/check as a proxy for DB health since it reads from DB
                const { response: res, payload: data, controlState } = await checkAuthHealthRequest();
                if (controlState !== 'accepted') throw new Error('Controllo autenticazione non verificabile');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                if (data?.status === 'error' || data?.error) {
                    throw new Error(data?.error?.message || 'Database non disponibile');
                }
                return { status: 'ok', latency: Math.round(performance.now() - start) };
            }
        },
        {
            id: 'ai',
            name: 'Provider AI',
            icon: <Activity className="w-4 h-4" />,
            description: 'Controlla l’elenco dei modelli del provider configurato, senza generare contenuti.',
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
            name: 'ICD-11 WHO',
            icon: <Globe className="w-4 h-4" />,
            description: 'Controlla disponibilità e configurazione, senza eseguire ricerche.',
            checkFn: async () => {
                const start = performance.now();
                const readiness = await getICDReadiness();
                if (readiness.status !== 'available') throw new Error(icdReadinessMessage(readiness.status));
                return {
                    status: 'ok',
                    latency: Math.round(performance.now() - start),
                    message: icdReadinessMessage(readiness.status),
                };
            }
        },
        {
            id: 'api',
            name: 'Impostazioni AI',
            icon: <Server className="w-4 h-4" />,
            description: 'Controlla la risposta alla richiesta delle impostazioni del provider AI.',
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
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : "Errore sconosciuto";
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
        <div className={styles.checks}>
            <header className={styles.checkHeader}>
                <p>Verifica lo stato dei sottosistemi.</p>
                <button onClick={runAll} disabled={isRunningAll} className={SETTINGS_PRIMARY_BUTTON_CLASS} data-settings-primary="true">
                    {isRunningAll ? <Loader2 aria-hidden="true" /> : <Play aria-hidden="true" />}
                    Esegui Test Completo
                </button>
            </header>
            <ul className={styles.checkList}>
                {checks.map(check => {
                    const res = results[check.id] || { status: 'idle' };
                    return <li key={check.id} className={styles.checkRow} data-diagnostic-check={check.id}>
                        <div className={styles.checkIdentity}>
                            <span className={styles.checkIcon} data-status={res.status} aria-hidden="true">
                                {res.status === 'running' ? <Loader2 /> : res.status === 'ok' ? <CheckCircle /> : res.status === 'error' ? <XCircle /> : check.icon}
                            </span>
                            <div><h4>{check.name}</h4><p>{check.description}</p></div>
                        </div>
                        <div className={styles.checkResult} role={res.status === 'error' ? 'alert' : 'status'}>
                            {res.status === 'idle' && <p>Non ancora verificato</p>}
                            {res.status === 'running' && <p>Verifica in corso</p>}
                            {res.status === 'ok' && <p>Risposta ricevuta in {res.latency} ms</p>}
                            {res.message && <p data-status={res.status}>{res.message}</p>}
                        </div>
                        <button type="button" onClick={() => runCheck(check)} disabled={res.status === 'running'}
                            className={styles.checkAction} aria-label={`Esegui singolo test: ${check.name}`} title="Esegui singolo test">
                            <Play aria-hidden="true" />
                        </button>
                    </li>;
                })}
            </ul>
        </div>
    );
}
