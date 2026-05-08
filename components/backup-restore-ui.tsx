'use client';

import { useState } from 'react';
import { Download, Upload, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';
import { BackupRestorePreflightError, exportRawDatabase, importRawDatabase } from '@/lib/db';
import { useSecurity } from './security-provider';

export default function BackupRestoreUI() {
    const { isAuthenticated, lock } = useSecurity();
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState<{
        type: 'success' | 'error' | 'info';
        message: string;
        preflight?: BackupRestorePreflightError['preflight'];
    } | null>(null);

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

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!confirm("ATTENZIONE: Questa operazione cancellerà TUTTI i dati attuali e li sostituirà con quelli del backup. Sei sicuro di voler procedere?")) {
            e.target.value = ''; // Reset input
            return;
        }

        setIsLoading(true);
        setStatus({ type: 'info', message: 'Ripristino in corso...' });

        try {
            const text = await file.text();
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
            e.target.value = '';
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
                        Caricare un backup <strong>sovrascriverà i dati supportati dal restore</strong>.
                        Il file viene verificato prima della scrittura e rifiutato se il manifest non coincide.
                    </p>
                </div>

                <label className="inline-flex w-fit items-center gap-2 rounded-full border border-white/70 bg-white/76 px-4 py-2.5 text-sm font-medium text-gray-700 shadow-[0_10px_22px_rgba(15,23,42,0.04)] backdrop-blur-md transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-[#21262d] cursor-pointer">
                    {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Seleziona file .mediflow v1
                    <input
                        type="file"
                        accept=".mediflow,.json"
                        onChange={handleImport}
                        disabled={isLoading}
                        className="hidden"
                    />
                </label>
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
