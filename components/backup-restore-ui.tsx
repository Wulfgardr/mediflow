'use client';

import { useState } from 'react';
import { Download, Upload, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';
import { BackupRestorePreflightError, exportRawDatabase, importRawDatabase } from '@/lib/db';
import { useSecurity } from './security-provider';

// WUL-297 — parola chiave richiesta per confermare il restore.
const RESTORE_CONFIRM_KEYWORD = 'RIPRISTINA';

export default function BackupRestoreUI() {
    const { isAuthenticated, lock } = useSecurity();
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState<{
        type: 'success' | 'error' | 'info';
        message: string;
        preflight?: BackupRestorePreflightError['preflight'];
    } | null>(null);
    const [pendingRestoreFile, setPendingRestoreFile] = useState<File | null>(null);
    const [restoreConfirmText, setRestoreConfirmText] = useState('');

    const handleExport = async () => {
        setIsLoading(true);
        setStatus(null);
        try {
            const json = await exportRawDatabase();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `mediflow-backup-v1-${new Date().toISOString().slice(0, 10)}.mediflow`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setStatus({ type: 'success', message: 'Backup scaricato con successo! Conservalo al sicuro.' });
        } catch (e) {
            console.error(e);
            setStatus({ type: 'error', message: 'Errore durante l\'export del backup.' });
        } finally {
            setIsLoading(false);
        }
    };

    // WUL-297 — il ripristino è un'operazione critica: la conferma richiede
    // di digitare una parola chiave invece del vecchio confirm() del browser.
    const handleRestoreFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // Reset input
        if (!file) return;

        setStatus(null);
        setRestoreConfirmText('');
        setPendingRestoreFile(file);
    };

    const cancelRestore = () => {
        setPendingRestoreFile(null);
        setRestoreConfirmText('');
    };

    const restoreConfirmed = restoreConfirmText.trim().toUpperCase() === RESTORE_CONFIRM_KEYWORD;

    const confirmRestore = async () => {
        if (!pendingRestoreFile || !restoreConfirmed || isLoading) return;

        setIsLoading(true);
        setStatus({ type: 'info', message: 'Ripristino in corso...' });

        try {
            const text = await pendingRestoreFile.text();
            await importRawDatabase(text);
            setStatus({ type: 'success', message: 'Ripristino completato! L\'applicazione verrà bloccata per ricaricare le chiavi.' });

            // Wait a sec then lock/reload
            setTimeout(() => {
                lock();
                window.location.reload();
            }, 2000);

        } catch (err) {
            console.error(err);
            const preflight = err instanceof BackupRestorePreflightError ? err.preflight : undefined;
            const message = err instanceof Error
                ? err.message
                : 'Errore durante il ripristino. Il file potrebbe essere corrotto.';
            setStatus({ type: 'error', message, preflight });
        } finally {
            setIsLoading(false);
            setPendingRestoreFile(null);
            setRestoreConfirmText('');
        }
    };

    if (!isAuthenticated) return null;

    return (
        <div className="grid gap-6 xl:grid-cols-2">
            <div className="mediflow-vitreous-panel glass-panel border p-6 md:p-7">
                <p className="section-kicker">Export locale</p>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Download className="w-5 h-5 text-blue-500" />
                    Backup
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 mb-4">
                    Scarica un artifact <code>.mediflow</code> v1 con manifest e checksum. Il ripristino valida formato, versione e integrità prima di sovrascrivere i dati.
                    <br />
                    <span className="font-bold text-amber-600 dark:text-amber-500">Nota:</span> il restore copre le collezioni esportabili via API locale; i dati non validi vengono rifiutati prima della scrittura.
                </p>
                <button
                    onClick={handleExport}
                    disabled={isLoading}
                    className="inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,#0A84FF,#5AC8FA)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_18px_34px_rgba(10,132,255,0.24)] transition-all hover:-translate-y-0.5 hover:shadow-[0_22px_40px_rgba(10,132,255,0.3)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    Scarica Backup
                </button>
            </div>

            <div className="mediflow-vitreous-panel glass-panel border p-6 md:p-7">
                <p className="section-kicker">Ripristino controllato</p>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Upload className="w-5 h-5 text-amber-500" />
                    Restore
                </h3>
                <div className="mt-2 mb-4 rounded-[20px] p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 flex gap-3 text-sm text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                    <p>
                        Caricare un backup <strong>cancellerà TUTTI i dati attuali</strong> e li sostituirà con il contenuto del backup.
                        Il file viene verificato prima della scrittura e rifiutato se il manifest non coincide.
                    </p>
                </div>

                <label className="inline-flex w-fit items-center gap-2 rounded-full border border-white/70 bg-white/76 px-4 py-2.5 text-sm font-medium text-gray-700 shadow-[0_10px_22px_rgba(15,23,42,0.04)] backdrop-blur-md transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-[#21262d] cursor-pointer">
                    {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Seleziona file .mediflow v1
                    <input
                        type="file"
                        accept=".mediflow,.json"
                        onChange={handleRestoreFileSelected}
                        disabled={isLoading || pendingRestoreFile !== null}
                        className="hidden"
                    />
                </label>

                {pendingRestoreFile && (
                    // WUL-297 — superficie di conferma esplicita per il restore.
                    <div
                        data-testid="restore-confirmation-panel"
                        className="mt-4 space-y-3 rounded-[20px] border border-red-200/70 bg-red-50/70 p-4 dark:border-red-500/25 dark:bg-red-900/15"
                    >
                        <div className="flex items-start gap-2 text-sm font-semibold text-red-700 dark:text-red-200">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <p>
                                ATTENZIONE: <strong>TUTTI i dati attuali verranno cancellati</strong> e sostituiti con
                                quelli del backup. L&apos;operazione non è reversibile.
                            </p>
                        </div>
                        <p className="text-xs text-red-800/80 dark:text-red-200/80">
                            File selezionato: <code>{pendingRestoreFile.name}</code>{' '}
                            ({Math.max(1, Math.round(pendingRestoreFile.size / 1024)).toLocaleString()} KB)
                        </p>
                        <label className="block text-xs font-medium text-red-800 dark:text-red-200">
                            Scrivi <strong>{RESTORE_CONFIRM_KEYWORD}</strong> per procedere
                            <input
                                type="text"
                                value={restoreConfirmText}
                                onChange={(e) => setRestoreConfirmText(e.target.value)}
                                placeholder={RESTORE_CONFIRM_KEYWORD}
                                autoComplete="off"
                                spellCheck={false}
                                data-testid="restore-confirmation-input"
                                className="mt-1 w-full rounded-[12px] border border-red-200 bg-white/90 px-3 py-2 font-mono text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-300 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-100"
                            />
                        </label>
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={confirmRestore}
                                disabled={!restoreConfirmed || isLoading}
                                data-testid="restore-confirmation-submit"
                                className="inline-flex items-center gap-2 rounded-full border border-red-300 bg-red-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/40"
                            >
                                {isLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                                Ripristina adesso
                            </button>
                            <button
                                type="button"
                                onClick={cancelRestore}
                                disabled={isLoading}
                                className="inline-flex items-center rounded-full border border-red-200 bg-white/80 px-4 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:bg-transparent dark:text-red-200"
                            >
                                Annulla
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {status && (
                <div className={`xl:col-span-2 p-4 rounded-[22px] flex items-center gap-3 border ${status.type === 'success' ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/10 dark:text-green-300 dark:border-green-500/20' :
                        status.type === 'error' ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/10 dark:text-red-300 dark:border-red-500/20' :
                            'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/10 dark:text-blue-300 dark:border-blue-500/20'
                    }`}>
                    {status.type === 'success' && <CheckCircle className="w-5 h-5" />}
                    {status.type === 'error' && <AlertTriangle className="w-5 h-5" />}
                    <div className="space-y-3">
                        <p className="font-medium">{status.message}</p>
                        {status.preflight && (
                            <div className="space-y-3 text-sm">
                                <div className="rounded-lg border border-current/15 bg-white/50 px-3 py-2">
                                    <p className="font-semibold">Preflight restore</p>
                                    <p>
                                        Data dir: <code>{status.preflight.target.dataDir ?? 'n/d'}</code>
                                    </p>
                                    <p>
                                        Database target: <code>{status.preflight.target.dbPath ?? 'n/d'}</code>
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    {status.preflight.checks.map((check) => (
                                        <div key={check.id} className="rounded-lg border border-current/15 bg-white/50 px-3 py-2">
                                            <p className="font-semibold">
                                                {check.status === 'pass' ? 'PASS' : 'FAIL'} · <code>{check.id}</code>
                                            </p>
                                            <p>{check.message}</p>
                                            {check.remediation && <p className="opacity-80">{check.remediation}</p>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
