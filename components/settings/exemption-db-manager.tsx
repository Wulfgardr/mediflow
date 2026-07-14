'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Database, RefreshCw, Trash2, Upload } from 'lucide-react';
import { clearExemptionDatabase, getExemptionStats, importExemptionFiles } from '@/lib/exemption-importer';
import { useConfirm } from '@/components/ui/confirm-dialog';

type MessageState = {
    type: 'success' | 'error';
    text: string;
} | null;

/* @Codex */
export default function ExemptionDbManager() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const confirm = useConfirm();

    const [stats, setStats] = useState<number | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [progress, setProgress] = useState(0);
    const [total, setTotal] = useState(0);
    const [message, setMessage] = useState<MessageState>(null);

    const refreshStats = async () => {
        try {
            const count = await getExemptionStats();
            setStats(count);
        } catch (error) {
            console.error('Failed to load exemptions count', error);
        }
    };

    useEffect(() => {
        refreshStats();
    }, []);

    const processFiles = async (files: File[]) => {
        if (!files.length) return;

        const allowed = files.filter((file) => {
            const lower = file.name.toLowerCase();
            return lower.endsWith('.txt') || lower.endsWith('.csv');
        });

        if (!allowed.length) {
            setMessage({ type: 'error', text: 'Carica file .txt o .csv con formato tabellare esenzioni.' });
            return;
        }

        setIsImporting(true);
        setMessage(null);
        setProgress(0);
        setTotal(0);

        try {
            const summary = await importExemptionFiles(allowed, (processed, overall) => {
                setProgress(processed);
                setTotal(overall);
            });
            setMessage({
                type: 'success',
                text: `Importazione completata: ${summary.imported.toLocaleString()} codici aggiornati da ${summary.files} file.`,
            });
            await refreshStats();
        } catch (error) {
            console.error('Exemptions import failed', error);
            setMessage({ type: 'error', text: 'Errore durante importazione esenzioni. Verifica intestazioni e formato file.' });
        } finally {
            setIsImporting(false);
        }
    };

    const onInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        await processFiles(files);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const onDrop = async (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragging(false);
        if (isImporting) return;
        const files = Array.from(event.dataTransfer.files || []);
        await processFiles(files);
    };

    const handleClear = async () => {
        const { confirmed } = await confirm({
            title: 'Svuotare il repertorio esenzioni?',
            message: "L'intero repertorio delle esenzioni verrà cancellato.",
            confirmLabel: 'Svuota',
            tone: 'danger',
        });
        if (!confirmed) return;
        try {
            await clearExemptionDatabase();
            await refreshStats();
            setMessage({ type: 'success', text: 'Repertorio esenzioni svuotato.' });
        } catch (error) {
            console.error('Failed to clear exemptions', error);
            setMessage({ type: 'error', text: 'Impossibile svuotare il repertorio esenzioni.' });
        }
    };

    const percent = total > 0 ? Math.round((progress / total) * 100) : 0;

    return (
        <div className="mf-section lume-focal space-y-5 p-6 md:p-7">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                    <Database className="w-6 h-6" />
                </div>
                <div>
                    <p className="section-kicker">Repertorio amministrativo</p>
                    <h2 className="text-lg font-bold" style={{ color: 'var(--lume-ink)' }}>Codifiche Esenzioni</h2>
                    <p className="text-xs" style={{ color: 'var(--lume-ink-muted)' }}>Repertorio per la ricerca rapida in anagrafica paziente.</p>
                </div>
            </div>

            <div className="flex items-center justify-between rounded-[var(--lume-radius-card)] border border-emerald-200/60 bg-emerald-50/80 p-4 dark:border-emerald-500/20 dark:bg-emerald-900/10">
                <div>
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 font-bold uppercase tracking-wider">Codici Indicizzati</p>
                    <p className="lume-registro text-2xl font-bold text-emerald-900 dark:text-emerald-100">
                        {stats !== null ? stats.toLocaleString() : '-'}
                    </p>
                </div>
                <RefreshCw className="w-7 h-7 text-emerald-300 dark:text-emerald-700" />
            </div>

            <div
                onDragOver={(event) => {
                    event.preventDefault();
                    if (!isImporting) setIsDragging(true);
                }}
                onDragLeave={(event) => {
                    event.preventDefault();
                    setIsDragging(false);
                }}
                onDrop={onDrop}
                className={`rounded-[var(--lume-radius-panel)] border-2 border-dashed p-5 transition-all ${isDragging
                    ? 'border-emerald-500 bg-emerald-50/80 dark:bg-emerald-900/20'
                    : 'border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)]'
                    }`}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.csv"
                    multiple
                    className="hidden"
                    onChange={onInputChange}
                    disabled={isImporting}
                />

                {!isImporting ? (
                    <div className="text-center space-y-3">
                        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-600 dark:text-emerald-300">
                            <Upload className="w-6 h-6" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Drag & drop file esenzioni</p>
                            <p className="text-xs text-gray-500 mt-1">File delimitati da | (es. Esenzioni.txt, Invalidita.txt).</p>
                        </div>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-white/85 px-4 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-500/20 dark:bg-white/5 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
                        >
                            Seleziona file
                        </button>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-gray-500">
                            <span>Importazione in corso...</span>
                            <span className="lume-registro">{percent}%</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                                className="h-2 rounded-full bg-emerald-500 transition-all duration-200"
                                style={{ width: `${percent}%` }}
                            />
                        </div>
                        <p className="text-[11px] text-gray-500 text-center">
                            Elaborate <span className="lume-registro">{progress.toLocaleString()} di {Math.max(total, progress).toLocaleString()}</span> righe...
                        </p>
                    </div>
                )}
            </div>

            {message && (
                <div className={`flex items-center gap-2 rounded-[var(--lume-radius-card)] border p-3 text-sm ${message.type === 'success'
                    ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-500/20 dark:bg-green-900/20 dark:text-green-300'
                    : 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-900/20 dark:text-red-300'
                    }`}>
                    {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    {message.text}
                </div>
            )}

            <div className="pt-2 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <button
                    onClick={refreshStats}
                    className="inline-flex items-center gap-1 rounded-full bg-white/75 px-3 py-1.5 text-xs text-gray-500 shadow-[0_8px_18px_rgba(15,23,42,0.04)] hover:text-gray-700 dark:bg-white/5 dark:hover:text-gray-300"
                >
                    <RefreshCw className="w-3 h-3" />
                    Aggiorna conteggio
                </button>
                <button
                    onClick={handleClear}
                    className="inline-flex items-center gap-1 rounded-full bg-red-50 px-3 py-1.5 text-xs text-red-500 hover:text-red-700 dark:bg-red-900/10"
                >
                    <Trash2 className="w-3 h-3" />
                    Svuota repertorio
                </button>
            </div>
        </div>
    );
}
