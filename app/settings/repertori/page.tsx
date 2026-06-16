'use client';

// WUL-297 Repertori (AIFA + esenzioni): moved from the monolithic settings page.

import { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Database, Server, Upload } from 'lucide-react';
import { importAifaCsv, getDrugStats, clearDrugDatabase } from '@/lib/aifa-importer';
/* @Codex */
import ExemptionDbManager from '@/components/settings/exemption-db-manager';
import { SETTINGS_CARD_CLASS, SettingsSectionIntro } from '@/components/settings/settings-ui';

export default function SettingsRepertoriPage() {
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- AIFA State ---
    const [drugStats, setDrugStats] = useState<number | null>(null);
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState(0);

    // Load initial data
    useEffect(() => {
        loadStats();
    }, []);

    const loadStats = async () => {
        try {
            const count = await getDrugStats();
            setDrugStats(count);
        } catch (e) {
            console.error(e);
        }
    };

    // --- AIFA Handlers ---
    const handleAifaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!confirm("Questa operazione potrebbe richiedere del tempo. Vuoi procedere con l'importazione?")) {
            if (fileInputRef.current) fileInputRef.current.value = "";
            return;
        }

        setImporting(true);
        setProgress(0);

        try {
            // Optional: Clear old DB? existing behavior seems to be additive or overwrite by key?
            // Usually simpler to clear for a fresh import if it's a full list replacement
            // await clearDrugDatabase();

            await importAifaCsv(file, (count, total) => {
                const perc = Math.round((count / total) * 100);
                setProgress(perc);
            });
            alert("Importazione completata con successo!");
            loadStats();
        } catch (err) {
            console.error(err);
            alert("Errore durante l'importazione.");
        } finally {
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleClearDrugs = async () => {
        if (confirm("Sei sicuro di voler cancellare l'intero database farmaci?")) {
            await clearDrugDatabase();
            loadStats();
        }
    };

    return (
        <section className="space-y-4" data-testid="settings-repertori-section">
            <SettingsSectionIntro
                kicker="Repertori"
                title="Farmaci AIFA ed esenzioni"
                description="Repertori per la cartella: farmaci AIFA ed esenzioni consultabili anche senza rete."
            />

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <div className={SETTINGS_CARD_CLASS}>
                    <div className="mb-5 flex items-start gap-3">
                        <div className="rounded-2xl bg-slate-100 p-2 text-slate-700 dark:bg-white/10 dark:text-slate-200">
                            <Database className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <p className="section-kicker">Farmaci</p>
                            <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-white">Database AIFA offline</h2>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                Elenco farmaci rimborsabili usato dal prescrittore.{' '}
                                <a
                                    href="https://www.aifa.gov.it/web/guest/liste-dei-farmaci"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-slate-700 underline-offset-2 hover:underline dark:text-slate-200"
                                >
                                    Fonte: AIFA Open Data
                                </a>
                            </p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between rounded-[22px] border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/5">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300">Farmaci indicizzati</p>
                                <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                                    {drugStats !== null ? drugStats.toLocaleString() : '-'}
                                </p>
                            </div>
                            <Server className="w-8 h-8 text-slate-300 dark:text-white/20" />
                        </div>

                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleAifaUpload}
                            accept=".csv"
                            className="hidden"
                            disabled={importing}
                            aria-label="Carica file CSV AIFA"
                        />

                        {!importing ? (
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="flex w-full items-center justify-center gap-2 rounded-[22px] border-2 border-dashed border-slate-300 bg-white/72 px-4 py-3 text-slate-600 shadow-[0_10px_22px_rgba(15,23,42,0.04)] transition-[border-color,background-color,color,box-shadow] hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 dark:border-white/15 dark:bg-white/5 dark:text-slate-300 dark:hover:border-white/25 dark:hover:bg-white/10"
                            >
                                <Upload className="w-5 h-5" />
                                <span className="font-medium">Carica file AIFA (.csv)</span>
                            </button>
                        ) : (
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs text-gray-500">
                                    <span>Importazione in corso...</span>
                                    <span>{progress}%</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                                    <div className="h-2.5 rounded-full bg-slate-900 transition-[width] duration-300 progress-bar-width dark:bg-white" data-progress={progress}></div>
                                </div>
                                <p className="text-[10px] text-gray-400 text-center">Non chiudere la pagina.</p>
                            </div>
                        )}

                        {drugStats !== null && drugStats > 0 && (
                            <button
                                onClick={handleClearDrugs}
                                className="text-xs text-red-500 hover:text-red-700 hover:underline flex items-center gap-1"
                            >
                                <AlertTriangle className="w-3 h-3" />
                                Svuota database farmaci
                            </button>
                        )}
                    </div>
                </div>

                <ExemptionDbManager />
            </div>
        </section>
    );
}
