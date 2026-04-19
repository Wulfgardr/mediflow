'use client';

/* @Codex */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock3, FolderArchive, RefreshCw, Save } from 'lucide-react';

type BackupSchedulerResponse = {
    supported: boolean;
    installed: boolean;
    plistPath: string | null;
    state: {
        config: {
            enabled: boolean;
            hour: number;
            minute: number;
            destinationDir: string;
            retentionKeepArtifacts: number;
        };
        run: {
            lastRunAt: string | null;
            lastRunStatus: 'success' | 'error' | null;
            lastRunMessage: string | null;
            lastArtifactPath: string | null;
            lastRetentionAt: string | null;
            lastRetentionDeletedCount: number | null;
            lastRetentionDeletedBytes: number | null;
            lastRetentionMode: 'auto' | 'manual' | null;
        };
    };
};

type BackupRetentionPreview = {
    destinationDir: string;
    keepArtifacts: number;
    artifactCount: number;
    orphanTempCount: number;
    deleteCount: number;
    deleteBytes: number;
    items: Array<{
        path: string;
        kind: 'artifact' | 'temp';
        reason: 'keep-last-n' | 'orphan-temp';
        sizeBytes: number;
        modifiedAt: string | null;
    }>;
};

function toTimeValue(hour: number, minute: number): string {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatBytes(value: number): string {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

const INPUT_CLASS = 'mt-1 w-full rounded-2xl border border-white/70 bg-white/76 p-3 text-sm text-slate-800 shadow-[0_10px_22px_rgba(15,23,42,0.05)] outline-none backdrop-blur-md transition-all focus:border-white focus:ring-2 focus:ring-sky-500/20 dark:border-white/10 dark:bg-white/5 dark:text-slate-100';
const PRIMARY_BUTTON_CLASS = 'inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,#4F46E5,#818CF8)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(79,70,229,0.24)] transition-all hover:-translate-y-0.5 hover:shadow-[0_20px_36px_rgba(79,70,229,0.3)] disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY_BUTTON_CLASS = 'inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/76 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-[0_10px_22px_rgba(15,23,42,0.04)] backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-white hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-white/20';

export default function BackupSchedulerUI() {
    const [status, setStatus] = useState<BackupSchedulerResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [isPreviewingRetention, setIsPreviewingRetention] = useState(false);
    const [isApplyingRetention, setIsApplyingRetention] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
    const [enabled, setEnabled] = useState(false);
    const [time, setTime] = useState('02:00');
    const [destinationDir, setDestinationDir] = useState('');
    const [retentionKeepArtifacts, setRetentionKeepArtifacts] = useState(14);
    const [retentionPreview, setRetentionPreview] = useState<BackupRetentionPreview | null>(null);

    const load = async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/api/system/backup-scheduler', { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || 'Failed to load backup scheduler status.');
            setStatus(payload);
            setEnabled(Boolean(payload.state.config.enabled));
            setTime(toTimeValue(payload.state.config.hour, payload.state.config.minute));
            setDestinationDir(payload.state.config.destinationDir);
            setRetentionKeepArtifacts(payload.state.config.retentionKeepArtifacts);
        } catch (error) {
            const text = error instanceof Error ? error.message : 'Errore caricamento backup automatico.';
            setMessage({ type: 'error', text });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const timeParts = useMemo(() => {
        const [hourString = '02', minuteString = '00'] = time.split(':');
        return {
            hour: Number.parseInt(hourString, 10) || 2,
            minute: Number.parseInt(minuteString, 10) || 0,
        };
    }, [time]);

    const save = async () => {
        setIsSaving(true);
        setMessage(null);
        try {
            const response = await fetch('/api/system/backup-scheduler', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save',
                    config: {
                        enabled,
                        hour: timeParts.hour,
                        minute: timeParts.minute,
                        destinationDir,
                        retentionKeepArtifacts,
                    },
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || 'Salvataggio configurazione fallito.');
            setStatus(payload);
            setRetentionPreview(null);
            setMessage({ type: 'success', text: enabled ? 'Backup automatico attivato.' : 'Backup automatico disattivato.' });
        } catch (error) {
            const text = error instanceof Error ? error.message : 'Salvataggio configurazione fallito.';
            setMessage({ type: 'error', text });
        } finally {
            setIsSaving(false);
        }
    };

    const runNow = async () => {
        setIsRunning(true);
        setMessage(null);
        try {
            const response = await fetch('/api/system/backup-scheduler', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'run-now' }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.result?.message || payload?.error || 'Esecuzione backup fallita.');
            setStatus(payload.status);
            setMessage({ type: 'success', text: payload.result?.message || 'Backup completato.' });
        } catch (error) {
            const text = error instanceof Error ? error.message : 'Esecuzione backup fallita.';
            setMessage({ type: 'error', text });
            await load();
        } finally {
            setIsRunning(false);
        }
    };

    const previewRetention = async () => {
        setIsPreviewingRetention(true);
        setMessage(null);
        try {
            const response = await fetch('/api/system/backup-scheduler', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'preview-retention',
                    config: {
                        enabled,
                        hour: timeParts.hour,
                        minute: timeParts.minute,
                        destinationDir,
                        retentionKeepArtifacts,
                    },
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || 'Anteprima retention fallita.');
            setRetentionPreview(payload.retention);
            setMessage({ type: 'info', text: payload.retention.deleteCount > 0 ? 'Anteprima retention aggiornata.' : 'Nessun file da rimuovere con la policy corrente.' });
        } catch (error) {
            const text = error instanceof Error ? error.message : 'Anteprima retention fallita.';
            setMessage({ type: 'error', text });
        } finally {
            setIsPreviewingRetention(false);
        }
    };

    const applyRetention = async () => {
        setIsApplyingRetention(true);
        setMessage(null);
        try {
            const response = await fetch('/api/system/backup-scheduler', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'apply-retention',
                    config: {
                        enabled,
                        hour: timeParts.hour,
                        minute: timeParts.minute,
                        destinationDir,
                        retentionKeepArtifacts,
                    },
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || 'Pulizia retention fallita.');
            setStatus(payload.status);
            setRetentionPreview(null);
            const deletedCount = payload?.retention?.deletedCount ?? 0;
            const deletedBytes = payload?.retention?.deletedBytes ?? 0;
            setMessage({
                type: 'success',
                text: deletedCount > 0
                    ? `Retention applicata: rimossi ${deletedCount} file (${formatBytes(deletedBytes)}).`
                    : 'Retention applicata: nessun file rimosso.',
            });
        } catch (error) {
            const text = error instanceof Error ? error.message : 'Pulizia retention fallita.';
            setMessage({ type: 'error', text });
            await load();
        } finally {
            setIsApplyingRetention(false);
        }
    };

    const lastRun = status?.state.run;

    return (
        <div className="glass-panel p-6 md:p-7 space-y-5">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="section-kicker">Continuità operativa</p>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Clock3 className="w-5 h-5 text-indigo-500" />
                        Backup automatico notturno
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                        Thin slice `macOS home base`: usa un LaunchAgent utente e un runner headless locale.
                    </p>
                </div>
                {status && (
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${status.installed ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-500/20 dark:bg-green-900/10 dark:text-green-300' : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'}`}>
                        {status.installed ? 'Installato' : 'Non installato'}
                    </span>
                )}
            </div>

            {!isLoading && status && !status.supported && (
                <div className="rounded-[18px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-900/10 dark:text-amber-200">
                    Il backup automatico di questa slice e supportato solo su macOS.
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="flex items-center gap-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => setEnabled(event.target.checked)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    Attiva backup notturno
                </label>

                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Orario
                    <input
                        type="time"
                        value={time}
                        onChange={(event) => setTime(event.target.value)}
                        className={INPUT_CLASS}
                    />
                </label>

                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Destinazione
                    <input
                        type="text"
                        value={destinationDir}
                        onChange={(event) => setDestinationDir(event.target.value)}
                        placeholder="/Users/.../Backups/MediFlow"
                        className={INPUT_CLASS}
                    />
                </label>

                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Mantieni ultimi backup
                    <input
                        type="number"
                        min={1}
                        max={365}
                        value={retentionKeepArtifacts}
                        onChange={(event) => setRetentionKeepArtifacts(Math.max(1, Number.parseInt(event.target.value || '1', 10) || 1))}
                        className={INPUT_CLASS}
                    />
                </label>
            </div>

            <div className="rounded-[22px] border border-slate-200/70 bg-white/72 px-4 py-3 text-sm text-slate-700 shadow-[0_10px_22px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                La retention automatica e limitata ai file `mediflow-backup-v1-*.mediflow` e ai `.tmp` orfani nella cartella configurata. Nessun allegato clinico o file arbitrario viene toccato.
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <button
                    onClick={save}
                    disabled={isSaving}
                    className={PRIMARY_BUTTON_CLASS}
                >
                    {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Salva schedulazione
                </button>
                <button
                    onClick={runNow}
                    disabled={isRunning}
                    className={SECONDARY_BUTTON_CLASS}
                >
                    {isRunning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FolderArchive className="w-4 h-4" />}
                    Esegui adesso
                </button>
                <button
                    onClick={previewRetention}
                    disabled={isPreviewingRetention}
                    className={SECONDARY_BUTTON_CLASS}
                >
                    {isPreviewingRetention ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Anteprima retention
                </button>
                <button
                    onClick={applyRetention}
                    disabled={isApplyingRetention}
                    className={SECONDARY_BUTTON_CLASS}
                >
                    {isApplyingRetention ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FolderArchive className="w-4 h-4" />}
                    Applica pulizia
                </button>
            </div>

            {lastRun && (
                <div className="apple-subsection space-y-1 text-sm text-gray-700 dark:text-gray-300">
                    <p><strong>Ultimo run:</strong> {lastRun.lastRunAt ?? 'mai eseguito'}</p>
                    <p><strong>Esito:</strong> {lastRun.lastRunStatus ?? 'n/d'}</p>
                    {lastRun.lastRunMessage && <p><strong>Messaggio:</strong> {lastRun.lastRunMessage}</p>}
                    {lastRun.lastArtifactPath && <p><strong>Artifact:</strong> <code>{lastRun.lastArtifactPath}</code></p>}
                    {lastRun.lastRetentionAt && (
                        <p>
                            <strong>Ultima retention:</strong> {lastRun.lastRetentionAt}
                            {' '}({lastRun.lastRetentionMode ?? 'n/d'}, rimossi {lastRun.lastRetentionDeletedCount ?? 0} file, {formatBytes(lastRun.lastRetentionDeletedBytes ?? 0)})
                        </p>
                    )}
                    {status?.plistPath && <p><strong>LaunchAgent:</strong> <code>{status.plistPath}</code></p>}
                </div>
            )}

            {retentionPreview && (
                <div className="apple-subsection space-y-2 text-sm text-gray-700 dark:text-gray-300">
                    <p><strong>Anteprima retention:</strong> {retentionPreview.deleteCount} file candidati, {formatBytes(retentionPreview.deleteBytes)} totali.</p>
                    <p><strong>Policy:</strong> mantieni ultimi {retentionPreview.keepArtifacts} artifact nella cartella {retentionPreview.destinationDir}</p>
                    <p><strong>Inventario:</strong> {retentionPreview.artifactCount} artifact gestiti, {retentionPreview.orphanTempCount} `.tmp` orfani</p>
                    {retentionPreview.items.length > 0 && (
                        <div className="space-y-1">
                            {retentionPreview.items.slice(0, 5).map((item) => (
                                <p key={item.path}>
                                    <code>{item.path}</code> · {item.reason === 'keep-last-n' ? 'eccede keep-last-N' : 'tmp orfano'} · {formatBytes(item.sizeBytes)}
                                </p>
                            ))}
                            {retentionPreview.items.length > 5 && (
                                <p>Altri {retentionPreview.items.length - 5} file non mostrati.</p>
                            )}
                        </div>
                    )}
                </div>
            )}

            {message && (
                <div className={`rounded-[18px] border px-4 py-3 flex items-center gap-2 text-sm ${
                    message.type === 'success'
                        ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-500/20 dark:bg-green-900/10 dark:text-green-300'
                        : message.type === 'error'
                            ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-900/10 dark:text-red-300'
                            : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-900/10 dark:text-blue-300'
                }`}>
                    {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    <span>{message.text}</span>
                </div>
            )}
        </div>
    );
}
