'use client';

/* @Codex */
import { useEffect, useState } from 'react';
import { Bell, CheckCircle, ExternalLink, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

type UpdateAwarenessResponse = {
    currentVersion: string; availableVersion: string | null; updateAvailable: boolean;
    source: 'runtime-env' | 'local-manifest' | 'none';
    channel: string; updateUrl: string | null; notes: string[]; changelogTitle: string | null;
    branch?: string; revision?: string;
};

const DISMISSED_VERSION_KEY = 'mediflow-update-dismissed-version';
const buttonClass = 'mf-btn-secondary lume-press px-3 py-2 text-xs';

function sourceLabel(source: UpdateAwarenessResponse['source']) {
    return source === 'local-manifest' ? 'manifest locale' : source === 'runtime-env' ? 'runtime locale' : 'nessun manifest';
}

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
    const Icon = shouldNotify ? Bell : CheckCircle;

    const dismiss = () => {
        if (!status?.availableVersion) return;
        window.localStorage.setItem(DISMISSED_VERSION_KEY, status.availableVersion);
        setDismissedVersion(status.availableVersion);
    };

    return (
        <div
            className={cn(
                'mf-section flex min-h-full flex-col justify-between gap-4',
                shouldNotify
                    ? 'border-amber-200/70 bg-amber-50/70 dark:border-amber-500/20 dark:bg-amber-900/10'
                    : 'border-emerald-200/60 bg-emerald-50/50 dark:border-emerald-500/20 dark:bg-emerald-900/10'
            )}
            data-testid="settings-update-awareness-panel"
        >
            <div className="space-y-3 text-xs leading-5" style={{ color: 'var(--lume-ink-muted)' }}>
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="section-kicker">Aggiornamenti</p>
                        <h3 className="mt-1 text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>
                            {shouldNotify ? 'Nuova versione disponibile' : 'Stato versione'}
                        </h3>
                    </div>
                    <Icon className={cn('h-5 w-5', shouldNotify ? 'text-amber-700' : 'text-emerald-700')} />
                </div>

                {status ? (
                    <>
                        <p>
                            Installata <b className="lume-registro" style={{ color: 'var(--lume-ink)' }}>{status.currentVersion}</b>
                            {status.availableVersion ? <> - disponibile <b className="lume-registro" style={{ color: 'var(--lume-ink)' }}>{status.availableVersion}</b></> : null}
                        </p>
                        <p>
                            Canale {status.channel}
                        </p>
                        {isDismissed ? <p className="text-[11px] font-medium">Avviso rimandato per questa versione.</p> : null}
                        {status.notes[0] ? <p><b style={{ color: 'var(--lume-ink)' }}>{status.changelogTitle || 'Changelog'}:</b> {status.notes[0]}</p> : null}
                    </>
                ) : (
                    <p>{error ? `Errore: ${error}` : 'Lettura stato aggiornamenti...'}</p>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <button onClick={loadStatus} disabled={loading} className={buttonClass}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Aggiorna stato
                </button>
                {status?.updateAvailable && status.updateUrl ? (
                    <a href={status.updateUrl} target="_blank" rel="noreferrer" className="ui-btn-primary lume-press px-3 py-2 text-xs">
                        Apri aggiornamento <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                ) : null}
                {status?.updateAvailable && !isDismissed ? (
                    <button onClick={dismiss} className="mf-btn-secondary lume-press border-amber-200 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/20 dark:text-amber-200">
                        Piu tardi
                    </button>
                ) : null}
            </div>
        </div>
    );
}
