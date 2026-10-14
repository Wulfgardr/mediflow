'use client';

/* @Codex */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock3, FolderArchive, RefreshCw, Save } from 'lucide-react';
import styles from '@/components/settings/settings-lume.module.css';

type BackupSchedulerResponse = {
    supported: boolean;
    installed: boolean | null;
    observationMessage?: string;
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

const INPUT_CLASS = 'mf-input mt-1 p-3';
const PRIMARY_BUTTON_CLASS = 'ui-btn-primary lume-press px-5 py-2.5 disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY_BUTTON_CLASS = 'mf-btn-secondary lume-press px-4 py-2.5 disabled:cursor-not-allowed disabled:opacity-50';

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
            setStatus(null);
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
            if (!response.ok) {
                throw new Error(payload?.error || 'Esito non confermato. Rileggi lo stato prima di ripetere il salvataggio.');
            }
            setStatus(payload);
            setRetentionPreview(null);
            setMessage({ type: 'success', text: enabled ? 'Backup automatico attivato.' : 'Backup automatico disattivato.' });
        } catch (error) {
            setStatus(previous => previous ? { ...previous, installed: null } : null);
            const text = error instanceof Error ? error.message : 'Esito non confermato. Rileggi lo stato prima di ripetere il salvataggio.';
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
    /* @Codex: scheduling registration is platform-specific; manual run and retention stay available everywhere */
    const schedulingUnsupported = Boolean(status && !status.supported);

    return (
        <div className={styles.backupSchedule}>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="section-kicker">Continuità operativa</p>
                    <h3 className="flex items-center gap-2 text-lg font-bold" style={{ color: 'var(--lume-ink)' }}>
                        <Clock3 className="w-5 h-5 text-[color:var(--lume-ink-secondary)]" />
                        Backup automatico notturno
                    </h3>
                    <p className="mt-2 text-sm" style={{ color: 'var(--lume-ink-muted)' }}>
                        Schedulazione cross-platform: LaunchAgent su macOS, Task Scheduler su Windows, systemd-timer o cron su Linux. Il runner headless locale e lo stesso ovunque.
                    </p>
                </div>
                {status && (
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${status.installed ? 'graphite-chip-tone-success' : 'graphite-chip-tone-muted'}`}>
                        {status.installed === null ? 'Stato non confermato' : status.installed ? 'Installato' : 'Non installato'}
                    </span>
                )}
            </div>

            {status?.observationMessage && <p role="alert" className="text-sm text-[color:var(--lume-signal-warning)]">{status.observationMessage}</p>}
            {!isLoading && schedulingUnsupported && (
                <div className="mf-alert mf-alert-warning px-3 py-2 text-sm">
                    Lo scheduling automatico non e disponibile su questa piattaforma. Puoi comunque eseguire il backup manuale con «Esegui adesso» e usare la pulizia retention.
                </div>
            )}

            <div className={styles.backupFields}>
                <label className={styles.backupField}>
                    <span>Attiva backup notturno</span>
                    <input
                        type="checkbox"
                        checked={enabled}
                        disabled={schedulingUnsupported}
                        onChange={(event) => setEnabled(event.target.checked)}
                        className="rounded border-[color:var(--lume-rule-strong)] accent-[color:var(--lume-ink-fresh)] focus:ring-[color:var(--lume-ink-fresh)] disabled:opacity-50"
                    />
                </label>

                <label className={styles.backupField}>
                    Orario
                    <input
                        type="time"
                        value={time}
                        disabled={schedulingUnsupported}
                        onChange={(event) => setTime(event.target.value)}
                        className={INPUT_CLASS}
                    />
                </label>

                <label className={styles.backupField}>
                    Destinazione
                    <input
                        type="text"
                        value={destinationDir}
                        onChange={(event) => setDestinationDir(event.target.value)}
                        placeholder="Percorso assoluto della cartella backup"
                        className={INPUT_CLASS}
                    />
                </label>

                <label className={styles.backupField}>
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

            <div className={styles.supportingCopy}>
                La retention automatica e limitata ai file `mediflow-backup-v1-*.mediflow` e ai `.tmp` orfani nella cartella configurata. Nessun allegato clinico o file arbitrario viene toccato.
            </div>

            <div className={styles.backupActions}>
                <button type="button" onClick={() => void load()} disabled={isLoading || isSaving || isRunning} className={SECONDARY_BUTTON_CLASS}>
                    <RefreshCw className="w-4 h-4" /> Rileggi stato
                </button>
                <button
                    onClick={save}
                    disabled={isSaving || isLoading || !status || status.installed === null || schedulingUnsupported}
                    className={PRIMARY_BUTTON_CLASS}
                >
                    {isSaving ? <RefreshCw className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                    Salva schedulazione
                </button>
            </div>
            <div className={styles.backupActionRow}><span>Backup manuale</span>
                <button
                    onClick={runNow}
                    disabled={isRunning}
                    className={SECONDARY_BUTTON_CLASS}
                >
                    {isRunning ? <RefreshCw className="w-4 h-4" /> : <FolderArchive className="w-4 h-4" />}
                    Esegui adesso
                </button>
            </div>
            <div className={styles.backupActionRow}><span>Pulizia degli archivi precedenti</span>
                <button
                    onClick={previewRetention}
                    disabled={isPreviewingRetention}
                    className={SECONDARY_BUTTON_CLASS}
                >
                    {isPreviewingRetention ? <RefreshCw className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                    Anteprima retention
                </button>
                <button
                    onClick={applyRetention}
                    disabled={isApplyingRetention}
                    className={SECONDARY_BUTTON_CLASS}
                >
                    {isApplyingRetention ? <RefreshCw className="w-4 h-4" /> : <FolderArchive className="w-4 h-4" />}
                    Applica pulizia
                </button>
            </div>

            {lastRun && (
                <div className="mf-section mf-section-tight space-y-1 text-sm" style={{ color: 'var(--lume-ink-muted)' }}>
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
                <div className="mf-section mf-section-tight space-y-2 text-sm" style={{ color: 'var(--lume-ink-muted)' }}>
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
                <div role={message.type === 'error' ? 'alert' : 'status'} className={`mf-alert px-4 py-3 flex items-center gap-2 text-sm ${
                    message.type === 'success'
                        ? 'mf-alert-success'
                        : message.type === 'error'
                            ? 'mf-alert-critical'
                            : 'mf-alert-info'
                }`}>
                    {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    <span>{message.text}</span>
                </div>
            )}
        </div>
    );
}
