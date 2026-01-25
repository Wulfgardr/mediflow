'use client';

import { useState, useRef } from 'react';
import { Sparkles, RefreshCw, AlertTriangle, X } from 'lucide-react';
import { db, Patient } from '@/lib/db';
import ReactMarkdown from 'react-markdown';
import PrivacyBlur from '@/components/privacy-blur';

interface AIPatientInsightProps {
    patient: Patient;
}

export default function AIPatientInsight({ patient }: AIPatientInsightProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState<string>("");
    const [error, setError] = useState<string | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);

    const generateInsight = async () => {
        setIsGenerating(true);
        setError(null);
        setProgress("Inizializzazione...");

        // Create new controller for this request
        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            // Import dynamically to ensure safe execution in client
            const { AIService } = await import('@/lib/ai-service');
            const { buildPatientContext } = await import('@/lib/ai-context');
            const ai = await AIService.create();
            const providerName = ai.provider === 'mlx' ? 'Apple MLX' : 'Ollama';
            setProgress(`Connessione a ${providerName}...`);

            if (!await ai.ping()) {
                throw new Error(`AI non risponde. Verifica che ${providerName} sia attivo.`);
            }

            if (controller.signal.aborted) return;

            setProgress("Analisi contesto clinico...");
            const contextData = await buildPatientContext(patient.id!);

            const prompt = `Sei un assistente medico. Analizza questi dati e rispondi in modo COMPLETO ma CONCISO.

FORMATO RICHIESTO:
**Riassunto clinico:** (max 2 righe)

**Punti di attenzione:**
1. [punto 1]
2. [punto 2]
3. [punto 3]

**Prossima mossa:** [azione specifica]

REGOLE IMPORTANTI:
- NON lasciare frasi incomplete o troncate
- Completa sempre ogni frase
- Sii breve ma esaustivo
- Niente introduzioni ("Ecco l'analisi...")

DATI PAZIENTE:
${contextData}`;

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            if (controller.signal.aborted) return;


            setProgress("Generazione insight...");

            // Use generate for a single prompt-response flow
            // Note: Service has internal timeout, but we can't easily cancel internal fetch from here 
            // unless we modify Service to accept signal. 
            // However, the proxy fix (aborting upstream) means if we unmount or if we could signal the service, it works.
            // Ideally passing signal to generate() would be best. 
            // But for now, let's assume if we ignore the result and the proxy keeps going?
            // Wait, we updated the proxy to handle CLIENT abort. 
            // But client fetch in OllamaService needs to receive THIS signal.
            // Since we didn't update OllamaService.generate to accept a signal argument, we can't fully "Kill" the fetch from here yet.
            // But we can at least stop the UI waiting.
            // TODO: Update OllamaService to accept signal? 
            // Let's rely on global timeout for now or just UI reset.
            // Actually, best effort: let's just reset UI.

            const content = await ai.generate(prompt, controller.signal, 1024);

            if (controller.signal.aborted) return;

            if (!content) throw new Error("Risposta vuota dal provider AI");

            // Clean thinking tokens if present (for reasoning models)
            let cleanContent = content.replace(/<unused94>[\s\S]*?(<unused95>|$)/, '').trim();
            cleanContent = cleanContent.replace(/^Plan:\s*/i, '');

            // Fallback: IF cleaning removed everything (model failure/truncation), keep original or throw
            if (!cleanContent && content.length > 0) {
                console.warn("AI Content cleaned to empty. Using raw content fallback.");
                cleanContent = content; // Better than nothing? Or maybe throw error?
                // Let's use content but add a warning prefix
                cleanContent = `[⚠️ AI Output Raw]: ${content}`;
            }

            if (!cleanContent) throw new Error("L'AI ha generato una risposta vuota o non valida.");

            // Save to DB
            await db.patients.update(patient.id!, {
                aiSummary: cleanContent,
                updatedAt: new Date()
            });

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
                        Usa l&apos;intelligenza artificiale per analizzare diario, documenti e terapie e creare un riassunto clinico aggiornato.
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
                    <h3 className="font-bold text-xl text-gray-800 dark:text-white">AI Patient Insight</h3>
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
            ) : (
                <div className="prose prose-sm max-w-none text-gray-700 dark:text-gray-300 prose-headings:text-indigo-900 dark:prose-headings:text-indigo-300 prose-strong:text-indigo-700 dark:prose-strong:text-indigo-400 leading-relaxed bg-white/50 dark:bg-black/20 p-4 rounded-xl border border-indigo-50/50 dark:border-indigo-500/10">
                    <PrivacyBlur>
                        <ReactMarkdown>
                            {(patient.aiSummary || "")
                                .replace(/<unused94>[\s\S]*?(<unused95>|$)/g, '') // Clean on render
                                .replace(/^Plan:\s*/gim, '')
                                .trim()}
                        </ReactMarkdown>
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
