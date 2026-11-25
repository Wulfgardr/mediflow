'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import access from '@/components/auth-health-screen.module.css';
import styles from './kree8/kree8-lock-screen.module.css';

export function AppStartupScreen({
    title = 'Avvio di MediFlow',
    message = 'Verifico l’accesso al tuo archivio…',
}: { title?: string; message?: string }) {
    const [takingLonger, setTakingLonger] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => setTakingLonger(true), 12_000);
        return () => window.clearTimeout(timer);
    }, []);

    return (
        <div className={styles.lockShell} data-record-page>
            <section className={styles.lockCard} data-record-island aria-labelledby="mediflow-startup-title">
                <div className={styles.brandRow}>
                    <span className={access.brand} data-record-brand><span className={access.brandGlyph} data-brand-glyph aria-hidden="true"><i /><i /><i /></span>MediFlow</span>
                </div>
                <div className={styles.headerBlock}>
                    <h1 id="mediflow-startup-title" className={styles.title}>{title}</h1>
                </div>
                <p role="status" className="flex items-start gap-3 text-sm leading-6 text-[color:var(--lume-ink-muted)]">
                    <Loader2 className="mt-1 h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
                    {takingLonger ? 'L’avvio sta richiedendo più tempo. Puoi attendere oppure ricaricare la pagina.' : message}
                </p>
                {takingLonger && (
                    <button type="button" className="ui-btn-secondary mt-5 min-h-11 px-4 py-2 text-sm"
                        onClick={() => window.location.reload()}>
                        Ricarica la pagina
                    </button>
                )}
            </section>
        </div>
    );
}
