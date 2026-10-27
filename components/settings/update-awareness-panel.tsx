'use client';

import { useEffect, useState } from 'react';
import { Bell, CheckCircle, CircleAlert, ExternalLink, RefreshCw } from 'lucide-react';
import { ViewState } from '@/components/ui/view-state';
import { SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';
import styles from './evidence-pages.module.css';

type UpdateAwarenessResponse = {
    currentVersion: string; availableVersion: string | null; updateAvailable: boolean;
    source: 'runtime-env' | 'local-manifest' | 'none';
    channel: string; updateUrl: string | null; notes: string[]; changelogTitle: string | null;
    branch?: string; revision?: string;
};

const DISMISSED_VERSION_KEY = 'mediflow-update-dismissed-version';
export default function UpdateAwarenessPanel() {
    const [status, setStatus] = useState<UpdateAwarenessResponse | null>(null);
    const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadStatus = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/system/update-awareness', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            setStatus(await response.json());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Stato aggiornamenti non disponibile');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setDismissedVersion(window.localStorage.getItem(DISMISSED_VERSION_KEY));
        void loadStatus();
    }, []);

    const isDismissed = Boolean(status?.availableVersion && status.availableVersion === dismissedVersion);
    const shouldNotify = Boolean(status?.updateAvailable && !isDismissed);
    const Icon = error ? CircleAlert : loading || !status ? RefreshCw : shouldNotify ? Bell : CheckCircle;

    const dismiss = () => {
        if (!status?.availableVersion) return;
        window.localStorage.setItem(DISMISSED_VERSION_KEY, status.availableVersion);
        setDismissedVersion(status.availableVersion);
    };

    return (
        <section className={styles.section} data-testid="settings-update-awareness-panel" aria-labelledby="settings-update-title" aria-busy={loading}>
            <header className={styles.updateHeader}>
                <div><h3 id="settings-update-title" className={styles.heading}>Aggiornamenti</h3>
                    <p className={styles.updateTitle}>{shouldNotify ? 'Nuova versione disponibile' : 'Stato versione'}</p></div>
                <Icon aria-hidden="true" />
            </header>
            {status ? <div className={styles.updateValues}>
                <p>Versione rilevata <b>{status.currentVersion}</b>
                    {status.availableVersion ? <> - disponibile <b>{status.availableVersion}</b></> : null}</p>
                <p>Canale {status.channel}</p>
                {isDismissed ? <p>Avviso rimandato per questa versione.</p> : null}
                {status.notes[0] ? <p><b>{status.changelogTitle || 'Changelog'}:</b> {status.notes[0]}</p> : null}
            </div> : null}
            {loading ? <ViewState state="loading" title="Lettura stato aggiornamenti..." /> : null}
            {error ? <ViewState state="error" title={status ? 'Impossibile aggiornare lo stato. È mostrato l’ultimo valore letto.' : `Errore: ${error}`}
                detail={status ? `Errore: ${error}` : undefined} /> : null}
            <div className={styles.actions}>
                <button onClick={loadStatus} disabled={loading} className={SETTINGS_SECONDARY_BUTTON_CLASS}>
                    <RefreshCw aria-hidden="true" /> Aggiorna stato
                </button>
                {status?.updateAvailable && status.updateUrl ? <a href={status.updateUrl} target="_blank" rel="noreferrer" className={SETTINGS_SECONDARY_BUTTON_CLASS}>
                    Apri aggiornamento <ExternalLink aria-hidden="true" />
                </a> : null}
                {status?.updateAvailable && !isDismissed ? <button onClick={dismiss} className={SETTINGS_SECONDARY_BUTTON_CLASS}>Piu tardi</button> : null}
            </div>
        </section>
    );
}
