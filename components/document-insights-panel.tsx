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
import { LumeFilo } from '@/components/ui/lume-filo';

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
        if (level === 'green') return 'border-[color:color-mix(in_srgb,var(--lume-signal-success)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-success)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-success)_60%,var(--lume-ink))]';
        if (level === 'red') return 'border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]';
        return 'border-[color:color-mix(in_srgb,var(--lume-signal-warning)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]';
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
        <div className="patient-detail-side-section lume-panel border p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                    <div className="rounded-2xl bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] p-2 text-[color:var(--lume-ink-muted)]">
                        <FileText className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="section-kicker">Archivio paziente</p>
                        <h3 className="mt-1 text-lg font-semibold text-[color:var(--lume-ink)]">Archivio Intelligente</h3>
                        <p className="text-xs text-[color:var(--lume-ink-muted)]">Ultimi {insights.length} documenti analizzati</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {busyAction && (
                        <div className="flex items-center gap-1 rounded-full border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-2 py-1 text-[11px] text-[color:var(--lume-ink-muted)]">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Aggiornamento...
                        </div>
                    )}
                    <div className="flex items-center gap-1 rounded-full bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] px-2 py-1 text-xs font-medium text-[color:var(--lume-ink-muted)]">
                        <Sparkles className="w-3 h-3" />
                        Estrazione locale + AI
                    </div>
                    <button
                        type="button"
                        onClick={() => void handleClearArchive()}
                        disabled={busyAction !== null}
                        className="inline-flex items-center gap-1 rounded-full border border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] px-2 py-1 text-xs font-medium text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))] transition-colors hover:bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] disabled:cursor-not-allowed disabled:opacity-50"
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
                        className={`rounded-xl border transition-[border-color,background-color] ${expandedId === insight.id
                                ? 'border-[color:color-mix(in_srgb,var(--lume-accent)_30%,transparent)] bg-[color:var(--lume-surface-focal)]'
                                : 'border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] hover:border-[color:color-mix(in_srgb,var(--lume-ink)_24%,transparent)]'
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
                                            ? 'bg-[color:color-mix(in_srgb,var(--lume-accent)_11%,var(--lume-surface-field))] text-[color:var(--lume-accent)]'
                                            : 'bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] text-[color:var(--lume-ink-muted)]'
                                        }`}>
                                        <FileText className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <p className="max-w-[200px] truncate text-sm font-medium text-[color:var(--lume-ink)]">
                                            {insight.fileName}
                                        </p>
                                        <div className="flex flex-wrap items-center gap-1 text-xs text-[color:var(--lume-ink-muted)]">
                                            <Calendar className="w-3 h-3" />
                                            {formatDate(insight.date)}
                                            {insight.quality?.level && (
                                                <span className={`ml-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${qualityTone(insight.quality.level)}`}>
                                                    {qualityLabel(insight.quality.level)}
                                                </span>
                                            )}
                                            {insight.routedClass?.classification && insight.routedClass.classification !== 'unknown' && (
                                                <span className="ml-1 inline-flex items-center rounded-full border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--lume-ink-muted)]">
                                                    {documentClassLabel(insight.routedClass.classification)}
                                                </span>
                                            )}
                                            {insight.routedClass?.synthesis?.kind === 'deterministic' && (
                                                <span
                                                    className="ml-1 inline-flex items-center rounded-full border border-[color:color-mix(in_srgb,var(--lume-signal-success)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-success)_11%,var(--lume-surface-field))] px-2 py-0.5 text-[10px] font-medium text-[color:color-mix(in_srgb,var(--lume-signal-success)_60%,var(--lume-ink))]"
                                                    title={insight.routedClass.synthesis.rationale}
                                                >
                                                    Sintesi senza modello: {documentClassLabel(insight.routedClass.classification)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                {expandedId === insight.id ? (
                                    <ChevronUp className="w-4 h-4 text-[color:var(--lume-ink-muted)]" />
                                ) : (
                                    <ChevronDown className="w-4 h-4 text-[color:var(--lume-ink-muted)]" />
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleRemoveInsight(insight.id, insight.fileName)}
                                disabled={busyAction !== null}
                                className="rounded-lg p-2 text-[color:var(--lume-ink-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] hover:text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))] disabled:cursor-not-allowed disabled:opacity-50"
                                title="Rimuovi dall'archivio intelligente"
                                aria-label={`Rimuovi ${insight.fileName} dall'archivio intelligente`}
                            >
                                {busyAction === insight.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                        </div>

                        {expandedId === insight.id && (
                            <div className="relative px-4 pb-4 pl-9">
                                <LumeFilo variant="connettore" fill={100} className="absolute left-4 top-0 h-4 w-5" />
                                {Array.isArray(insight.extractedData?.diagnoses) && insight.extractedData.diagnoses.length > 0 && (
                                    <div className="mb-3 flex flex-wrap gap-2">
                                        {insight.extractedData.diagnoses.map((diagnosis) => (
                                            <span
                                                key={`${diagnosis.system}-${diagnosis.code}`}
                                                className="inline-flex items-center rounded-full border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] px-2.5 py-1 text-[11px] font-medium text-[color:var(--lume-ink)]"
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
                                                className="inline-flex items-center rounded-full border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] px-2.5 py-1 text-[11px] font-medium text-[color:var(--lume-ink)]"
                                            >
                                                Terapia · {medication}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {insight.quality?.reason && (
                                    <p className="mb-3 text-xs text-[color:var(--lume-ink-muted)]">
                                        Qualita documento: {insight.quality.reason}
                                    </p>
                                )}

                                {insight.autofill?.appliedDiagnoses && insight.autofill.appliedDiagnoses.length > 0 && (
                                    <p className="mb-3 text-xs font-medium text-[color:color-mix(in_srgb,var(--lume-signal-success)_60%,var(--lume-ink))]">
                                        Diagnosi aggiunte alla scheda: {insight.autofill.appliedDiagnoses.join(', ')}
                                    </p>
                                )}

                                <div className="prose prose-sm max-w-none text-[color:var(--lume-ink-muted)] prose-headings:text-[color:var(--lume-ink)] prose-strong:text-[color:var(--lume-ink)]">
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

            <div className="mt-4 flex items-center gap-2 border-t border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] pt-3 text-[10px] text-[color:var(--lume-ink-muted)]">
                <AlertTriangle className="w-3 h-3 text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]" />
                <span>{modelLabels ? `Sintesi generata da IA locale (${modelLabels.clinical}). Verificare sempre.` : 'Sintesi generata da IA locale. Verificare sempre.'}</span>
            </div>
        </div>
    );
}
