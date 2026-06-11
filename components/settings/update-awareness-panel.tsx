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
const buttonClass =
    'inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/76 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10';

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
                'apple-subsection flex min-h-full flex-col justify-between gap-4',
                shouldNotify
                    ? 'border-amber-200/70 bg-amber-50/70 dark:border-amber-500/20 dark:bg-amber-900/10'
                    : 'border-emerald-200/60 bg-emerald-50/50 dark:border-emerald-500/20 dark:bg-emerald-900/10'
            )}
            data-testid="settings-update-awareness-panel"
        >
            <div className="space-y-3 text-xs leading-5 text-slate-600 dark:text-slate-300">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="section-kicker">Aggiornamenti</p>
                        <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                            {shouldNotify ? 'Nuova versione disponibile' : 'Stato versione'}
                        </h3>
                    </div>
                    <Icon className={cn('h-5 w-5', shouldNotify ? 'text-amber-700' : 'text-emerald-700')} />
                </div>

                {status ? (
                    <>
                        <p>
                            Installata <b className="font-mono text-slate-900 dark:text-white">{status.currentVersion}</b>
                            {status.availableVersion ? <> - disponibile <b className="font-mono text-slate-900 dark:text-white">{status.availableVersion}</b></> : null}
                        </p>
                        <p>
                            Canale {status.channel}
                        </p>
                        {isDismissed ? <p className="text-[11px] font-medium text-slate-500">Avviso rimandato per questa versione.</p> : null}
                        {status.notes[0] ? <p><b className="text-slate-800 dark:text-white">{status.changelogTitle || 'Changelog'}:</b> {status.notes[0]}</p> : null}
                    </>
                ) : (
                    <p className="text-slate-500 dark:text-slate-400">{error ? `Errore: ${error}` : 'Lettura stato aggiornamenti...'}</p>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <button onClick={loadStatus} disabled={loading} className={buttonClass}>
                    <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                    Aggiorna stato
                </button>
                {status?.updateAvailable && status.updateUrl ? (
                    <a href={status.updateUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-900">
                        Apri aggiornamento <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                ) : null}
                {status?.updateAvailable && !isDismissed ? (
                    <button onClick={dismiss} className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/78 px-3 py-2 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-50 dark:border-amber-500/20 dark:bg-white/5 dark:text-amber-200">
                        Piu tardi
                    </button>
                ) : null}
            </div>
        </div>
    );
}
