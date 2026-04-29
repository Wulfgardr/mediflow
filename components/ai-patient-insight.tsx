'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles, RefreshCw, AlertTriangle } from 'lucide-react';
import { db, Patient } from '@/lib/db';
import ReactMarkdown from 'react-markdown';
import PrivacyBlur from '@/components/privacy-blur';
import Link from 'next/link';
import { useLiveQuery } from '@/lib/live-query';
/* @Codex */
import { regeneratePatientSummary, getAiModelLabels, parsePatientInsight } from '@/lib/ai-summary-service';
/* @Codex */
import { splitInsightDiagnostics } from '@/lib/patient-insight';
import {
    AI_PATIENT_INSIGHT_KILL_SWITCH_KEY,
    AiPatientInsightDisabledError,
    isAiPatientInsightEnabledValue,
} from '@/lib/ai-patient-insight-kill-switch';

interface AIPatientInsightProps {
    patient: Patient;
}

export default function AIPatientInsight({ patient }: AIPatientInsightProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState<string>("");
    const [error, setError] = useState<string | null>(null);
    /* @Codex */
    const [modelLabel, setModelLabel] = useState<string>("");
    /* @Codex */
    const patientInsightKillSwitch = useLiveQuery(() => db.settings.get(AI_PATIENT_INSIGHT_KILL_SWITCH_KEY), []);

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
    const patientInsightEnabled = isAiPatientInsightEnabledValue(patientInsightKillSwitch?.value);

    /* @Codex */
    useEffect(() => {
        const loadModels = async () => {
            const models = await getAiModelLabels();
            setModelLabel(models.clinical);
        };
        loadModels();
    }, []);

    const generateInsight = async () => {
        if (!patientInsightEnabled) {
            setError("Patient Insight è disabilitata localmente. Riattivala in Impostazioni per generare nuovi insight.");
            return;
        }

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
            if (err instanceof AiPatientInsightDisabledError) {
                setError("Patient Insight è disabilitata localmente. Riattivala in Impostazioni per generare nuovi insight.");
                return;
            }
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


    if (!patient.aiSummary && !isGenerating && !patientInsightEnabled) {
        return (
            <div
                className="patient-ai-insight-panel glass-panel overflow-hidden rounded-[28px] border-red-200/70 bg-red-50/20 p-6 backdrop-blur-xl dark:border-red-500/20 dark:bg-red-950/10"
                data-testid="patient-insight-disabled-card"
            >
                <div className="flex flex-col items-center text-center space-y-5">
                    <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-red-100 text-red-600 shadow-[0_12px_24px_rgba(239,68,68,0.12)] dark:bg-red-500/10 dark:text-red-300">
                        <AlertTriangle className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-500">Kill switch locale</p>
                        <h3 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">Patient Insight disabilitata</h3>
                        <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                            La lane è stata fermata localmente per prudenza. La scheda resta consultabile, ma non avvia nuove generazioni finché il toggle non viene riattivato in Impostazioni.
                        </p>
                    </div>

                    <Link
                        href="/settings#ai"
                        className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                    >
                        Apri Impostazioni AI
                    </Link>
                </div>
            </div>
        );
    }

    if (!patient.aiSummary && !isGenerating) {
        return (
            <div className="patient-ai-insight-panel glass-panel overflow-hidden rounded-[28px] border-[color:rgba(94,53,95,0.14)] bg-[color:rgba(94,53,95,0.04)] p-6 backdrop-blur-xl dark:border-[color:rgba(94,53,95,0.2)] dark:bg-[color:rgba(94,53,95,0.08)]">
                <div className="flex flex-col items-center text-center space-y-5">
                    <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-[linear-gradient(135deg,var(--mf-plum),var(--mf-primary),var(--mf-accent))] text-white shadow-[0_12px_24px_rgba(94,53,95,0.18)]">
                        <Sparkles className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--mf-plum)]">Clinical Reasoning Support</p>
                        <h3 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">Genera supporto di ragionamento clinico</h3>
                        <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                            Ottieni sintesi, red flag, dati mancanti e follow-up suggeriti senza trasformare la scheda in una chat generica.
                        </p>
                    </div>

                    {error && (
                        <div className="text-xs text-red-500 bg-red-50 p-3 rounded-[20px] border border-red-100 max-w-sm">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={generateInsight}
                        className="inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,var(--mf-plum),var(--mf-primary))] px-8 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5"
                    >
                        <Sparkles className="w-4 h-4" />
                        Avvia supporto
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="patient-ai-insight-panel glass-panel overflow-hidden rounded-[28px] border-white/40 bg-white/60 p-0 backdrop-blur-2xl dark:border-white/10 dark:bg-white/5">
            <div className="border-b border-slate-200/50 p-5 dark:border-white/5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-[18px] bg-[color:rgba(94,53,95,0.08)] text-[color:var(--mf-plum)] dark:bg-[color:rgba(94,53,95,0.12)]">
                            <Sparkles className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-slate-900 dark:text-white">Clinical Reasoning Support</h3>
                            {modelLabel && (
                                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-tight">Clinico: {modelLabel}</p>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={generateInsight}
                        disabled={isGenerating || !patientInsightEnabled}
                        className="flex h-9 items-center gap-2 rounded-full border border-slate-200/80 bg-white/80 px-4 text-xs font-semibold text-slate-700 transition-all hover:bg-white disabled:opacity-50 dark:border-white/10 dark:bg-white/10 dark:text-slate-200"
                    >
                        {isGenerating ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        {isGenerating ? 'Analisi...' : patientInsightEnabled ? 'Aggiorna' : 'Disabilitata'}
                    </button>
                </div>
            </div>

            <div className="p-5">
                {error && (
                    <div className="mb-4 flex items-center gap-2 rounded-[20px] border border-red-200 bg-red-50 p-3 text-xs text-red-600">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        {error}
                    </div>
                )}

                {!patientInsightEnabled && (
                    <div
                        className="mb-4 flex items-start gap-2 rounded-[20px] border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-900/10 dark:text-red-200"
                        data-testid="patient-insight-disabled-banner"
                    >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                            <p className="font-semibold">Patient Insight disabilitata localmente</p>
                            <p className="mt-1">Puoi consultare l&apos;ultimo insight salvato, ma la rigenerazione resta bloccata finché non riattivi il toggle in Impostazioni.</p>
                        </div>
                    </div>
                )}

                {isGenerating ? (
                    <div className="py-12 text-center space-y-4">
                        <div className="relative mx-auto h-16 w-16">
                            <RefreshCw className="w-16 h-16 text-[color:rgba(94,53,95,0.2)] animate-[spin_3s_linear_infinite]" />
                            <Sparkles className="absolute inset-0 m-auto w-6 h-6 text-[color:var(--mf-plum)] animate-pulse" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-bold text-[color:var(--mf-plum)] dark:text-[color:rgba(255,255,255,0.86)]">Analisi in corso</p>
                            <p className="text-[10px] font-medium uppercase tracking-widest text-[color:var(--mf-muted)]">{progress}</p>
                        </div>

                        <div className="mx-auto w-48 overflow-hidden rounded-full bg-[color:rgba(94,53,95,0.1)] dark:bg-[color:rgba(94,53,95,0.14)]">
                            <div className="h-1 animate-[shimmer_1.5s_infinite_linear] bg-[linear-gradient(90deg,var(--mf-plum),var(--mf-primary),var(--mf-accent))]" style={{ width: '40%' }} />
                        </div>
                        
                        <button
                            onClick={stopGeneration}
                            className="mt-4 text-[10px] font-bold uppercase tracking-wider text-red-500 hover:text-red-600"
                        >
                            Interrompi
                        </button>
                    </div>
                ) : hasStructuredInsight ? (
                    <div className="space-y-5">
                        {parsedInsight.nextSteps.length > 0 && (
                            <div className="rounded-[24px] bg-[color:rgba(15,123,104,0.08)] p-4 dark:bg-[color:rgba(15,123,104,0.12)]">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--mf-primary)]">
                                    Follow-up proposto
                                </p>
                                <div className="mt-3 space-y-2">
                                    {parsedInsight.nextSteps.map((step, index) => (
                                        <div
                                            key={`${index}-${step}`}
                                            className="flex gap-3 text-sm font-medium text-slate-800 dark:text-slate-100"
                                        >
                                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:rgba(15,123,104,0.12)] text-[10px] text-[color:var(--mf-primary)] dark:bg-[color:rgba(15,123,104,0.16)]">
                                                {index + 1}
                                            </span>
                                            <PrivacyBlur intensity="sm">{step}</PrivacyBlur>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {parsedInsight.summary && (
                            <div className="px-1">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                    Sintesi clinica
                                </p>
                                <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-200">
                                    <PrivacyBlur intensity="sm">{parsedInsight.summary}</PrivacyBlur>
                                </p>
                            </div>
                        )}

                        {parsedInsight.alerts.length > 0 && (
                            <div className="rounded-[24px] border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-500/10 dark:bg-amber-900/10">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
                                    Attenzioni
                                </p>
                                <ul className="mt-3 space-y-2 text-sm font-medium text-amber-900 dark:text-amber-100">
                                    {parsedInsight.alerts.map((item, index) => (
                                        <li key={`${index}-${item}`} className="flex gap-2">
                                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                                            <PrivacyBlur intensity="sm">{item}</PrivacyBlur>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {parsedInsight.gaps.length > 0 && (
                            <div className="px-1">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                    Dati mancanti
                                </p>
                                <ul className="mt-3 space-y-1.5 text-sm text-slate-600 dark:text-slate-400">
                                    {parsedInsight.gaps.map((item, index) => (
                                        <li key={`${index}-${item}`} className="flex gap-2">
                                            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-300 dark:bg-slate-700" />
                                            <PrivacyBlur intensity="sm">{item}</PrivacyBlur>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="prose prose-sm max-w-none rounded-[24px] border border-slate-200/50 bg-slate-50/30 p-4 text-slate-700 dark:border-white/5 dark:bg-white/5 dark:text-slate-300">
                        <PrivacyBlur>
                            <ReactMarkdown>{diagnostics.mainMarkdown || parsedInsight.fallbackMarkdown}</ReactMarkdown>
                        </PrivacyBlur>
                    </div>
                )}

                {hasDiagnostics && (
                    <details className="mt-5 rounded-[24px] border border-slate-100 bg-slate-50/50 dark:border-white/5 dark:bg-white/5">
                        <summary className="flex cursor-pointer items-center justify-between p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Fonti e Avvisi
                        </summary>
                        <div className="p-4 pt-0 space-y-3 text-xs text-slate-500 dark:text-slate-400">
                            {diagnostics.sourcesMarkdown && (
                                <div className="prose prose-xs max-w-none dark:prose-invert">
                                    <PrivacyBlur intensity="sm">
                                        <ReactMarkdown>{diagnostics.sourcesMarkdown}</ReactMarkdown>
                                    </PrivacyBlur>
                                </div>
                            )}
                            {diagnostics.limitsMarkdown && (
                                <div className="prose prose-xs max-w-none dark:prose-invert border-t border-slate-200/50 pt-3 dark:border-white/5">
                                    <PrivacyBlur intensity="sm">
                                        <ReactMarkdown>{diagnostics.limitsMarkdown}</ReactMarkdown>
                                    </PrivacyBlur>
                                </div>
                            )}
                        </div>
                    </details>
                )}
            </div>

            <div className="bg-slate-50 p-4 text-[9px] font-medium uppercase tracking-wider text-slate-400 dark:bg-white/5">
                <div className="flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3" />
                    <span>Supporto decisionale IA locale • Non sostituisce il giudizio clinico</span>
                </div>
            </div>
            
            <style jsx>{`
                @keyframes shimmer {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(400%); }
                }
            `}</style>
        </div>
    );

}
