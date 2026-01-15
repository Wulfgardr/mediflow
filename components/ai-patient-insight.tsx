'use client';

import { useState } from 'react';
import { Sparkles, RefreshCw, AlertTriangle } from 'lucide-react';
import { db, Patient } from '@/lib/db';
import { getAiEngine } from '@/lib/ai-engine';
import ReactMarkdown from 'react-markdown';
import PrivacyBlur from '@/components/privacy-blur';

interface AIPatientInsightProps {
    patient: Patient;
}

export default function AIPatientInsight({ patient }: AIPatientInsightProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState<string>("");

    const generateInsight = async () => {
        setIsGenerating(true);
        setProgress("Inizializzazione motore AI...");
        try {
            const engine = await getAiEngine();

            setProgress("Analisi dati clinici in corso...");

            // 1. Gather Context
            const attachments = await db.attachments.where('patientId').equals(patient.id).toArray();

            // Filter out deleted entries
            const allEntries = await db.entries.where('patientId').equals(patient.id).reverse().limit(20).toArray();
            const entries = allEntries.filter(e => !e.deletedAt); // IGNORE DELETED ITEMS

            // Fetch therapies (Active, Suspended, Ended - but NOT soft deleted "mistakes")
            const allTherapies = await db.therapies.where('patientId').equals(patient.id).toArray();
            const therapies = allTherapies.filter(t => !t.deletedAt);

            const docsContext = attachments
                .filter(a => a.summarySnapshot && a.source !== 'visit')
                .slice(0, 10) // Explicitly limit to 10 manuals
                .map(a => `- DOC (${new Date(a.createdAt).toLocaleDateString()}): ${a.summarySnapshot}`)
                .join("\n");

            const diaryContext = entries
                .map(e => `- ${new Date(e.date).toLocaleDateString()} (${e.type}): ${e.content} ${e.metadata?.score ? '(Score: ' + e.metadata.score + ')' : ''}`)
                .join("\n");

            const therapyContext = therapies
                .map(t => {
                    let statusTags = "";
                    if (t.status === 'suspended') statusTags = " [SOSPESO]";
                    if (t.status === 'ended') statusTags = ` [TERMINATO il ${new Date(t.updatedAt).toLocaleDateString()}]`;
                    return `- ${t.drugName} ${t.dosage}${statusTags} ${t.motivation ? `(Note: ${t.motivation})` : ''}`;
                })
                .join("\n");

            const prompt = `
Sei un assistente medico esperto. Genera un "Insight Clinico" per ${patient.firstName} ${patient.lastName}.
OBIETTIVO: Fornire una visione olistica del paziente in MASSIMO 10 RIGHE. Sii estremamente sintetico.

DATI:
- Documenti: ${docsContext || "Nessuno"}
- Diario: ${diaryContext || "Nessuno"}
- Terapia: ${therapyContext || "Nessuna"}

FORMATO RISPOSTA (Max 10 righe totali):
**Quadro**: [1-2 frasi su diagnosi e stato attuale]
**Attenzione**: [Cosa monitorare oggi]
**Terapia**: [Note sulla compliance o modifiche recenti]

Non dilungarti. Usa elenchi puntati solo se strettamente necessario.
            `;

            const reply = await engine.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: "hf.co/unsloth/medgemma-1.5-4b-it-GGUF",
                temperature: 0.1,
            });

            let summary = reply.choices[0].message.content || "Impossibile generare il riassunto.";

            // Remove Chain of Thought if present
            summary = summary.replace(/<unused94>[\s\S]*?<unused95>/, '').trim();

            // 2. Save to DB
            await db.patients.update(patient.id, {
                aiSummary: summary,
                updatedAt: new Date()
            });

        } catch (error) {
            console.error("AI Error:", error);
            alert("Errore durante la generazione dell'insight. Riprova.");
        } finally {
            setIsGenerating(false);
            setProgress("");
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
                <button
                    onClick={generateInsight}
                    className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/30 hover:bg-indigo-700 transition-all active:scale-95 flex items-center gap-2"
                >
                    <Sparkles className="w-4 h-4" />
                    Genera Ora
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

            {isGenerating ? (
                <div className="py-8 text-center space-y-3">
                    <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin mx-auto" />
                    <p className="text-indigo-800 dark:text-indigo-300 font-medium animate-pulse">Generazione insight clinico...</p>
                    <p className="text-xs text-gray-400 font-mono">{progress}</p>
                </div>
            ) : (
                <div className="prose prose-sm max-w-none text-gray-700 dark:text-gray-300 prose-headings:text-indigo-900 dark:prose-headings:text-indigo-300 prose-strong:text-indigo-700 dark:prose-strong:text-indigo-400 leading-relaxed bg-white/50 dark:bg-black/20 p-4 rounded-xl border border-indigo-50/50 dark:border-indigo-500/10">
                    <PrivacyBlur>
                        <ReactMarkdown>{patient.aiSummary || ""}</ReactMarkdown>
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
