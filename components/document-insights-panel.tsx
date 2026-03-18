'use client';

import { useState } from 'react';
import { FileText, ChevronDown, ChevronUp, Calendar, Sparkles, AlertTriangle, Trash2, Loader2 } from 'lucide-react';
import { db, DocumentInsight, Patient } from '@/lib/db';
import ReactMarkdown from 'react-markdown';
import PrivacyBlur from '@/components/privacy-blur';
import { regeneratePatientSummary } from '@/lib/ai-summary-service';

interface DocumentInsightsPanelProps {
    patient: Patient;
}

export default function DocumentInsightsPanel({ patient }: DocumentInsightsPanelProps) {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [busyAction, setBusyAction] = useState<string | 'all' | null>(null);

    // Parse insights from patient
    const insights: DocumentInsight[] = patient.documentInsights
        ? (typeof patient.documentInsights === 'string'
            ? JSON.parse(patient.documentInsights)
            : patient.documentInsights)
        : [];

    if (!patient.id || insights.length === 0) {
        return null; // Don't render if no insights
    }

    const formatDate = (date: Date | string) => {
        const d = new Date(date);
        return d.toLocaleDateString('it-IT', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    };

    /* @Codex */
    const qualityTone = (level?: string) => {
        if (level === 'green') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
        if (level === 'red') return 'bg-red-50 text-red-700 border-red-200';
        return 'bg-amber-50 text-amber-700 border-amber-200';
    };

    /* @Codex */
    const persistArchive = async (nextInsights: DocumentInsight[], action: string | 'all') => {
        setBusyAction(action);

        try {
            await db.patients.update(patient.id, {
                documentInsights: nextInsights,
                updatedAt: new Date()
            });

            setExpandedId((current) => nextInsights.some((insight) => insight.id === current) ? current : null);

            try {
                await regeneratePatientSummary(patient.id);
            } catch (refreshError) {
                console.warn('[DocumentInsightsPanel] AI summary refresh failed', refreshError);
                alert("Archivio aggiornato, ma non è stato possibile riallineare subito AI Patient Insight.");
            }
        } catch (error) {
            console.error('[DocumentInsightsPanel] Archive update failed', error);
            alert("Errore durante l'aggiornamento dell'Archivio Intelligente.");
        } finally {
            setBusyAction(null);
        }
    };

    /* @Codex */
    const handleRemoveInsight = async (insightId: string, fileName: string) => {
        const confirmed = confirm(`Rimuovere "${fileName}" dall'Archivio Intelligente del paziente?`);
        if (!confirmed) return;

        const nextInsights = insights.filter((insight) => insight.id !== insightId);
        await persistArchive(nextInsights, insightId);
    };

    /* @Codex */
    const handleClearArchive = async () => {
        const confirmed = confirm("Svuotare completamente l'Archivio Intelligente di questo paziente?");
        if (!confirmed) return;

        await persistArchive([], 'all');
    };

    return (
        <div className="glass-panel p-6 relative overflow-hidden border-amber-100 dark:border-amber-500/20 shadow-lg shadow-amber-100/50 dark:shadow-none">
            {/* Background Decoration */}
            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <FileText className="w-32 h-32 text-amber-900 dark:text-amber-400" />
            </div>

            <div className="flex justify-between items-start mb-4 relative z-10 gap-3">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-amber-500 text-white rounded-lg shadow-md shadow-amber-200 dark:shadow-none">
                        <FileText className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="font-bold text-xl text-gray-800 dark:text-white">Archivio Intelligente</h3>
                        <p className="text-xs text-gray-500">Ultimi {insights.length} documenti analizzati</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {busyAction && (
                        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-white/80 dark:bg-black/20 text-[11px] text-gray-500 border border-gray-200 dark:border-gray-700">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Aggiornamento...
                        </div>
                    )}
                    <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 text-xs font-medium">
                        <Sparkles className="w-3 h-3" />
                        OCR + AI
                    </div>
                    <button
                        type="button"
                        onClick={() => void handleClearArchive()}
                        disabled={busyAction !== null}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {busyAction === 'all' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        Svuota archivio
                    </button>
                </div>
            </div>

            <div className="space-y-3">
                {insights.map((insight, index) => (
                    <div
                        key={insight.id}
                        className={`rounded-xl border transition-all ${expandedId === insight.id
                                ? 'border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-900/10'
                                : 'border-gray-100 dark:border-gray-700 bg-white/50 dark:bg-black/20 hover:border-amber-100'
                            }`}
                    >
                        <div className="flex items-start gap-2 p-3">
                            <button
                                type="button"
                                onClick={() => setExpandedId(expandedId === insight.id ? null : insight.id)}
                                className="flex-1 flex items-center justify-between text-left"
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg ${index === 0
                                            ? 'bg-amber-100 text-amber-600'
                                            : 'bg-gray-100 text-gray-500'
                                        }`}>
                                        <FileText className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-sm text-gray-800 dark:text-white truncate max-w-[200px]">
                                            {insight.fileName}
                                        </p>
                                        <div className="flex flex-wrap items-center gap-1 text-xs text-gray-400">
                                            <Calendar className="w-3 h-3" />
                                            {formatDate(insight.date)}
                                            {insight.quality?.level && (
                                                <span className={`ml-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${qualityTone(insight.quality.level)}`}>
                                                    {insight.quality.level}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                {expandedId === insight.id ? (
                                    <ChevronUp className="w-4 h-4 text-gray-400" />
                                ) : (
                                    <ChevronDown className="w-4 h-4 text-gray-400" />
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleRemoveInsight(insight.id, insight.fileName)}
                                disabled={busyAction !== null}
                                className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                title="Rimuovi dall'archivio intelligente"
                                aria-label={`Rimuovi ${insight.fileName} dall'archivio intelligente`}
                            >
                                {busyAction === insight.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                        </div>

                        {expandedId === insight.id && (
                            <div className="px-4 pb-4">
                                {Array.isArray(insight.extractedData?.diagnoses) && insight.extractedData.diagnoses.length > 0 && (
                                    <div className="mb-3 flex flex-wrap gap-2">
                                        {insight.extractedData.diagnoses.map((diagnosis) => (
                                            <span
                                                key={`${diagnosis.system}-${diagnosis.code}`}
                                                className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700"
                                            >
                                                {diagnosis.system} {diagnosis.code} · {diagnosis.description}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {Array.isArray(insight.extractedData?.medications) && insight.extractedData.medications.length > 0 && (
                                    <div className="mb-3 flex flex-wrap gap-2">
                                        {insight.extractedData.medications.map((medication) => (
                                            <span
                                                key={`${insight.id}:${medication}`}
                                                className="inline-flex items-center rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                                            >
                                                Terapia · {medication}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {insight.quality?.reason && (
                                    <p className="mb-3 text-xs text-gray-500">
                                        Qualita documento: {insight.quality.reason}
                                    </p>
                                )}

                                {insight.autofill?.appliedDiagnoses && insight.autofill.appliedDiagnoses.length > 0 && (
                                    <p className="mb-3 text-xs font-medium text-emerald-700">
                                        Diagnosi aggiunte alla scheda: {insight.autofill.appliedDiagnoses.join(', ')}
                                    </p>
                                )}

                                <div className="prose prose-sm max-w-none text-gray-700 dark:text-gray-300 prose-headings:text-amber-900 dark:prose-headings:text-amber-300 prose-strong:text-amber-700 dark:prose-strong:text-amber-400 leading-relaxed">
                                    <PrivacyBlur>
                                        <ReactMarkdown>
                                            {insight.summary}
                                        </ReactMarkdown>
                                    </PrivacyBlur>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-white/5 flex items-center gap-2 text-[10px] text-gray-400">
                <AlertTriangle className="w-3 h-3 text-amber-500" />
                <span>Sintesi generata da IA locale (DeepSeek OCR 2 + Qwen 3.5 35B A3B). Verificare sempre.</span>
            </div>
        </div>
    );
}
