'use client';

import { useState } from 'react';
import { seedDatabase, nukeTestData } from '@/lib/seeder';
import { Database, Trash2, Plus, Settings2, FileText, Pill, Stethoscope } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function DataSeeder() {
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
        if (!confirm(`Stai per generare ${patientCount} pazienti di test. Procedere?`)) return;

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
            alert(`✅ Generati ${patientCount} pazienti di test con successo!`);
            window.location.reload();
        } catch (e) {
            console.error("Seeder Error Caught:", e);
            const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : JSON.stringify(e);
            alert("❌ Errore durante la generazione: " + msg);
            // Do not clear progress on error so user can see where it failed
        } finally {
            console.log("Seeder: finally block");
            setLoading(false);
            // Only clear progress if successful (handled by reload) or if we want to reset manually. 
            // We leave it visible for debug.
        }
    };

    const handleNuke = async () => {
        const msg = nukeAll
            ? "⚠️ PERICOLO: Stai per eliminare TUTTO IL DATABASE (Pazienti Reali e Test).\n\nSei sicuro?"
            : "⚠️ ATTENZIONE: Questo eliminerà i pazienti di test (codice fiscale TEST-...).\n\nProcedere?";

        if (!confirm(msg)) return;

        setNuking(true);
        try {
            const result = await nukeTestData(nukeAll);
            alert(`🔥 Eliminati ${result.deleted} record.`);
            window.location.reload();
        } catch (e) {
            console.error(e);
            alert("❌ Errore durante l'eliminazione: " + e);
        } finally {
            setNuking(false);
        }
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 transition-colors text-sm font-medium"
            >
                <Database className="w-4 h-4" />
                Genera Dati di Prova
            </button>
        );
    }

    return (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-4 animate-in slide-in-from-top-2 fade-in">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-800 font-bold">
                    <Settings2 className="w-5 h-5" />
                    Generatore Dati di Test
                </div>
                <button
                    onClick={() => setIsOpen(false)}
                    className="text-amber-600 hover:text-amber-800 text-xs underline"
                >
                    Chiudi
                </button>
            </div>

            {/* Patient Count Slider */}
            <div className="space-y-2">
                <label className="flex items-center justify-between text-sm text-amber-900">
                    <span>Numero Pazienti</span>
                    <span className="font-mono font-bold bg-amber-100 px-2 py-0.5 rounded">{patientCount}</span>
                </label>
                <input
                    type="range"
                    min="1"
                    max="500"
                    value={patientCount}
                    onChange={(e) => setPatientCount(Number(e.target.value))}
                    className="w-full h-2 bg-amber-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
                    title="Numero Pazienti"
                    aria-label="Seleziona il numero di pazienti da generare"
                />
                <div className="flex justify-between text-[10px] text-amber-500">
                    <span>1</span>
                    <span>100</span>
                    <span>250</span>
                    <span>500</span>
                </div>
            </div>

            {/* Presets */}
            <button
                onClick={handleStressTest}
                className="w-full py-1 text-xs bg-amber-100/50 hover:bg-amber-100 text-amber-700 border border-dashed border-amber-300 rounded mb-2"
            >
                ⚡ Preset: Stress Test (50 Pazienti Complessi)
            </button>



            {/* Options */}
            <div className="grid grid-cols-3 gap-2">
                <label className={cn(
                    "flex flex-col items-center gap-1 p-2 rounded-lg border cursor-pointer transition-all text-xs",
                    includeEntries
                        ? "bg-amber-100 border-amber-400 text-amber-900"
                        : "bg-white border-amber-200 text-amber-600"
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
                    "flex flex-col items-center gap-1 p-2 rounded-lg border cursor-pointer transition-all text-xs",
                    includeTherapies
                        ? "bg-amber-100 border-amber-400 text-amber-900"
                        : "bg-white border-amber-200 text-amber-600"
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
                    "flex flex-col items-center gap-1 p-2 rounded-lg border cursor-pointer transition-all text-xs",
                    includeConditions
                        ? "bg-amber-100 border-amber-400 text-amber-900"
                        : "bg-white border-amber-200 text-amber-600"
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
                <div className="space-y-1">
                    <div className="flex justify-between text-xs text-amber-700">
                        <span>Generazione in corso...</span>
                        <span>{progress.current} / {progress.total}</span>
                    </div>
                    <div className="w-full bg-amber-200 rounded-full h-2">
                        <div
                            className="bg-amber-600 h-2 rounded-full transition-all duration-150 w-[var(--prog-width)]"
                            style={{ '--prog-width': `${(progress.current / progress.total) * 100}%` } as React.CSSProperties}
                        />
                    </div>
                </div>
            )}

            {/* Action Buttons */}
            <button
                onClick={handleSeed}
                disabled={loading || nuking}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-amber-600 to-orange-600 text-white rounded-xl hover:shadow-lg hover:shadow-amber-500/20 transition-all text-sm font-bold disabled:opacity-50 active:scale-95"
            >
                <Plus className="w-5 h-5" />
                {loading ? `Generazione... (${progress.current}/${progress.total})` : 'Genera Pazienti'}
            </button>

            {/* Danger Zone */}
            <div className="mt-6 pt-4 border-t border-amber-200/50">
                <div className="flex flex-col gap-3">
                    <label className="flex items-center gap-2 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={nukeAll}
                            onChange={e => setNukeAll(e.target.checked)}
                            className="accent-red-500 w-4 h-4 rounded border-gray-300 transition-colors"
                        />
                        <span className={`text-[10px] uppercase font-bold transition-colors ${nukeAll ? 'text-red-600 animate-pulse' : 'text-gray-400 group-hover:text-red-400'}`}>
                            Elimina Anche Dati Reali (Reset Totale)
                        </span>
                    </label>

                    <button
                        onClick={handleNuke}
                        disabled={loading || nuking}
                        className={cn(
                            "w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border transition-all text-xs font-bold disabled:opacity-50",
                            nukeAll
                                ? "bg-red-600 text-white border-red-600 hover:bg-red-700 shadow-lg shadow-red-500/20"
                                : "bg-white text-red-600 border-red-200 hover:bg-red-50"
                        )}
                        title="Elimina i dati"
                    >
                        <Trash2 className="w-4 h-4" />
                        {nuking ? 'Eliminazione...' : (nukeAll ? 'NUKE TOTALE (PERICOLO)' : 'Elimina Dati Test')}
                    </button>
                </div>
            </div>

            <p className="text-[10px] text-amber-600 text-center">
                I pazienti generati avranno codice fiscale che inizia con &quot;TEST-&quot; per distinguerli dai reali.
            </p>
        </div>
    );
}
