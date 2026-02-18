'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Database, RefreshCw, Trash2, Upload } from 'lucide-react';
import { clearExemptionDatabase, getExemptionStats, importExemptionFiles } from '@/lib/exemption-importer';

type MessageState = {
    type: 'success' | 'error';
    text: string;
} | null;

/* @Codex */
export default function ExemptionDbManager() {
    const fileInputRef = useRef<HTMLInputElement>(null);

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
        if (!confirm('Vuoi davvero svuotare l\'intero catalogo esenzioni?')) return;
        try {
            await clearExemptionDatabase();
            await refreshStats();
            setMessage({ type: 'success', text: 'Catalogo esenzioni svuotato.' });
        } catch (error) {
            console.error('Failed to clear exemptions', error);
            setMessage({ type: 'error', text: 'Impossibile svuotare il catalogo esenzioni.' });
        }
    };

    const percent = total > 0 ? Math.round((progress / total) * 100) : 0;

    return (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 space-y-5">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                    <Database className="w-6 h-6" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Codifiche Esenzioni</h2>
                    <p className="text-xs text-gray-500">Catalogo locale per ricerca rapida in anagrafica paziente.</p>
                </div>
            </div>

            <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-xl flex items-center justify-between">
                <div>
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 font-bold uppercase tracking-wider">Codici Indicizzati</p>
                    <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">
                        {stats !== null ? stats.toLocaleString() : '-'}
                    </p>
                </div>
                <RefreshCw className={`w-7 h-7 text-emerald-300 dark:text-emerald-700 ${isImporting ? 'animate-spin' : ''}`} />
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
                className={`rounded-xl border-2 border-dashed p-5 transition-all ${isDragging
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                    : 'border-gray-300 dark:border-gray-600 bg-gray-50/70 dark:bg-gray-700/30'
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
                            <p className="text-xs text-gray-500 mt-1">Supporta file in formato `|` (es. `Esenzioni.txt`, `Invalidita.txt`).</p>
                        </div>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="px-4 py-2 text-sm rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/30 transition-colors"
                        >
                            Seleziona file
                        </button>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-gray-500">
                            <span>Importazione in corso...</span>
                            <span>{percent}%</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                                className="h-2 rounded-full bg-emerald-500 transition-all duration-200"
                                style={{ width: `${percent}%` }}
                            />
                        </div>
                        <p className="text-[11px] text-gray-500 text-center">
                            Elaborate {progress.toLocaleString()} di {Math.max(total, progress).toLocaleString()} righe...
                        </p>
                    </div>
                )}
            </div>

            {message && (
                <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${message.type === 'success'
                    ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                    : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                    }`}>
                    {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    {message.text}
                </div>
            )}

            <div className="pt-2 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <button
                    onClick={refreshStats}
                    className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1"
                >
                    <RefreshCw className="w-3 h-3" />
                    Aggiorna conteggio
                </button>
                <button
                    onClick={handleClear}
                    className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                >
                    <Trash2 className="w-3 h-3" />
                    Svuota catalogo
                </button>
            </div>
        </div>
    );
}
