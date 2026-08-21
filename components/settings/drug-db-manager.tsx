'use client';

import { useState, useEffect } from 'react';
import { Database, Upload, Trash2, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';
import { importAifaCsv, getDrugStats, clearDrugDatabase } from '@/lib/aifa-importer';
import { AIFA_CATALOG_DEFAULT_SOURCE_URL } from '@/lib/aifa-catalog';
import { useConfirm } from '@/components/ui/confirm-dialog';

export default function DrugDbManager() {
    const confirm = useConfirm();
    const [stats, setStats] = useState<number | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [sourceUrl, setSourceUrl] = useState(AIFA_CATALOG_DEFAULT_SOURCE_URL);
    const [downloadedAt, setDownloadedAt] = useState('');
    const [datasetVersion, setDatasetVersion] = useState('');
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const refreshStats = async () => {
        const count = await getDrugStats();
        setStats(count);
    };

    useEffect(() => {
        refreshStats();
    }, []);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.name.endsWith('.csv')) {
            setMessage({ type: 'error', text: "Per favore carica un file .csv" });
            return;
        }

        setIsImporting(true);
        setMessage(null);

        try {
            const result = await importAifaCsv(file, {
                sourceUrl,
                downloadedAt,
                version: datasetVersion,
            });
            setMessage({ type: 'success', text: `Importazione completata. Indicizzati ${result.count} farmaci.` });
            refreshStats();
        } catch (error) {
            console.error(error);
            setMessage({ type: 'error', text: "Errore durante l'importazione. Verifica il formato del file." });
        } finally {
            setIsImporting(false);
        }
    };

    const handleClear = async () => {
        const { confirmed } = await confirm({
            title: 'Svuotare il database farmaci?',
            message: "L'intero prontuario locale verrà cancellato. Questa azione non può essere annullata.",
            confirmLabel: 'Svuota',
            tone: 'danger',
        });
        if (confirmed) {
            await clearDrugDatabase();
            refreshStats();
            setMessage({ type: 'success', text: "Database farmaci svuotato." });
        }
    };

    return (
        <div className="mf-section lume-focal space-y-6 p-6">
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
                        <Database className="w-5 h-5 text-indigo-500" />
                        Database Farmaci AIFA
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Gestisci il prontuario farmaceutico locale per abilitare l&apos;autocompletamento e la codifica AIC.
                    </p>
                </div>
                <div className="text-right">
                    <div className="text-2xl font-bold text-gray-800 dark:text-white">
                        {stats !== null ? stats.toLocaleString() : '...'}
                    </div>
                    <div className="text-xs text-gray-400 uppercase font-medium">Farmaci Indicizzati</div>
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-gray-600 dark:text-gray-300">
                    Versione dataset
                    <input className="mf-input mt-1 w-full" value={datasetVersion} onChange={(event) => setDatasetVersion(event.target.value)} disabled={isImporting} />
                </label>
                <label className="text-xs text-gray-600 dark:text-gray-300">
                    Data di scarico
                    <input className="mf-input mt-1 w-full" type="date" value={downloadedAt} onChange={(event) => setDownloadedAt(event.target.value)} disabled={isImporting} />
                </label>
                <label className="text-xs text-gray-600 dark:text-gray-300 sm:col-span-2">
                    URL fonte
                    <input className="mf-input mt-1 w-full" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} disabled={isImporting} />
                </label>
            </div>

            <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-4 border border-dashed border-gray-200 dark:border-white/10">
                {!isImporting ? (
                    <div className="flex flex-col items-center justify-center space-y-3 py-4">
                        <div className="p-3 bg-indigo-100 dark:bg-indigo-900/30 rounded-full text-indigo-600 dark:text-indigo-400">
                            <Upload className="w-6 h-6" />
                        </div>
                        <div className="text-center">
                            <h4 className="font-medium text-gray-700 dark:text-gray-200">Carica Database Farmaci</h4>
                            <p className="text-xs text-gray-400 max-w-sm mx-auto mt-1">
                                Carica il file <strong>confezioni.csv</strong> dal dataset Open Data AIFA.
                                <br />
                                <a href={AIFA_CATALOG_DEFAULT_SOURCE_URL} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">
                                    Vai ai Dati Aperti AIFA
                                </a>
                            </p>
                        </div>
                        <label className="block w-full max-w-xs mx-auto">
                            <span className="sr-only">Scegli file confezioni.csv</span>
                            <input
                                type="file"
                                accept=".csv"
                                onChange={handleFileUpload}
                                disabled={!datasetVersion.trim() || !downloadedAt || !sourceUrl.trim()}
                                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 dark:file:bg-indigo-900/30 dark:file:text-indigo-300 transition-colors cursor-pointer"
                            />
                        </label>
                    </div>
                ) : (
                    <div role="status" className="space-y-2 py-6 text-center">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Validazione e indicizzazione in corso</p>
                        <p className="text-xs text-gray-400">Il catalogo precedente resta disponibile fino al completamento.</p>
                    </div>
                )}
            </div>

            {message && (
                <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
                    {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    {message.text}
                </div>
            )}

            <div className="flex justify-between items-center pt-2 border-t border-gray-100 dark:border-white/5">
                <button onClick={refreshStats} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" /> Aggiorna conteggio
                </button>
                <button onClick={handleClear} className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /> Svuota Database
                </button>
            </div>
        </div>
    );
}
