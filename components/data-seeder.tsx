'use client';

import { useState } from 'react';
import { seedDatabase, nukeTestData } from '@/lib/seeder';
import { Database, Trash2, Plus, Settings2, FileText, Pill, Stethoscope } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';

const PANEL_CLASS = 'seeder-panel p-5';
const SUBSECTION_CLASS = 'seeder-subsection p-4';
const DANGER_SUBSECTION_CLASS = 'seeder-subsection seeder-subsection-danger';

export default function DataSeeder() {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [nuking, setNuking] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0 });

    const [nukeAll, setNukeAll] = useState(false);

    // Options
    const [patientCount, setPatientCount] = useState(10);
    const [includeEntries, setIncludeEntries] = useState(true);
    const [includeTherapies, setIncludeTherapies] = useState(true);
    const [includeConditions, setIncludeConditions] = useState(true);

    const handleStressTest = () => {
        setPatientCount(50);
        setIncludeEntries(true);
        setIncludeTherapies(true);
        setIncludeConditions(true);
    };

    const handleSeed = async () => {
        console.log("Seeder: Start requested", { patientCount, includeEntries });
        const seedConfirm = await confirm({
            title: 'Genera pazienti di test',
            message: `Stai per generare ${patientCount} pazienti di test. Procedere?`,
            confirmLabel: 'Genera',
            tone: 'danger'
        });
        if (!seedConfirm.confirmed) return;

        setLoading(true);
        setProgress({ current: 0, total: patientCount });

        try {
            console.log("Seeder: Calling seedDatabase...");
            const result = await seedDatabase({
                patientCount,
                includeEntries,
                includeTherapies,
                includeConditions,
                onProgress: (current, total) => {
                    console.log(`Seeder Progress: ${current}/${total}`);
                    setProgress({ current, total });
                }
            });
            console.log("Seeder: Success", result);
            showToast({ tone: 'success', title: 'Pazienti di test generati', description: `Generati ${patientCount} pazienti di test.` });
            window.setTimeout(() => window.location.reload(), 1200);
        } catch (e) {
            console.error("Seeder Error Caught:", e);
            const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : JSON.stringify(e);
            showToast({ tone: 'error', title: 'Errore durante la generazione', description: msg });
            // Do not clear progress on error so user can see where it failed
        } finally {
            console.log("Seeder: finally block");
            setLoading(false);
            // Only clear progress if successful (handled by reload) or if we want to reset manually. 
            // We leave it visible for debug.
        }
    };

    const handleNuke = async () => {
        const nukeConfirm = await confirm({
            title: nukeAll ? 'Reset totale del database' : 'Elimina dati di test',
            message: nukeAll
                ? 'Stai per eliminare TUTTO IL DATABASE (pazienti reali e di test). Sei sicuro?'
                : 'Questo eliminerà i pazienti di test (codice fiscale TEST-...). Procedere?',
            confirmLabel: 'Elimina',
            tone: 'danger'
        });
        if (!nukeConfirm.confirmed) return;

        setNuking(true);
        try {
            const result = await nukeTestData(nukeAll);
            showToast({ tone: 'success', title: 'Eliminazione completata', description: `Eliminati ${result.deleted} record.` });
            window.setTimeout(() => window.location.reload(), 1200);
        } catch (e) {
            console.error(e);
            showToast({ tone: 'error', title: "Errore durante l'eliminazione", description: String(e) });
        } finally {
            setNuking(false);
        }
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="inline-flex items-center gap-2 rounded-full border border-amber-200/70 bg-amber-50/85 px-4 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-900/10 dark:text-amber-200 dark:hover:bg-amber-900/20"
            >
                <Database className="w-4 h-4" />
                Genera Dati di Prova
            </button>
        );
    }

    return (
        <div className={`${PANEL_CLASS} space-y-4`}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-amber-100/90 p-2.5 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
                        <Settings2 className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-700 dark:text-amber-200">Seeder</p>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Generatore Dati di Test</h4>
                    </div>
                </div>
                <button
                    onClick={() => setIsOpen(false)}
                    className="rounded-full border border-amber-200/70 bg-white/72 px-3 py-2 text-xs font-medium text-amber-700 transition-colors hover:bg-white dark:border-amber-500/20 dark:bg-white/5 dark:text-amber-200"
                >
                    Chiudi
                </button>
            </div>

            {/* Patient Count Slider */}
            <div className={`${SUBSECTION_CLASS} space-y-3`}>
                <label className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
                    <span>Numero Pazienti</span>
                    <span className="rounded-full border border-amber-200/70 bg-amber-50/85 px-3 py-1 font-mono text-xs font-semibold text-amber-700 dark:border-amber-500/20 dark:bg-amber-900/10 dark:text-amber-200">{patientCount}</span>
                </label>
                <input
                    type="range"
                    min="1"
                    max="500"
                    value={patientCount}
                    onChange={(e) => setPatientCount(Number(e.target.value))}
                    className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-amber-200 accent-amber-600 dark:bg-amber-950/40"
                    title="Numero Pazienti"
                    aria-label="Seleziona il numero di pazienti da generare"
                />
                <div className="flex justify-between text-[10px] text-amber-500 dark:text-amber-200/70">
                    <span>1</span>
                    <span>100</span>
                    <span>250</span>
                    <span>500</span>
                </div>
            </div>

            {/* Presets */}
            <button
                onClick={handleStressTest}
                className="w-full rounded-full border border-dashed border-amber-300 bg-amber-50/70 px-4 py-2 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-900/10 dark:text-amber-200 dark:hover:bg-amber-900/20"
            >
                Preset: Stress Test (50 pazienti complessi)
            </button>



            {/* Options */}
            <div className="grid grid-cols-3 gap-2">
                <label className={cn(
                    "flex flex-col items-center gap-2 rounded-[20px] border p-3 text-xs transition-colors",
                    includeEntries
                        ? "border-amber-300 bg-amber-50/90 text-amber-900 shadow-[0_10px_22px_rgba(217,119,6,0.08)] dark:border-amber-500/20 dark:bg-amber-900/10 dark:text-amber-100"
                        : "border-white/70 bg-white/72 text-amber-700 dark:border-white/10 dark:bg-white/5 dark:text-amber-200"
                )}>
                    <input
                        type="checkbox"
                        checked={includeEntries}
                        onChange={(e) => setIncludeEntries(e.target.checked)}
                        className="sr-only"
                    />
                    <FileText className="w-4 h-4" />
                    <span>Diario</span>
                </label>

                <label className={cn(
                    "flex flex-col items-center gap-2 rounded-[20px] border p-3 text-xs transition-colors",
                    includeTherapies
                        ? "border-amber-300 bg-amber-50/90 text-amber-900 shadow-[0_10px_22px_rgba(217,119,6,0.08)] dark:border-amber-500/20 dark:bg-amber-900/10 dark:text-amber-100"
                        : "border-white/70 bg-white/72 text-amber-700 dark:border-white/10 dark:bg-white/5 dark:text-amber-200"
                )}>
                    <input
                        type="checkbox"
                        checked={includeTherapies}
                        onChange={(e) => setIncludeTherapies(e.target.checked)}
                        className="sr-only"
                    />
                    <Pill className="w-4 h-4" />
                    <span>Terapie</span>
                </label>

                <label className={cn(
                    "flex flex-col items-center gap-2 rounded-[20px] border p-3 text-xs transition-colors",
                    includeConditions
                        ? "border-amber-300 bg-amber-50/90 text-amber-900 shadow-[0_10px_22px_rgba(217,119,6,0.08)] dark:border-amber-500/20 dark:bg-amber-900/10 dark:text-amber-100"
                        : "border-white/70 bg-white/72 text-amber-700 dark:border-white/10 dark:bg-white/5 dark:text-amber-200"
                )}>
                    <input
                        type="checkbox"
                        checked={includeConditions}
                        onChange={(e) => setIncludeConditions(e.target.checked)}
                        className="sr-only"
                    />
                    <Stethoscope className="w-4 h-4" />
                    <span>ICD-11</span>
                </label>
            </div>

            {/* Progress Bar */}
            {loading && (
                <div className={`${SUBSECTION_CLASS} space-y-2`}>
                    <div className="flex justify-between text-xs text-amber-700 dark:text-amber-200">
                        <span>Generazione in corso...</span>
                        <span>{progress.current} / {progress.total}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-amber-200 dark:bg-amber-950/40">
                        <div
                            className="bg-amber-600 h-2 rounded-full transition-[width] duration-150 w-[var(--prog-width)]"
                            style={{ '--prog-width': `${(progress.current / progress.total) * 100}%` } as React.CSSProperties}
                        />
                    </div>
                </div>
            )}

            {/* Action Buttons */}
            <button
                onClick={handleSeed}
                disabled={loading || nuking}
                className="ui-btn-primary lume-press flex w-full justify-center px-4 py-3 text-sm disabled:opacity-50"
            >
                <Plus className="w-5 h-5" />
                {loading ? `Generazione... (${progress.current}/${progress.total})` : 'Genera Pazienti'}
            </button>

            {/* Danger Zone */}
            <div className={DANGER_SUBSECTION_CLASS}>
                <div className="flex flex-col gap-3">
                    <label className="flex items-center gap-2 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={nukeAll}
                            onChange={e => setNukeAll(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 accent-red-500 transition-colors dark:border-white/10 dark:bg-white/5"
                        />
                        <span className={`text-[10px] uppercase font-bold tracking-[0.18em] transition-colors ${nukeAll ? 'text-red-600 dark:text-red-200' : 'text-slate-400 group-hover:text-red-400 dark:text-slate-500 dark:group-hover:text-red-300'}`}>
                            Elimina Anche Dati Reali (Reset Totale)
                        </span>
                    </label>

                    <button
                        onClick={handleNuke}
                        disabled={loading || nuking}
                        className={cn(
                            "flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-xs font-bold transition-[background-color,color,opacity] disabled:opacity-50",
                            nukeAll
                                ? "border-red-600 bg-red-600 text-white shadow-[0_16px_30px_rgba(220,38,38,0.22)] hover:bg-red-700"
                                : "border-red-200 bg-white/85 text-red-600 hover:bg-red-50 dark:border-red-500/20 dark:bg-red-950/10 dark:text-red-200 dark:hover:bg-red-900/20"
                        )}
                        title="Elimina i dati"
                    >
                        <Trash2 className="w-4 h-4" />
                        {nuking ? 'Eliminazione...' : (nukeAll ? 'NUKE TOTALE (PERICOLO)' : 'Elimina Dati Test')}
                    </button>
                </div>
            </div>

            <p className="text-center text-[10px] text-amber-700 dark:text-amber-200/80">
                I pazienti generati avranno codice fiscale che inizia con &quot;TEST-&quot; per distinguerli dai reali.
            </p>
        </div>
    );
}
