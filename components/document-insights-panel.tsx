'use client';

import { useState } from 'react';
import { FileText, ChevronDown, ChevronUp, Calendar, Sparkles, AlertTriangle, Trash2, Loader2 } from 'lucide-react';
import { ApiConflictError, db, DocumentInsight, Patient } from '@/lib/db';
import ReactMarkdown from 'react-markdown';
import PrivacyBlur from '@/components/privacy-blur';
import { refreshPatientSummaryIfEnabled } from '@/lib/ai-summary-service';
import { useAiModelLabels } from '@/lib/hooks/use-ai-model-labels';
import { qualityLabel, documentClassLabel } from '@/lib/ai-labels';
import { parsePatientDatedRecords } from '@/lib/patient-structured-fields';
import { notifyDbChange } from '@/lib/live-query';
import { persistDocumentInsightsArchive } from '@/lib/domain/documents/document-insights-archive';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';

interface DocumentInsightsPanelProps {
    patient: Patient;
}

export default function DocumentInsightsPanel({ patient }: DocumentInsightsPanelProps) {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [busyAction, setBusyAction] = useState<string | 'all' | null>(null);
    // Modelli reali dalla config invece di nomi hardcoded nel footer.
    const modelLabels = useAiModelLabels();
    const { showToast } = useToast();
    const confirm = useConfirm();

    // Parse insights from patient
    const insights = parsePatientDatedRecords<DocumentInsight>(patient.documentInsights);

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
        if (typeof patient.version !== 'number') {
            showToast({
                tone: 'error',
                title: 'Versione paziente non disponibile',
                description: 'Ricarica la pagina e riprova.'
            });
            return;
        }

        setBusyAction(action);

        try {
            await persistDocumentInsightsArchive({
                updatePatient: db.patients.update.bind(db.patients),
            }, patient, nextInsights);

            setExpandedId((current) => nextInsights.some((insight) => insight.id === current) ? current : null);

            try {
                await refreshPatientSummaryIfEnabled(patient.id);
            } catch (refreshError) {
                console.warn('[DocumentInsightsPanel] AI summary refresh failed', refreshError);
                showToast({
                    tone: 'warning',
                    title: 'Archivio aggiornato',
                    description: 'Non è stato possibile riallineare subito AI Patient Insight.'
                });
            }
        } catch (error) {
            console.error('[DocumentInsightsPanel] Archive update failed', error);
            if (error instanceof ApiConflictError) {
                notifyDbChange('patients');
                showToast({
                    tone: 'error',
                    title: 'Archivio non aggiornato',
                    description: 'Il paziente è stato aggiornato altrove. La scheda viene ricaricata, poi riprova.'
                });
                return;
            }
            showToast({
                tone: 'error',
                title: 'Aggiornamento non riuscito',
                description: "Errore durante l'aggiornamento dell'Archivio Intelligente."
            });
        } finally {
            setBusyAction(null);
        }
    };

    /* @Codex */
    const handleRemoveInsight = async (insightId: string, fileName: string) => {
        const { confirmed } = await confirm({
            title: 'Rimuovere il documento?',
            message: `"${fileName}" verrà rimosso dall'Archivio Intelligente del paziente.`,
            tone: 'danger',
            confirmLabel: 'Rimuovi'
        });
        if (!confirmed) return;

        const nextInsights = insights.filter((insight) => insight.id !== insightId);
        await persistArchive(nextInsights, insightId);
    };

    /* @Codex */
    const handleClearArchive = async () => {
        const { confirmed } = await confirm({
            title: "Svuotare l'Archivio Intelligente?",
            message: 'Tutti i documenti analizzati di questo paziente verranno rimossi.',
            tone: 'danger',
            confirmLabel: 'Svuota'
        });
        if (!confirmed) return;

        await persistArchive([], 'all');
    };

    return (
        <div className="patient-detail-side-section glass-panel border p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                    <div className="rounded-2xl bg-amber-50 p-2 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300">
                        <FileText className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="section-kicker">Archivio paziente</p>
                        <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">Archivio Intelligente</h3>
                        <p className="text-xs text-slate-500">Ultimi {insights.length} documenti analizzati</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {busyAction && (
                        <div className="flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-[11px] text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Aggiornamento...
                        </div>
                    )}
                    <div className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">
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
                                ? 'border-amber-200 dark:border-amber-500/30 bg-amber-50/40 dark:bg-amber-900/10'
                                : 'border-slate-200/80 dark:border-white/10 bg-white/75 dark:bg-white/5 hover:border-slate-300'
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
                                        <p className="max-w-[200px] truncate text-sm font-medium text-slate-900 dark:text-white">
                                            {insight.fileName}
                                        </p>
                                        <div className="flex flex-wrap items-center gap-1 text-xs text-slate-400">
                                            <Calendar className="w-3 h-3" />
                                            {formatDate(insight.date)}
                                            {insight.quality?.level && (
                                                <span className={`ml-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${qualityTone(insight.quality.level)}`}>
                                                    {qualityLabel(insight.quality.level)}
                                                </span>
                                            )}
                                            {insight.routedClass?.classification && insight.routedClass.classification !== 'unknown' && (
                                                <span className="ml-1 inline-flex items-center rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:border-white/10 dark:text-slate-300">
                                                    {documentClassLabel(insight.routedClass.classification)}
                                                </span>
                                            )}
                                            {insight.routedClass?.synthesis?.kind === 'deterministic' && (
                                                <span
                                                    className="ml-1 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                                                    title={insight.routedClass.synthesis.rationale}
                                                >
                                                    Sintesi senza modello: {documentClassLabel(insight.routedClass.classification)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                {expandedId === insight.id ? (
                                    <ChevronUp className="w-4 h-4 text-slate-400" />
                                ) : (
                                    <ChevronDown className="w-4 h-4 text-slate-400" />
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleRemoveInsight(insight.id, insight.fileName)}
                                disabled={busyAction !== null}
                                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
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
                                    <p className="mb-3 text-xs text-slate-500">
                                        Qualita documento: {insight.quality.reason}
                                    </p>
                                )}

                                {insight.autofill?.appliedDiagnoses && insight.autofill.appliedDiagnoses.length > 0 && (
                                    <p className="mb-3 text-xs font-medium text-emerald-700">
                                        Diagnosi aggiunte alla scheda: {insight.autofill.appliedDiagnoses.join(', ')}
                                    </p>
                                )}

                                <div className="prose prose-sm max-w-none text-slate-700 prose-headings:text-slate-900 prose-strong:text-slate-900 dark:text-slate-300 dark:prose-headings:text-white dark:prose-strong:text-white">
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

            <div className="mt-4 flex items-center gap-2 border-t border-slate-200/80 pt-3 text-[10px] text-slate-400 dark:border-white/10">
                <AlertTriangle className="w-3 h-3 text-amber-500" />
                <span>{modelLabels ? `Sintesi generata da IA locale (${modelLabels.ocr} + ${modelLabels.clinical}). Verificare sempre.` : 'Sintesi generata da IA locale. Verificare sempre.'}</span>
            </div>
        </div>
    );
}
