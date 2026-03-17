'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles, RefreshCw, AlertTriangle, X } from 'lucide-react';
import { Patient } from '@/lib/db';
import ReactMarkdown from 'react-markdown';
import PrivacyBlur from '@/components/privacy-blur';
/* @Codex */
import { regeneratePatientSummary, getAiModelLabels, parsePatientInsight } from '@/lib/ai-summary-service';

interface AIPatientInsightProps {
    patient: Patient;
}

export default function AIPatientInsight({ patient }: AIPatientInsightProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState<string>("");
    const [error, setError] = useState<string | null>(null);
    /* @Codex */
    const [modelLabel, setModelLabel] = useState<string>("");

    const abortControllerRef = useRef<AbortController | null>(null);
    /* @Codex */
    const parsedInsight = parsePatientInsight(patient.aiSummary || "");
    /* @Codex */
    const hasStructuredInsight = Boolean(
        parsedInsight.summary ||
        parsedInsight.alerts.length ||
        parsedInsight.nextSteps.length ||
        parsedInsight.gaps.length
    );

    /* @Codex */
    useEffect(() => {
        const loadModels = async () => {
            const models = await getAiModelLabels();
            setModelLabel(models.clinical);
        };
        loadModels();
    }, []);

    const generateInsight = async () => {
        setIsGenerating(true);
        setError(null);
        setProgress("Inizializzazione...");

        // Create new controller for this request
        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const info = await regeneratePatientSummary(patient.id!, {
                signal: controller.signal,
                onStage: (stage, modelInfo) => {
                    if (modelInfo?.model) setModelLabel(modelInfo.model);
                    if (stage === 'connect') setProgress("Connessione al modello...");
                    if (stage === 'context') setProgress("Analisi contesto clinico...");
                    if (stage === 'generate') setProgress("Generazione insight...");
                    if (stage === 'save') setProgress("Salvataggio...");
                }
            });

            if (controller.signal.aborted) return;

            if (!info) throw new Error("Risposta vuota dal provider AI");

            // Force refresh to show new data
            setTimeout(() => {
                window.location.reload();
            }, 500);

        } catch (err) {
            if (abortControllerRef.current?.signal.aborted) {
                console.log("Generation aborted by user");
                return;
            }
            console.error("AI Insight Error:", err);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const msg = (err as any)?.message || "Errore sconosciuto";
            setError(msg.includes('Failed to fetch')
                ? "Impossibile connettersi al provider AI. Verifica Settings."
                : `Errore: ${msg}`);
        } finally {
            if (!abortControllerRef.current?.signal.aborted) {
                setIsGenerating(false);
                setProgress("");
                abortControllerRef.current = null;
            } else {
                // Reset if aborted
                setIsGenerating(false);
                setProgress("");
                abortControllerRef.current = null;
            }
        }
    };

    const stopGeneration = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setIsGenerating(false);
            setProgress("");
            setError("Generazione interrotta dall'utente.");
        }
    };


    if (!patient.aiSummary && !isGenerating) {
        return (
            <div className="glass-panel p-6 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-900/10 dark:to-transparent border-indigo-100 dark:border-indigo-500/20 flex flex-col items-center text-center space-y-4">
                <div className="p-3 bg-indigo-100 dark:bg-indigo-900/30 rounded-full text-indigo-600 dark:text-indigo-400">
                    <Sparkles className="w-6 h-6" />
                </div>
                <div>
                    <h3 className="font-bold text-gray-800 dark:text-white">Genera Patient Insight</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                        Usa l&apos;intelligenza artificiale per ottenere un quadro clinico breve e i prossimi passi suggeriti.
                    </p>
                </div>

                {error && (
                    <div className="text-xs text-red-500 bg-red-50 p-2 rounded-lg border border-red-100 max-w-sm">
                        {error}
                    </div>
                )}

                <button
                    onClick={generateInsight}
                    className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/30 hover:bg-indigo-700 transition-all active:scale-95 flex items-center gap-2"
                >
                    <Sparkles className="w-4 h-4" />
                    Genera Insight
                </button>
            </div>
        );
    }

    return (
        <div className="glass-panel p-6 relative overflow-hidden border-indigo-100 dark:border-indigo-500/20 shadow-lg shadow-indigo-100/50 dark:shadow-none">
            {/* Background Decoration */}
            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <Sparkles className="w-32 h-32 text-indigo-900 dark:text-indigo-400" />
            </div>

            <div className="flex justify-between items-start mb-4 relative z-10">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-indigo-600 text-white rounded-lg shadow-md shadow-indigo-200 dark:shadow-none">
                        <Sparkles className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="font-bold text-xl text-gray-800 dark:text-white">AI Patient Insight</h3>
                        {modelLabel && (
                            <p className="text-[10px] text-gray-500">Modello: {modelLabel}</p>
                        )}
                    </div>
                </div>

                <button
                    onClick={generateInsight}
                    disabled={isGenerating}
                    className="p-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
                    title="Rigenera analisi"
                >
                    {isGenerating ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                        <RefreshCw className="w-4 h-4" />
                    )}
                    <span className="text-sm font-medium">{isGenerating ? 'Analisi...' : 'Aggiorna'}</span>
                </button>
            </div>

            {error && (
                <div className="mb-4 text-xs text-red-600 bg-red-50 p-3 rounded-lg border border-red-100 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {error}
                </div>
            )}

            {isGenerating ? (
                <div className="py-8 text-center space-y-3">
                    <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin mx-auto" />
                    <p className="text-indigo-800 dark:text-indigo-300 font-medium animate-pulse">Generazione insight clinico...</p>
                    <p className="text-xs text-gray-500 font-medium mb-4">{progress}</p>

                    {/* Progress Bar */}
                    <div className="w-full max-w-[200px] mx-auto h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-4">
                        <div className="h-full bg-indigo-500 w-1/3 animate-[shimmer_1s_infinite_linear] relative">
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent translate-x-[-100%] animate-[shimmer_1.5s_infinite]"></div>
                        </div>
                    </div>
                    <style jsx>{`
                        @keyframes shimmer {
                            0% { transform: translateX(-100%); }
                            100% { transform: translateX(300%); }
                        }
                    `}</style>

                    <button
                        onClick={stopGeneration}
                        className="mt-2 px-4 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-full border border-red-200 transition-colors flex items-center gap-1 mx-auto"
                    >
                        <X className="w-3 h-3" /> Interrompi
                    </button>
                </div>
            ) : hasStructuredInsight ? (
                <div className="space-y-4">
                    {parsedInsight.nextSteps.length > 0 && (
                        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/80 p-4 dark:border-indigo-500/20 dark:bg-indigo-900/10">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                                Prossimi passi suggeriti
                            </p>
                            <div className="mt-3 space-y-2">
                                {parsedInsight.nextSteps.map((step, index) => (
                                    <div
                                        key={`${index}-${step}`}
                                        className="rounded-xl bg-white/80 px-3 py-2 text-sm font-medium text-indigo-950 shadow-sm dark:bg-black/20 dark:text-indigo-100"
                                    >
                                        {index + 1}. <PrivacyBlur intensity="sm">{step}</PrivacyBlur>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {parsedInsight.summary && (
                        <div className="rounded-2xl border border-white/60 bg-white/60 p-4 dark:border-white/10 dark:bg-black/20">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                Quadro clinico
                            </p>
                            <p className="mt-2 text-sm leading-relaxed text-gray-700 dark:text-gray-200">
                                <PrivacyBlur intensity="sm">{parsedInsight.summary}</PrivacyBlur>
                            </p>
                        </div>
                    )}

                    {parsedInsight.alerts.length > 0 && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-500/20 dark:bg-amber-900/10">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                Attenzioni
                            </p>
                            <ul className="mt-2 space-y-1 text-sm text-amber-900 dark:text-amber-100">
                                {parsedInsight.alerts.map((item, index) => (
                                    <li key={`${index}-${item}`} className="flex gap-2">
                                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                                        <PrivacyBlur intensity="sm">{item}</PrivacyBlur>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {parsedInsight.gaps.length > 0 && (
                        <div className="rounded-2xl border border-gray-200 bg-gray-50/80 p-4 dark:border-white/10 dark:bg-white/5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                Gap da chiarire
                            </p>
                            <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-200">
                                {parsedInsight.gaps.map((item, index) => (
                                    <li key={`${index}-${item}`} className="flex gap-2">
                                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-gray-400 shrink-0" />
                                        <PrivacyBlur intensity="sm">{item}</PrivacyBlur>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            ) : (
                <div className="prose prose-sm max-w-none text-gray-700 dark:text-gray-300 prose-headings:text-indigo-900 dark:prose-headings:text-indigo-300 prose-strong:text-indigo-700 dark:prose-strong:text-indigo-400 leading-relaxed bg-white/50 dark:bg-black/20 p-4 rounded-xl border border-indigo-50/50 dark:border-indigo-500/10">
                    <PrivacyBlur>
                        <ReactMarkdown>{parsedInsight.fallbackMarkdown}</ReactMarkdown>
                    </PrivacyBlur>
                </div>
            )}

            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-white/5 flex items-center gap-2 text-[10px] text-gray-400">
                <AlertTriangle className="w-3 h-3 text-amber-500" />
                <span>Generato da IA locale. Verificare sempre le informazioni.</span>
            </div>
        </div>
    );

}
