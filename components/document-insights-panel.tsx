'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle, Trash2, Loader2 } from 'lucide-react';
import { ApiConflictError, db, DocumentInsight, Patient } from '@/lib/db';
import ReactMarkdown from 'react-markdown';
import PrivacyBlur from '@/components/privacy-blur';
import { useAiModelLabels } from '@/lib/hooks/use-ai-model-labels';
import { qualityLabel, documentClassLabel } from '@/lib/ai-labels';
import { parsePatientDatedRecords } from '@/lib/patient-structured-fields';
import { notifyDbChange } from '@/lib/live-query';
import { persistDocumentInsightsArchive } from '@/lib/domain/documents/document-insights-archive';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';
import disclosure from '@/components/patient-disclosure.module.css';

interface DocumentInsightsPanelProps {
    patient: Patient;
}

export default function DocumentInsightsPanel({ patient }: DocumentInsightsPanelProps) {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [busyAction, setBusyAction] = useState<string | 'all' | null>(null);
    const insights = parsePatientDatedRecords<DocumentInsight>(patient.documentInsights);
    // @Codex: an empty archive has no model footer and needs no model reads.
    const modelLabels = useAiModelLabels(Boolean(patient.id) && insights.length > 0);
    const { showToast } = useToast();
    const confirm = useConfirm();

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
            title: 'Rimuovere la sintesi archiviata?',
            message: `La sintesi di "${fileName}" verrà rimossa. Gli allegati della cartella restano disponibili.`,
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
            title: 'Svuotare le sintesi archiviate?',
            message: 'Le sintesi archiviate verranno rimosse. Gli allegati della cartella restano disponibili.',
            tone: 'danger',
            confirmLabel: 'Svuota'
        });
        if (!confirmed) return;

        await persistArchive([], 'all');
    };

    return (
        /* @Codex: archived summaries share the document plane; only the active row expands. */
        <section className={disclosure.archive} aria-label="Sintesi archiviate" data-testid="document-insights-archive">
            <div className={disclosure.archiveToolbar}>
                <p className={disclosure.hint}>Rivedi le sintesi insieme al testo sorgente.</p>
                {busyAction && <span className={disclosure.hint} role="status">Aggiornamento…</span>}
                <button
                    type="button"
                    onClick={() => void handleClearArchive()}
                    disabled={busyAction !== null}
                    className={`${disclosure.documentAction} ${disclosure.removeAction}`}
                >
                    {busyAction === 'all' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                    Svuota archivio
                </button>
            </div>

            {insights.map((insight) => (
                <article key={insight.id} className={disclosure.archiveRow} data-expanded={expandedId === insight.id}>
                    <div className={disclosure.archiveHead}>
                        <button
                            type="button"
                            onClick={() => setExpandedId(expandedId === insight.id ? null : insight.id)}
                            className={disclosure.archiveToggle}
                            aria-expanded={expandedId === insight.id}
                            aria-controls={`document-insight-${insight.id}`}
                        >
                            <span className={disclosure.archiveLabel}>
                                <span className={disclosure.documentTitle}>{insight.fileName}</span>
                                <span className={disclosure.hint}>Archiviata il {formatDate(insight.date)}</span>
                                <span className={disclosure.archiveMetadata}>
                                    {insight.quality?.level && (
                                        <span className={`inline-flex rounded-md border px-2 py-0.5 text-[13px] font-medium ${qualityTone(insight.quality.level)}`}>
                                            {qualityLabel(insight.quality.level)}
                                        </span>
                                    )}
                                    {insight.routedClass?.classification && insight.routedClass.classification !== 'unknown' && (
                                        <span className={disclosure.hint}>{documentClassLabel(insight.routedClass.classification)}</span>
                                    )}
                                    {insight.routedClass?.synthesis?.kind === 'deterministic' && (
                                        <span className={disclosure.hint} title={insight.routedClass.synthesis.rationale}>Sintesi senza modello</span>
                                    )}
                                </span>
                            </span>
                            {expandedId === insight.id ? <ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />}
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleRemoveInsight(insight.id, insight.fileName)}
                            disabled={busyAction !== null}
                            className={`${disclosure.documentAction} ${disclosure.removeAction}`}
                            title="Rimuovi la sintesi archiviata"
                            aria-label={`Rimuovi ${insight.fileName} dall'archivio intelligente`}
                        >
                            {busyAction === insight.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                        </button>
                    </div>

                    <div id={`document-insight-${insight.id}`} hidden={expandedId !== insight.id}>
                        {expandedId === insight.id && (
                            <div className={disclosure.archiveContent}>
                                {Array.isArray(insight.extractedData?.diagnoses) && insight.extractedData.diagnoses.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {insight.extractedData.diagnoses.map((diagnosis) => (
                                            <span key={`${diagnosis.system}-${diagnosis.code}`} className="text-sm text-[color:var(--lume-ink)]">
                                                {diagnosis.system} {diagnosis.code} · {diagnosis.description}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {Array.isArray(insight.extractedData?.medications) && insight.extractedData.medications.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {insight.extractedData.medications.map((medication) => (
                                            <span key={`${insight.id}:${medication}`} className="text-sm text-[color:var(--lume-ink)]">Terapia · {medication}</span>
                                        ))}
                                    </div>
                                )}
                                {insight.quality?.reason && <p className={disclosure.hint}>Qualità documento: {insight.quality.reason}</p>}
                                {insight.autofill?.appliedDiagnoses && insight.autofill.appliedDiagnoses.length > 0 && (
                                    <p className="text-sm font-medium text-[color:var(--lume-ink)]">Diagnosi aggiunte alla scheda: {insight.autofill.appliedDiagnoses.join(', ')}</p>
                                )}
                                <div className="prose prose-sm max-w-none text-[color:var(--lume-ink-muted)] prose-headings:text-[color:var(--lume-ink)] prose-strong:text-[color:var(--lume-ink)]">
                                    <PrivacyBlur><ReactMarkdown>{insight.summary}</ReactMarkdown></PrivacyBlur>
                                </div>
                                {insight.rawMarkdown?.trim() && (
                                    <details className={disclosure.disclosure}>
                                        <summary>Testo sorgente archiviato</summary>
                                        <p className={disclosure.hint}>Testo conservato con questa sintesi. Confrontalo con il documento originale.</p>
                                        <pre className={disclosure.archivedSource}><PrivacyBlur>{insight.rawMarkdown}</PrivacyBlur></pre>
                                    </details>
                                )}
                            </div>
                        )}
                    </div>
                </article>
            ))}

            <div className={disclosure.archiveFooter}>
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <p>Verifica le sintesi prima di usarle. {modelLabels ? `Modello configurato ora: ${modelLabels.clinical}. ` : ''}Il modello usato per ciascuna sintesi non è registrato nell’archivio.</p>
            </div>
        </section>
    );
}
