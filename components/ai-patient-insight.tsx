'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles, RefreshCw, AlertTriangle, X } from 'lucide-react';
import { Patient } from '@/lib/db';
import ReactMarkdown from 'react-markdown';
import PrivacyBlur from '@/components/privacy-blur';
/* @Codex */
import { regeneratePatientSummary, getAiModelLabels, parsePatientInsight } from '@/lib/ai-summary-service';
/* @Codex */
import { splitInsightDiagnostics } from '@/lib/patient-insight';

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
    const diagnostics = splitInsightDiagnostics(patient.aiSummary || '');
    /* @Codex */
    const hasDiagnostics = Boolean(diagnostics.sourcesMarkdown || diagnostics.limitsMarkdown);

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
            <div className="glass-panel p-6 flex flex-col items-start space-y-4">
                <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-300">
                    <Sparkles className="w-6 h-6" />
                </div>
                <div>
                    <p className="section-kicker">Supporto decisionale</p>
                    <h3 className="mt-1 font-semibold text-slate-900 dark:text-white">Genera Patient Insight</h3>
                    <p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
                        Usa l&apos;intelligenza artificiale per ottenere un quadro clinico breve, citabile e orientato all&apos;azione.
                    </p>
                </div>

                {error && (
                    <div className="text-xs text-red-500 bg-red-50 p-2 rounded-lg border border-red-100 max-w-sm">
                        {error}
                    </div>
                )}

                <button
                    onClick={generateInsight}
                    className="inline-flex items-center gap-2 rounded-2xl bg-[#0A84FF] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0077ED]"
                >
                    <Sparkles className="w-4 h-4" />
                    Genera Insight
                </button>
            </div>
        );
    }

    return (
        <div className="glass-panel p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
                <div className="flex items-center gap-2">
                    <div className="rounded-2xl bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-300">
                        <Sparkles className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="section-kicker">Supporto decisionale</p>
                        <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">AI Patient Insight</h3>
                        {modelLabel && (
                            <p className="text-[10px] text-slate-500">Modello: {modelLabel}</p>
                        )}
                    </div>
                </div>

                <button
                    onClick={generateInsight}
                    disabled={isGenerating}
                    className="flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/85 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-white disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-white/20"
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
                <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs text-red-600">
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
                        <div className="apple-subsection">
                            <p className="section-kicker text-indigo-700 dark:text-indigo-300">
                                Prossimi passi suggeriti
                            </p>
                            <div className="mt-3 space-y-2">
                                {parsedInsight.nextSteps.map((step, index) => (
                                    <div
                                        key={`${index}-${step}`}
                                        className="rounded-2xl border border-slate-200/80 bg-white/85 px-3 py-2.5 text-sm font-medium text-slate-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-100"
                                    >
                                        {index + 1}. <PrivacyBlur intensity="sm">{step}</PrivacyBlur>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {parsedInsight.summary && (
                        <div className="apple-subsection">
                            <p className="section-kicker">
                                Quadro clinico
                            </p>
                            <p className="mt-2 text-sm leading-7 text-slate-700 dark:text-slate-200">
                                <PrivacyBlur intensity="sm">{parsedInsight.summary}</PrivacyBlur>
                            </p>
                        </div>
                    )}

                    {parsedInsight.alerts.length > 0 && (
                        <div className="rounded-[24px] border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-500/20 dark:bg-amber-900/10">
                            <p className="section-kicker text-amber-700 dark:text-amber-300">
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
                        <div className="apple-subsection">
                            <p className="section-kicker">
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
                <div className="prose prose-sm max-w-none rounded-[24px] border border-slate-200/80 bg-white/80 p-4 text-slate-700 prose-headings:text-slate-900 prose-strong:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:prose-headings:text-white dark:prose-strong:text-white">
                    <PrivacyBlur>
                        <ReactMarkdown>{diagnostics.mainMarkdown || parsedInsight.fallbackMarkdown}</ReactMarkdown>
                    </PrivacyBlur>
                </div>
            )}

            {hasDiagnostics && (
                <details className="rounded-[24px] border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-500/20 dark:bg-amber-900/10">
                    <summary className="cursor-pointer text-sm font-semibold text-amber-800 dark:text-amber-200">
                        Fonti e avvisi AI
                    </summary>
                    <div className="mt-3 space-y-3 text-sm text-amber-950 dark:text-amber-100">
                        {diagnostics.sourcesMarkdown && (
                            <div className="prose prose-sm max-w-none">
                                <PrivacyBlur intensity="sm">
                                    <ReactMarkdown>{diagnostics.sourcesMarkdown}</ReactMarkdown>
                                </PrivacyBlur>
                            </div>
                        )}
                        {diagnostics.limitsMarkdown && (
                            <div className="prose prose-sm max-w-none">
                                <PrivacyBlur intensity="sm">
                                    <ReactMarkdown>{diagnostics.limitsMarkdown}</ReactMarkdown>
                                </PrivacyBlur>
                            </div>
                        )}
                    </div>
                </details>
            )}

            <div className="mt-4 flex items-center gap-2 border-t border-slate-200/80 pt-3 text-[10px] text-slate-400 dark:border-white/10">
                <AlertTriangle className="w-3 h-3 text-amber-500" />
                <span>Generato da IA locale. Apri “Fonti e avvisi AI” per citazioni e limiti di supporto.</span>
            </div>
        </div>
    );

}
