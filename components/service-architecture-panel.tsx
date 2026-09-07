'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Server,
    Brain,
    Stethoscope,
    RefreshCw,
    CheckCircle2,
    CircleAlert,
    CircleMinus,
    Loader2,
    ArrowUpRight,
} from 'lucide-react';
import Link from 'next/link';
import { SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';
import styles from './service-architecture-panel.module.css';
import { getICDReadiness, icdClientErrorMessage, icdReadinessMessage } from '@/lib/icd-service';

interface ServiceStatus {
    status: 'running' | 'stopped' | 'checking';
    port: string;
    readiness?: string;
    detail?: string;
    lastCheck?: Date;
}

interface Services {
    app: ServiceStatus;
    ai: ServiceStatus;
    icd: ServiceStatus;
}

export default function ServiceArchitecturePanel() {
    const [services, setServices] = useState<Services>({
        app: { status: 'running', port: '' },
        ai: { status: 'checking', port: '' },
        icd: { status: 'checking', port: '2026-01' }
    });
    const [isRefreshing, setIsRefreshing] = useState(false);

    const checkServices = useCallback(async () => {
        setIsRefreshing(true);
        // @Codex: show the address actually used by this browser, not a default port.
        setServices(prev => ({ ...prev, app: { ...prev.app, port: window.location.origin } }));

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

        // @Codex: readiness only; never send a synthetic diagnosis to WHO.
        try {
            const readiness = await getICDReadiness();
            setServices(prev => ({
                ...prev,
                icd: {
                    ...prev.icd,
                    status: readiness.status === 'available' ? 'running' : 'stopped',
                    port: readiness.releaseId,
                    readiness: readiness.status,
                    detail: icdReadinessMessage(readiness.status),
                    lastCheck: new Date(),
                }
            }));
        } catch (error: unknown) {
            setServices(prev => ({
                ...prev,
                icd: {
                    ...prev.icd,
                    status: 'stopped',
                    detail: icdClientErrorMessage(error),
                    readiness: undefined,
                    lastCheck: new Date(),
                }
            }));
        }

        setIsRefreshing(false);
    }, []);

    useEffect(() => {
        checkServices();
        const interval = setInterval(checkServices, 30000); // Check every 30s
        return () => clearInterval(interval);
    }, [checkServices]);

    /* @Codex: connection checks do not establish model execution or Fabric readiness. */
    const whoDisabled = services.icd.readiness === 'disabled';
    const whoConfigured = services.icd.readiness === 'configured';
    const rows = [
        {
            id: 'app', icon: Server, title: 'MediFlow',
            description: 'La postazione a cui è collegato questo browser.',
            detail: services.app.port || 'Lettura dell’indirizzo…',
            label: 'Pagina aperta', tone: 'neutral', statusIcon: CheckCircle2,
            href: '/settings', action: 'Panoramica',
        },
        {
            id: 'ai', icon: Brain, title: 'Elaborazione locale',
            description: 'Connessione a Ollama per i modelli configurati.',
            detail: 'Il collegamento al servizio non verifica una generazione.',
            label: services.ai.status === 'checking' ? 'In verifica' : services.ai.status === 'running' ? 'Raggiungibile' : 'Non raggiungibile',
            tone: services.ai.status === 'running' ? 'ready' : services.ai.status === 'checking' ? 'neutral' : 'attention',
            statusIcon: services.ai.status === 'checking' ? Loader2 : services.ai.status === 'running' ? CheckCircle2 : CircleAlert,
            href: '/settings/ai/modelli', action: 'Modelli e hardware',
        },
        {
            id: 'icd', icon: Stethoscope, title: 'Terminologia ICD-11',
            description: `Catalogo WHO · release ${services.icd.port}`,
            detail: services.icd.detail || 'Lettura della configurazione del servizio…',
            label: services.icd.status === 'checking' ? 'In verifica' : whoDisabled ? 'Disattivato' : whoConfigured ? 'Da verificare' : services.icd.status === 'running' ? 'Disponibile' : 'Non disponibile',
            tone: whoDisabled || services.icd.status === 'checking' ? 'neutral' : services.icd.status === 'running' ? 'ready' : 'attention',
            statusIcon: services.icd.status === 'checking' ? Loader2 : whoDisabled ? CircleMinus : services.icd.status === 'running' ? CheckCircle2 : CircleAlert,
            href: '/settings/repertori#who-setup', action: 'Configurazione WHO',
        },
    ];

    return (
        <section className={styles.panel} aria-labelledby="service-architecture-title" data-testid="service-architecture-panel">
            <header className={styles.header}>
                <div>
                    <h2 id="service-architecture-title">Servizi della postazione</h2>
                    <p>Controlla i collegamenti e apri le impostazioni del servizio.</p>
                </div>
                <button type="button" onClick={checkServices} disabled={isRefreshing}
                    className={SETTINGS_SECONDARY_BUTTON_CLASS}>
                    <RefreshCw aria-hidden="true" /> Aggiorna stato
                </button>
            </header>
            <ul className={styles.services}>
                {rows.map(({ id, icon: Icon, statusIcon: StatusIcon, ...row }) => (
                    <li key={id} className={styles.service} data-testid={`diagnostic-service-${id}`}>
                        <div className={styles.identity}>
                            <Icon aria-hidden="true" className={styles.icon} />
                            <div>
                                <h3>{row.title}</h3>
                                <p>{row.description}</p>
                                <p className={styles.detail}>{row.detail}</p>
                            </div>
                        </div>
                        <span className={styles.status} data-lume-status data-tone={row.tone}>
                            <StatusIcon aria-hidden="true" /> {row.label}
                        </span>
                        <Link href={row.href} className={SETTINGS_SECONDARY_BUTTON_CLASS}>{row.action}</Link>
                    </li>
                ))}
            </ul>
            <footer className={styles.footer}>
                <p>Per le funzioni intelligenti, verifica modello, interruttori e stato in Intelligence Fabric.</p>
                <Link href="/settings/ai/fabric" className={SETTINGS_SECONDARY_BUTTON_CLASS}>
                    Intelligence Fabric <ArrowUpRight aria-hidden="true" />
                </Link>
            </footer>
        </section>
    );
}
