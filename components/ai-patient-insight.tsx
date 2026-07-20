'use client';

import { useState, useRef } from 'react';
import { Sparkles, RefreshCw, AlertTriangle } from 'lucide-react';
import { db, Patient } from '@/lib/db';
import ReactMarkdown from 'react-markdown';
import PrivacyBlur from '@/components/privacy-blur';
import Link from 'next/link';
import { useLiveQuery } from '@/lib/live-query';
/* @Codex */
import { regeneratePatientSummary } from '@/lib/ai-summary-service';
import { useAiModelLabels } from '@/lib/hooks/use-ai-model-labels';
/* @Codex */
import { coerceInsightToReadable } from '@/lib/patient-insight-view-model';
import {
    AI_PATIENT_INSIGHT_KILL_SWITCH_KEY,
    AiPatientInsightDisabledError,
    isAiPatientInsightEnabledValue,
} from '@/lib/ai-patient-insight-kill-switch';

interface AIPatientInsightProps {
    patient: Patient;
    /* Insight presente ma piu vecchio dell'ultimo dato clinico (dal detail page). */
    stale?: boolean;
}

export default function AIPatientInsight({ patient, stale = false }: AIPatientInsightProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState<string>("");
    const [error, setError] = useState<string | null>(null);
    /* @Codex */
    const [modelLabel, setModelLabel] = useState<string>("");
    const aiModelLabels = useAiModelLabels();
    /* @Codex */
    const patientInsightKillSwitch = useLiveQuery(
        () => db.settings.get(AI_PATIENT_INSIGHT_KILL_SWITCH_KEY),
        [],
        undefined,
        ['settings'],
    );

    const abortControllerRef = useRef<AbortController | null>(null);
    /* @Codex */
    const readable = coerceInsightToReadable(patient.aiSummary || '');
    /* @Codex */
    const hasDiagnostics = readable.kind !== 'unreadable' && Boolean(
        readable.sourcesMarkdown || readable.limitsMarkdown,
    );
    /* @Codex */
    const patientInsightEnabled = isAiPatientInsightEnabledValue(patientInsightKillSwitch?.value);

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

            // La pagina legge patient.aiSummary via useLiveQuery: la scrittura su
            // db.patients invalida la query e ridisegna il pannello senza reload.
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
                className="patient-ai-insight-panel lume-panel overflow-hidden border-red-200/70 p-6 dark:border-red-500/20"
                data-testid="patient-insight-disabled-card"
            >
                <div className="flex flex-col items-center text-center space-y-5">
                    <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-red-100 text-red-600 shadow-[0_12px_24px_rgba(239,68,68,0.12)] dark:bg-red-500/10 dark:text-red-300">
                        <AlertTriangle className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-500">Funzione AI disattivata</p>
                        <h3 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">Patient Insight disabilitata</h3>
                        <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                            La funzione è stata fermata localmente per prudenza. La scheda resta consultabile, ma non avvia nuove generazioni finché l&apos;interruttore non viene riattivato in Impostazioni.
                        </p>
                    </div>

                    <Link
                        href="/settings/ai/funzioni"
                        className="lume-press inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg transition-[background-color,color] hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                    >
                        Apri Impostazioni AI
                    </Link>
                </div>
            </div>
        );
    }

    if (!patient.aiSummary && !isGenerating) {
        return (
            <div className="patient-ai-insight-panel lume-panel overflow-hidden p-6">
                <div className="flex flex-col items-center text-center space-y-5">
                    <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-slate-900 text-white shadow-[0_12px_24px_rgba(15,23,42,0.14)] dark:bg-white dark:text-slate-900">
                        <Sparkles className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Supporto clinico</p>
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
                        className="lume-press inline-flex items-center gap-2 rounded-full bg-slate-900 px-8 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(15,23,42,0.12)] transition-[background-color,color] hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                    >
                        <Sparkles className="w-4 h-4" />
                        Avvia supporto
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="patient-ai-insight-panel lume-panel overflow-hidden p-0">
            <div className="border-b border-slate-200/50 p-5 dark:border-white/5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-[18px] bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200">
                            <Sparkles className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-slate-900 dark:text-white">Supporto al ragionamento clinico</h3>
                            {(modelLabel || aiModelLabels?.clinical) && (
                                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-tight">Clinico: {modelLabel || aiModelLabels?.clinical}</p>
                            )}
                            {patient.aiSummaryGeneratedAt && (
                                <p className="text-[10px] font-medium text-slate-400 tracking-tight">
                                    Generato il {new Date(patient.aiSummaryGeneratedAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    {stale && (
                                        <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                                            Dati modificati dopo la generazione
                                        </span>
                                    )}
                                </p>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={generateInsight}
                        disabled={isGenerating || !patientInsightEnabled}
                        className="flex h-9 items-center gap-2 rounded-full border border-slate-200/80 bg-white/80 px-4 text-xs font-semibold text-slate-700 transition-[background-color,color,opacity] hover:bg-white disabled:opacity-50 dark:border-white/10 dark:bg-white/10 dark:text-slate-200"
                    >
                        {isGenerating ? (
                            <RefreshCw className="w-3.5 h-3.5" />
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
                            <p className="mt-1">Puoi consultare l&apos;ultimo riepilogo salvato, ma la rigenerazione resta bloccata finché non riattivi l&apos;interruttore in Impostazioni.</p>
                        </div>
                    </div>
                )}

                {isGenerating ? (
                    <div className="py-12 text-center space-y-4">
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[var(--lume-radius-card)] bg-[color:var(--lume-surface-field)] text-[color:var(--lume-ink-muted)]">
                            <Sparkles className="h-6 w-6" aria-hidden="true" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-bold text-slate-700 dark:text-[color:rgba(255,255,255,0.86)]">Analisi in corso</p>
                            <p className="text-[10px] font-medium uppercase tracking-widest text-[color:var(--lume-ink-muted)]">{progress}</p>
                        </div>

                        
                        <button
                            onClick={stopGeneration}
                            className="mt-4 text-[10px] font-bold uppercase tracking-wider text-red-500 hover:text-red-600"
                        >
                            Interrompi
                        </button>
                    </div>
                ) : readable.kind === 'structured' ? (
                    <div className="space-y-5">
                        {readable.nextSteps.length > 0 && (
                            <div className="rounded-[var(--lume-radius-card)] border border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] bg-[color:var(--lume-surface-field)] p-4 text-[color:var(--lume-ink-muted)] transition-colors duration-[var(--lume-dur-firma)]">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                        Follow-up proposto
                                    </p>
                                    <span className="rounded-[var(--lume-radius-control)] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-[color:var(--lume-ink-muted)]">
                                        Bozza
                                    </span>
                                </div>
                                <div className="mt-3 space-y-2">
                                    {readable.nextSteps.map((step, index) => (
                                        <div
                                            key={`${index}-${step}`}
                                            className="flex gap-3 text-sm font-medium text-slate-800 dark:text-slate-100"
                                        >
                                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] text-slate-600 ring-1 ring-slate-200 dark:bg-white/10 dark:text-slate-200 dark:ring-white/10">
                                                {index + 1}
                                            </span>
                                            <PrivacyBlur intensity="sm">{step}</PrivacyBlur>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {readable.summary && (
                            <div className="px-1">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                    Sintesi clinica
                                </p>
                                <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-200">
                                    <PrivacyBlur intensity="sm">{readable.summary}</PrivacyBlur>
                                </p>
                            </div>
                        )}

                        {readable.alerts.length > 0 && (
                            <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/5">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                    Attenzioni
                                </p>
                                <ul className="mt-3 space-y-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                                    {readable.alerts.map((item, index) => (
                                        <li key={`${index}-${item}`} className="flex gap-2">
                                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                                            <PrivacyBlur intensity="sm">{item}</PrivacyBlur>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {readable.gaps.length > 0 && (
                            <div className="px-1">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                    Dati mancanti
                                </p>
                                <ul className="mt-3 space-y-1.5 text-sm text-slate-600 dark:text-slate-400">
                                    {readable.gaps.map((item, index) => (
                                        <li key={`${index}-${item}`} className="flex gap-2">
                                            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-300 dark:bg-slate-700" />
                                            <PrivacyBlur intensity="sm">{item}</PrivacyBlur>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                ) : readable.kind === 'markdown' ? (
                    <div className="prose prose-sm max-w-none rounded-[24px] border border-slate-200/50 bg-slate-50/30 p-4 text-slate-700 dark:border-white/5 dark:bg-white/5 dark:text-slate-300">
                        <PrivacyBlur>
                            <ReactMarkdown>{readable.markdown}</ReactMarkdown>
                        </PrivacyBlur>
                    </div>
                ) : (
                    <div
                        className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/5"
                        data-testid="patient-insight-unreadable"
                    >
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                            <div className="min-w-0 space-y-1">
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {readable.reason === 'json-envelope'
                                        ? 'Insight salvato non leggibile'
                                        : 'Insight non ancora disponibile'}
                                </p>
                                <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">
                                    {readable.reason === 'json-envelope'
                                        ? "Il supporto AI ha salvato una risposta in un formato che non possiamo mostrare in chiaro. Rigenera l'insight per ottenere sintesi, attenzioni e prossimi passi."
                                        : "Avvia il supporto al ragionamento per produrre sintesi, attenzioni e prossimi passi."}
                                </p>
                                <div className="flex flex-wrap gap-2 pt-2">
                                    <button
                                        type="button"
                                        onClick={generateInsight}
                                        disabled={isGenerating || !patientInsightEnabled}
                                        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-slate-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                                    >
                                        <RefreshCw className="h-3 w-3" />
                                        Rigenera
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {hasDiagnostics && (
                    <details className="mt-5 rounded-[24px] border border-slate-100 bg-slate-50/50 dark:border-white/5 dark:bg-white/5">
                        <summary className="flex cursor-pointer items-center justify-between p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Fonti e Avvisi
                        </summary>
                        <div className="p-4 pt-0 space-y-3 text-xs text-slate-500 dark:text-slate-400">
                            {readable.sourcesMarkdown && (
                                <div className="prose prose-xs max-w-none dark:prose-invert">
                                    <PrivacyBlur intensity="sm">
                                        <ReactMarkdown>{readable.sourcesMarkdown}</ReactMarkdown>
                                    </PrivacyBlur>
                                </div>
                            )}
                            {readable.limitsMarkdown && (
                                <div className="prose prose-xs max-w-none dark:prose-invert border-t border-slate-200/50 pt-3 dark:border-white/5">
                                    <PrivacyBlur intensity="sm">
                                        <ReactMarkdown>{readable.limitsMarkdown}</ReactMarkdown>
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
