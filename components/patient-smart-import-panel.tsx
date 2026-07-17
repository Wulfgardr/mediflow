'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
    AlertTriangle,
    Brain,
    CheckCircle2,
    Edit3,
    Pill,
    RefreshCw,
    Sparkles,
    Stethoscope,
    Trash2,
} from 'lucide-react';
import PrivacyBlur from '@/components/privacy-blur';
import { useLiveQuery } from '@/lib/live-query';
import { confidenceLabel, matchTypeLabel } from '@/lib/ai-labels';
import { db, type ClinicalEntry, type Patient } from '@/lib/db';
import {
    AI_SMART_IMPORT_KILL_SWITCH_KEY,
    AiSmartImportDisabledError,
    isAiSmartImportEnabledValue,
} from '@/lib/ai-smart-import-kill-switch';
import {
    applyPatientSmartImportSelection,
    generatePatientSmartImportAnalysis,
    type DiagnosisSmartImportSuggestion,
    type PatientSmartImportAnalysis,
    type SmartImportReviewState,
    type TherapySmartImportSuggestion,
    type TherapySuggestionState,
} from '@/lib/domain/documents/patient-smart-import-service';
import type { SmartImportReviewSnapshot } from '@/lib/domain/documents/patient-review-queue-summary';
import { semanticSignalSurfaceClass } from '@/components/ui/semantic-signal';
import {
    smartImportReviewStateSignal,
    therapySuggestionStateSignal,
} from '@/lib/ui-semantic-signal';

interface PatientSmartImportPanelProps {
    patient: Patient;
    entries?: ClinicalEntry[];
    /* WUL-262: lets patient detail mirror reviewable/blocked/ready counts in the
       review-queue summary without duplicating panel state or behavior. */
    onReviewSnapshotChange?: (snapshot: SmartImportReviewSnapshot) => void;
}

export function countUsableSources(
    patient: Patient,
    entries: ClinicalEntry[] | undefined,
    attachmentSummaryCount: number
): number {
    const documentInsightCount = Array.isArray(patient.documentInsights) ? patient.documentInsights.length : 0;

    return [
        patient.notes?.trim() ? 1 : 0,
        entries?.filter((entry) => !entry.deletedAt && entry.content?.trim()).length || 0,
        documentInsightCount,
        attachmentSummaryCount,
    ].reduce((total, count) => total + count, 0);
}

function therapyStateLabel(state: TherapySuggestionState): string {
    if (state === 'transition') return 'transizione';
    if (state === 'uncertain') return 'incerta';
    if (state === 'inactive') return 'non attiva';
    return 'attiva';
}

function therapyStateBadgeClasses(state: TherapySuggestionState): string {
    return semanticSignalSurfaceClass(therapySuggestionStateSignal(state));
}

function reviewStateLabel(state: SmartImportReviewState): string {
    if (state === 'already-present') return 'gia presente';
    if (state === 'update') return 'aggiornamento';
    if (state === 'transition') return 'transizione';
    if (state === 'inactive') return 'sospesa';
    if (state === 'uncertain') return 'incerto';
    return 'nuovo';
}

function reviewStateBadgeClasses(state: SmartImportReviewState): string {
    return semanticSignalSurfaceClass(smartImportReviewStateSignal(state));
}

function reviewStateCardClasses(state: SmartImportReviewState, isSelected: boolean): string {
    if (state === 'new') {
        return isSelected
            ? 'border-[color:color-mix(in_srgb,var(--lume-accent)_30%,transparent)] bg-[color:var(--lume-surface-focal)] shadow-[var(--lume-shadow-focal)]'
            : 'border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-focal)] hover:border-[color:color-mix(in_srgb,var(--lume-accent)_30%,transparent)]';
    }

    return semanticSignalSurfaceClass(smartImportReviewStateSignal(state));
}

function sourceKindLabel(kind: DiagnosisSmartImportSuggestion['evidence']['sourceKind']): string {
    if (kind === 'clinical-entry') return 'Diario clinico';
    if (kind === 'document-insight') return 'Documento analizzato';
    if (kind === 'attachment-summary') return 'Allegato';
    return 'Note paziente';
}

function formatEvidenceMeta(
    evidence: DiagnosisSmartImportSuggestion['evidence']
): string {
    const parts = [sourceKindLabel(evidence.sourceKind), evidence.label];
    if (evidence.date) {
        const date = new Date(evidence.date);
        if (!Number.isNaN(date.getTime())) {
            parts.push(date.toLocaleDateString('it-IT'));
        }
    }
    return parts.filter(Boolean).join(' · ');
}

function shouldPreselectDiagnosisSuggestion(diagnosis: DiagnosisSmartImportSuggestion): boolean {
    return diagnosis.canApply && diagnosis.confidence === 'high';
}

function shouldPreselectTherapySuggestion(therapy: TherapySmartImportSuggestion): boolean {
    return therapy.canApply
        && therapy.confidence === 'high'
        && therapy.matchType === 'catalog'
        && therapy.therapyState === 'active'
        && Boolean((therapy.reviewedDosage || therapy.dosage)?.trim());
}

function getDiagnosisDisplayLabel(diagnosis: DiagnosisSmartImportSuggestion): string {
    return diagnosis.reviewedLabel?.trim() || diagnosis.label;
}

function getTherapyDisplayName(therapy: TherapySmartImportSuggestion): string {
    return therapy.reviewedDrugName?.trim() || therapy.match?.name || therapy.drugMention;
}

function getTherapyDisplayPrinciple(therapy: TherapySmartImportSuggestion): string {
    return therapy.reviewedActivePrinciple?.trim() || therapy.activePrinciple || therapy.match?.activePrinciple || '';
}

function getTherapyDisplayDosage(therapy: TherapySmartImportSuggestion): string {
    return therapy.reviewedDosage?.trim() || therapy.dosage || '';
}

function countSelectedReviewItems(
    diagnosisIds: string[],
    therapyIds: string[],
): number {
    return diagnosisIds.length + therapyIds.length;
}

function formatResolverScore(score: number): string {
    return `${Math.round(score)}`;
}

const smartImportInputClassName = "h-10 w-full rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-focal)] px-3 text-sm text-[color:var(--lume-ink)] outline-none transition-colors focus:border-[color:var(--lume-accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--lume-accent)_20%,transparent)]";

// @Codex: Smart Import often renders in a narrow patient side rail, so actions must not share a cramped title row.
function ReviewActionButtons({
    isEditing,
    onToggleEditor,
    onDiscard,
}: {
    isEditing: boolean;
    onToggleEditor: () => void;
    onDiscard: () => void;
}) {
    return (
        <div className="flex flex-wrap gap-2">
            <button
                type="button"
                onClick={onToggleEditor}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] px-3 text-[10px] font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)] transition-[border-color,background-color,color] hover:border-[color:color-mix(in_srgb,var(--lume-accent)_30%,transparent)] hover:bg-[color:var(--lume-surface-focal)] hover:text-[color:var(--lume-ink)]"
            >
                <Edit3 className="h-3 w-3" />
                {isEditing ? 'Chiudi modifica' : 'Modifica'}
            </button>
            <button
                type="button"
                onClick={onDiscard}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] px-3 text-[10px] font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)] transition-[border-color,background-color,color] hover:border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] hover:text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]"
            >
                <Trash2 className="h-3 w-3" />
                Scarta
            </button>
        </div>
    );
}

function DiagnosisResolverPreview({ diagnosis }: { diagnosis: DiagnosisSmartImportSuggestion }) {
    return (
        <div className="space-y-2 rounded-[20px] border border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] bg-[color:var(--lume-surface-field)] p-3">
            <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">Resolver ICD locale</p>
                {diagnosis.resolver.queries.length > 0 && (
                    <span className="max-w-full break-words rounded-full bg-[color:var(--lume-surface-focal)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--lume-ink-muted)]">
                        {diagnosis.resolver.queries.join(' · ')}
                    </span>
                )}
            </div>
            {diagnosis.resolver.candidates.length > 0 ? (
                <div className="space-y-2">
                    {diagnosis.resolver.candidates.map((candidate) => (
                        <div
                            key={`${candidate.code}-${candidate.query}`}
                            className="rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] bg-[color:var(--lume-surface-focal)] p-2.5"
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-[10px] font-bold text-[color:var(--lume-ink)]">
                                    {candidate.code}
                                </span>
                                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tight ${candidate.selected ? 'bg-[color:var(--lume-ink)] text-[color:var(--lume-surface-focal)]' : 'bg-[color:var(--lume-surface-field)] text-[color:var(--lume-ink-muted)]'}`}>
                                    {candidate.selected ? 'scelto' : `score ${formatResolverScore(candidate.score)}`}
                                </span>
                            </div>
                            <p className="mt-1 break-words text-[11px] font-medium text-[color:var(--lume-ink)]">{candidate.description}</p>
                            <p className="mt-1 break-words text-[10px] text-[color:var(--lume-ink-muted)]">Query: {candidate.query}</p>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-[11px] text-[color:var(--lume-ink-muted)]">Nessun candidato ICD-11 locale affidabile.</p>
            )}
        </div>
    );
}

function TherapyResolverPreview({ therapy }: { therapy: TherapySmartImportSuggestion }) {
    return (
        <div className="space-y-2 rounded-[20px] border border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] bg-[color:var(--lume-surface-field)] p-3">
            <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">Resolver AIFA locale</p>
                {therapy.resolver.searchTerms.length > 0 && (
                    <span className="max-w-full break-words rounded-full bg-[color:var(--lume-surface-focal)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--lume-ink-muted)]">
                        {therapy.resolver.searchTerms.join(' · ')}
                    </span>
                )}
            </div>
            {therapy.resolver.candidates.length > 0 ? (
                <div className="space-y-2">
                    {therapy.resolver.candidates.map((candidate) => (
                        <div
                            key={`${candidate.aic}-${candidate.searchTerm}`}
                            className="rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] bg-[color:var(--lume-surface-focal)] p-2.5"
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-[10px] font-bold text-[color:var(--lume-ink)]">
                                    AIC {candidate.aic}
                                </span>
                                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tight ${candidate.selected ? 'bg-[color:var(--lume-ink)] text-[color:var(--lume-surface-focal)]' : 'bg-[color:var(--lume-surface-field)] text-[color:var(--lume-ink-muted)]'}`}>
                                    {candidate.selected ? 'scelto' : `score ${formatResolverScore(candidate.score)}`}
                                </span>
                                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tight ${candidate.dosageAligned ? 'bg-[color:var(--lume-surface-field)] text-[color:var(--lume-ink)]' : 'bg-[color:var(--lume-surface-canvas)] text-[color:var(--lume-ink-muted)]'}`}>
                                    {candidate.dosageAligned ? 'dosaggio coerente' : 'dosaggio divergente'}
                                </span>
                            </div>
                            <p className="mt-1 break-words text-[11px] font-medium text-[color:var(--lume-ink)]">{candidate.name}</p>
                            <p className="mt-1 break-words text-[10px] text-[color:var(--lume-ink-muted)]">
                                {[candidate.activePrinciple, candidate.packaging, candidate.atc ? `ATC ${candidate.atc}` : undefined]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </p>
                            <p className="mt-1 break-words text-[10px] text-[color:var(--lume-ink-muted)]">Search: {candidate.searchTerm}</p>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-[11px] text-[color:var(--lume-ink-muted)]">Nessun candidato AIFA locale affidabile.</p>
            )}
        </div>
    );
}

export default function PatientSmartImportPanel({ patient, entries = [], onReviewSnapshotChange }: PatientSmartImportPanelProps) {
    const [analysis, setAnalysis] = useState<PatientSmartImportAnalysis | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isApplying, setIsApplying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedDiagnosisIds, setSelectedDiagnosisIds] = useState<string[]>([]);
    const [selectedTherapyIds, setSelectedTherapyIds] = useState<string[]>([]);
    const [editingDiagnosisIds, setEditingDiagnosisIds] = useState<string[]>([]);
    const [editingTherapyIds, setEditingTherapyIds] = useState<string[]>([]);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    const attachments = useLiveQuery(
        async () => {
            const items = await db.attachments.query({ patientId: patient.id }).toArray();
            // summarySnapshot is ENC:-encrypted: this filter must stay client-side,
            // it runs on the decrypted value after ApiTable.decryptItem().
            return items.filter((attachment) => attachment.summarySnapshot?.trim());
        },
        [patient.id],
        undefined,
        ['attachments'],
    );
    const smartImportKillSwitch = useLiveQuery(
        () => db.settings.get(AI_SMART_IMPORT_KILL_SWITCH_KEY),
        [],
        undefined,
        ['settings'],
    );

    const sourceCount = countUsableSources(patient, entries, attachments?.length || 0);
    const smartImportEnabled = isAiSmartImportEnabledValue(smartImportKillSwitch?.value);

    const reviewableCount = analysis
        ? analysis.diagnoses.filter((diagnosis) => diagnosis.canApply && !selectedDiagnosisIds.includes(diagnosis.id)).length
        + analysis.therapies.filter((therapy) => therapy.canApply && !selectedTherapyIds.includes(therapy.id)).length
        : 0;
    const blockedCount = analysis
        ? analysis.diagnoses.filter((diagnosis) => !diagnosis.canApply).length
        + analysis.therapies.filter((therapy) => !therapy.canApply).length
        : 0;
    const selectedCount = countSelectedReviewItems(selectedDiagnosisIds, selectedTherapyIds);

    /* WUL-262: report-only mirror of the review state already shown by this
       panel; the effect must run before any early return (rules of hooks). */
    const hasAnalysis = Boolean(analysis);
    useEffect(() => {
        onReviewSnapshotChange?.({
            hasAnalysis,
            reviewable: reviewableCount,
            blocked: blockedCount,
            ready: selectedCount,
        });
    }, [onReviewSnapshotChange, hasAnalysis, reviewableCount, blockedCount, selectedCount]);

    if (sourceCount === 0) {
        return null;
    }

    const updateDiagnosisSuggestion = (
        id: string,
        updater: (diagnosis: DiagnosisSmartImportSuggestion) => DiagnosisSmartImportSuggestion
    ) => {
        setAnalysis((current) => {
            if (!current) return current;
            return {
                ...current,
                diagnoses: current.diagnoses.map((diagnosis) => (
                    diagnosis.id === id ? updater(diagnosis) : diagnosis
                )),
            };
        });
    };

    const updateTherapySuggestion = (
        id: string,
        updater: (therapy: TherapySmartImportSuggestion) => TherapySmartImportSuggestion
    ) => {
        setAnalysis((current) => {
            if (!current) return current;
            return {
                ...current,
                therapies: current.therapies.map((therapy) => (
                    therapy.id === id ? updater(therapy) : therapy
                )),
            };
        });
    };

    const removeDiagnosisSuggestion = (id: string) => {
        setAnalysis((current) => {
            if (!current) return current;
            return {
                ...current,
                diagnoses: current.diagnoses.filter((diagnosis) => diagnosis.id !== id),
            };
        });
        setSelectedDiagnosisIds((current) => current.filter((item) => item !== id));
        setEditingDiagnosisIds((current) => current.filter((item) => item !== id));
    };

    const removeTherapySuggestion = (id: string) => {
        setAnalysis((current) => {
            if (!current) return current;
            return {
                ...current,
                therapies: current.therapies.filter((therapy) => therapy.id !== id),
            };
        });
        setSelectedTherapyIds((current) => current.filter((item) => item !== id));
        setEditingTherapyIds((current) => current.filter((item) => item !== id));
    };

    const toggleDiagnosisEditor = (id: string) => {
        setEditingDiagnosisIds((current) => (
            current.includes(id)
                ? current.filter((item) => item !== id)
                : [...current, id]
        ));
    };

    const toggleTherapyEditor = (id: string) => {
        setEditingTherapyIds((current) => (
            current.includes(id)
                ? current.filter((item) => item !== id)
                : [...current, id]
        ));
    };

    const generateSuggestions = async () => {
        if (!smartImportEnabled) {
            setError('Smart Import è disabilitato localmente. Riattivalo in Impostazioni per analizzare nuove fonti.');
            return;
        }

        setIsGenerating(true);
        setError(null);
        setStatusMessage(null);

        try {
            const nextAnalysis = await generatePatientSmartImportAnalysis(patient.id);
            setAnalysis(nextAnalysis);
            setSelectedDiagnosisIds(
                nextAnalysis.diagnoses
                    .filter(shouldPreselectDiagnosisSuggestion)
                    .map((diagnosis) => diagnosis.id)
            );
            setSelectedTherapyIds(
                nextAnalysis.therapies
                    .filter(shouldPreselectTherapySuggestion)
                    .map((therapy) => therapy.id)
            );
            setEditingDiagnosisIds([]);
            setEditingTherapyIds([]);
        } catch (generationError) {
            if (generationError instanceof AiSmartImportDisabledError) {
                setError('Smart Import è disabilitato localmente. Riattivalo in Impostazioni per analizzare nuove fonti.');
            } else {
                setError(generationError instanceof Error ? generationError.message : 'Analisi non disponibile');
            }
        } finally {
            setIsGenerating(false);
        }
    };

    const toggleDiagnosis = (id: string) => {
        setSelectedDiagnosisIds((current) => (
            current.includes(id)
                ? current.filter((item) => item !== id)
                : [...current, id]
        ));
    };

    const toggleTherapy = (id: string) => {
        setSelectedTherapyIds((current) => (
            current.includes(id)
                ? current.filter((item) => item !== id)
                : [...current, id]
        ));
    };

    const applySelection = async () => {
        if (!analysis) return;
        if (!smartImportEnabled) {
            setError('Smart Import è disabilitato localmente. Riattivalo in Impostazioni per applicare suggerimenti.');
            return;
        }

        setIsApplying(true);
        setError(null);
        setStatusMessage(null);

        try {
            const result = await applyPatientSmartImportSelection(patient.id, analysis, {
                diagnosisIds: selectedDiagnosisIds,
                therapyIds: selectedTherapyIds,
            });

            setAnalysis({
                ...analysis,
                diagnoses: analysis.diagnoses.filter((diagnosis) => !result.appliedDiagnosisIds.includes(diagnosis.id)),
                therapies: analysis.therapies.filter((therapy) => !result.appliedTherapyIds.includes(therapy.id)),
            });
            setSelectedDiagnosisIds((current) => current.filter((id) => !result.appliedDiagnosisIds.includes(id)));
            setSelectedTherapyIds((current) => current.filter((id) => !result.appliedTherapyIds.includes(id)));
            setEditingDiagnosisIds((current) => current.filter((id) => !result.appliedDiagnosisIds.includes(id)));
            setEditingTherapyIds((current) => current.filter((id) => !result.appliedTherapyIds.includes(id)));
            setStatusMessage(`Import completato: ${result.diagnosesApplied} diagnosi, ${result.therapiesApplied} terapie.`);
        } catch (applyError) {
            if (applyError instanceof AiSmartImportDisabledError) {
                setError('Smart Import è disabilitato localmente. Riattivalo in Impostazioni per applicare suggerimenti.');
            } else {
                setError(applyError instanceof Error ? applyError.message : 'Applicazione non riuscita');
            }
        } finally {
            setIsApplying(false);
        }
    };

    if (!analysis && !isGenerating && !smartImportEnabled) {
        return (
            <div
                className="lume-panel overflow-hidden border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] p-6"
                data-testid="smart-import-disabled-card"
            >
                <div className="flex flex-col items-center text-center space-y-5">
                    <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))] shadow-[var(--lume-shadow-focal)]">
                        <AlertTriangle className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">Funzione AI disattivata</p>
                        <h3 className="mt-2 text-xl font-bold text-[color:var(--lume-ink)]">Smart Import disabilitato</h3>
                        <p className="mt-2 max-w-sm text-sm leading-relaxed text-[color:var(--lume-ink-muted)]">
                            La funzione è stata fermata localmente per prudenza. La scheda resta consultabile, ma non avvia analisi né applicazioni finché l&apos;interruttore non viene riattivato in Impostazioni.
                        </p>
                    </div>

                    <Link
                        href="/settings/ai/funzioni"
                        className="inline-flex items-center gap-2 rounded-full bg-[color:var(--lume-ink)] px-6 py-3 text-sm font-semibold text-[color:var(--lume-surface-focal)] shadow-[var(--lume-shadow-focal)] transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-[color:var(--lume-accent)]"
                    >
                        Apri Impostazioni AI
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="patient-detail-section lume-panel overflow-hidden rounded-[28px] border p-0">
            <div className="border-b border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] p-5">
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] bg-[color:var(--lume-ink)] text-[color:var(--lume-surface-focal)] shadow-[var(--lume-shadow-focal)]">
                            <Brain className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h3 className="text-base font-bold text-[color:var(--lume-ink)]">Smart Import</h3>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="inline-flex items-center rounded-full bg-[color:var(--lume-surface-field)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tight text-[color:var(--lume-ink-muted)]">
                                    {sourceCount} fonti
                                </span>
                                {analysis && (
                                    <span className="break-all text-[9px] font-medium uppercase tracking-tight text-[color:var(--lume-ink-muted)]">
                                        {analysis.model.model}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={generateSuggestions}
                        disabled={isGenerating || isApplying || !smartImportEnabled}
                        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-full bg-[color:var(--lume-ink)] px-5 text-xs font-bold text-[color:var(--lume-surface-focal)] shadow-[var(--lume-shadow-focal)] transition-[background-color,opacity,transform] hover:bg-[color:var(--lume-accent)] active:scale-95 disabled:opacity-50"
                    >
                        {isGenerating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {analysis ? (smartImportEnabled ? 'Aggiorna' : 'Disabilitata') : (smartImportEnabled ? 'Analizza fonti' : 'Disabilitata')}
                    </button>
                </div>
            </div>

            <div className="p-5">
                {error && (
                    <div className="mb-4 flex items-start gap-2 rounded-[20px] border border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] p-3 text-xs text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {statusMessage && (
                    <div className="mb-4 flex items-start gap-2 rounded-[20px] border border-[color:color-mix(in_srgb,var(--lume-signal-success)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-success)_11%,var(--lume-surface-field))] p-3 text-xs text-[color:color-mix(in_srgb,var(--lume-signal-success)_60%,var(--lume-ink))]">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{statusMessage}</span>
                    </div>
                )}

                {!smartImportEnabled && (
                    <div
                        className="mb-4 flex items-start gap-2 rounded-[20px] border border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] p-3 text-xs text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]"
                        data-testid="smart-import-disabled-banner"
                    >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                            <p className="font-semibold">Smart Import disabilitato localmente</p>
                            <p className="mt-1">Puoi consultare gli ultimi suggerimenti già generati, ma analisi e applicazione restano bloccate finché non riattivi l&apos;interruttore in Impostazioni.</p>
                        </div>
                    </div>
                )}

                {!analysis && !isGenerating && (
                    <div className="rounded-[24px] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] p-4 text-sm leading-relaxed text-[color:var(--lume-ink)]">
                        Analisi automatica di note, diario e documenti per suggerire diagnosi ICD-11 e terapie farmacologiche da importare in scheda.
                    </div>
                )}

                {isGenerating && (
                    <div className="space-y-4 py-10 text-center">
                        <div className="relative mx-auto h-12 w-12">
                            <Brain className="h-12 w-12 text-[color:color-mix(in_srgb,var(--lume-ink)_18%,transparent)]" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <RefreshCw className="h-5 w-5 animate-spin text-[color:var(--lume-ink)]" />
                            </div>
                        </div>
                        <p className="text-xs font-bold uppercase tracking-widest text-[color:var(--lume-ink-muted)]">Elaborazione fonti cliniche in corso...</p>
                    </div>
                )}

                {analysis && !isGenerating && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 gap-5 rounded-[24px] border border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] bg-[color:var(--lume-surface-focal)] p-4 lg:grid-cols-3">
                            <div className="flex flex-col">
                                <span className="text-[9px] font-bold uppercase tracking-widest text-[color:var(--lume-ink-muted)]">Selezionati</span>
                                <span className="text-sm font-bold text-[color:var(--lume-ink)]">{selectedCount} pronti</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[9px] font-bold uppercase tracking-widest text-[color:var(--lume-ink-muted)]">Reviewabili</span>
                                <span className="text-sm font-bold text-[color:var(--lume-ink)]">{reviewableCount} da confermare</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[9px] font-bold uppercase tracking-widest text-[color:var(--lume-ink-muted)]">Bloccati</span>
                                <span className="text-sm font-bold text-[color:var(--lume-ink)]">{blockedCount} da correggere o scartare</span>
                            </div>
                        </div>

                        <div
                            className="grid gap-5"
                            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 24rem), 1fr))' }}
                        >
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 px-1">
                                    <Stethoscope className="h-3.5 w-3.5 text-[color:var(--lume-ink-muted)]" />
                                    <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--lume-ink-muted)]">Diagnosi Candidate</h4>
                                </div>

                                <div className="space-y-3">
                                    {analysis.diagnoses.length === 0 && (
                                        <p className="py-4 text-center text-xs italic text-[color:var(--lume-ink-muted)]">Nessun match trovato</p>
                                    )}

                                    {analysis.diagnoses.map((diagnosis) => {
                                        const isEditing = editingDiagnosisIds.includes(diagnosis.id);
                                        const isSelected = selectedDiagnosisIds.includes(diagnosis.id);
                                        const checkboxId = `smart-import-diagnosis-${diagnosis.id}`;
                                        const displayLabel = getDiagnosisDisplayLabel(diagnosis);

                                        return (
                                            <div
                                                key={diagnosis.id}
                                                className={`overflow-hidden rounded-[var(--lume-radius-card)] border p-3.5 text-[color:var(--lume-ink-muted)] transition-[border-color,background-color,color] duration-[var(--lume-dur-firma)] ${reviewStateCardClasses(diagnosis.review.state, isSelected)}`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className="pt-0.5">
                                                        <input
                                                            id={checkboxId}
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            disabled={!diagnosis.canApply || isApplying}
                                                            onChange={() => toggleDiagnosis(diagnosis.id)}
                                                            className={`h-4 w-4 rounded-full border-[color:color-mix(in_srgb,var(--lume-ink)_24%,transparent)] text-[color:var(--lume-accent)] focus:ring-[color:var(--lume-accent)] ${diagnosis.canApply ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                                                        />
                                                    </div>

                                                    <div className="min-w-0 flex-1 space-y-3">
                                                        <div className="flex flex-col gap-3">
                                                            <div className="min-w-0 space-y-1.5">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    {diagnosis.canApply ? (
                                                                        <label htmlFor={checkboxId} className="cursor-pointer break-words text-sm font-bold text-[color:var(--lume-ink)]">
                                                                            {displayLabel}
                                                                        </label>
                                                                    ) : (
                                                                        <p className="break-words text-sm font-bold text-[color:var(--lume-ink)]">{displayLabel}</p>
                                                                    )}
                                                                    <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-tighter ${reviewStateBadgeClasses(diagnosis.review.state)}`}>
                                                                        {reviewStateLabel(diagnosis.review.state)}
                                                                    </span>
                                                                    <span className="rounded-full bg-[color:var(--lume-surface-field)] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-tighter text-[color:var(--lume-ink-muted)]">
                                                                        {confidenceLabel(diagnosis.confidence)}
                                                                    </span>
                                                                </div>
                                                                {diagnosis.match && (
                                                                    <p className="break-words lume-registro text-[10px] font-bold text-[color:var(--lume-ink)]">
                                                                        ICD-11 {diagnosis.match.code} · {diagnosis.match.description}
                                                                    </p>
                                                                )}
                                                            </div>

                                                            <ReviewActionButtons
                                                                isEditing={isEditing}
                                                                onToggleEditor={() => toggleDiagnosisEditor(diagnosis.id)}
                                                                onDiscard={() => removeDiagnosisSuggestion(diagnosis.id)}
                                                            />
                                                        </div>

                                                        <div className="rounded-[20px] border border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] bg-[color:var(--lume-surface-focal)] p-3 text-[11px] text-[color:var(--lume-ink-muted)]">
                                                            <p className="font-semibold text-[color:var(--lume-ink)]">{diagnosis.review.summary}</p>
                                                            {diagnosis.review.comparison && (
                                                                <p className="mt-1 text-[color:var(--lume-ink-muted)]">
                                                                    Profilo attuale: {diagnosis.review.comparison}
                                                                </p>
                                                            )}
                                                            {diagnosis.blockedReason && diagnosis.blockedReason !== diagnosis.review.summary && (
                                                                <p className="mt-1 text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">
                                                                    Motivo blocco: {diagnosis.blockedReason}
                                                                </p>
                                                            )}
                                                        </div>

                                                        <div className="space-y-1.5">
                                                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">
                                                                Provenienza · {formatEvidenceMeta(diagnosis.evidence)}
                                                            </p>
                                                            <div className="rounded-[18px] bg-[color:var(--lume-surface-field)] p-2 text-[10px] italic text-[color:var(--lume-ink-muted)]">
                                                                &ldquo;<PrivacyBlur intensity="sm">{diagnosis.evidence.excerpt}</PrivacyBlur>&rdquo;
                                                            </div>
                                                        </div>

                                                        <DiagnosisResolverPreview diagnosis={diagnosis} />

                                                        {isEditing && (
                                                            <div className="grid gap-3 rounded-[20px] border border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] bg-[color:var(--lume-surface-field)] p-3">
                                                                <label className="space-y-1">
                                                                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">
                                                                        Descrizione da importare
                                                                    </span>
                                                                    <input
                                                                        value={diagnosis.reviewedLabel || diagnosis.label}
                                                                        onChange={(event) => updateDiagnosisSuggestion(diagnosis.id, (current) => ({
                                                                            ...current,
                                                                            reviewedLabel: event.target.value,
                                                                        }))}
                                                                        className={smartImportInputClassName}
                                                                    />
                                                                </label>
                                                                <p className="text-[11px] text-[color:var(--lume-ink-muted)]">
                                                                    La modifica agisce sulla descrizione salvata, mantenendo il codice ICD-11 gia riconciliato.
                                                                </p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center gap-2 px-1">
                                    <Pill className="h-3.5 w-3.5 text-[color:var(--lume-ink-muted)]" />
                                    <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--lume-ink-muted)]">Terapie Candidate</h4>
                                </div>

                                <div className="space-y-3">
                                    {analysis.therapies.length === 0 && (
                                        <p className="py-4 text-center text-xs italic text-[color:var(--lume-ink-muted)]">Nessun match trovato</p>
                                    )}

                                    {analysis.therapies.map((therapy) => {
                                        const isEditing = editingTherapyIds.includes(therapy.id);
                                        const isSelected = selectedTherapyIds.includes(therapy.id);
                                        const checkboxId = `smart-import-therapy-${therapy.id}`;
                                        const displayName = getTherapyDisplayName(therapy);
                                        const displayPrinciple = getTherapyDisplayPrinciple(therapy);
                                        const displayDosage = getTherapyDisplayDosage(therapy);

                                        return (
                                            <div
                                                key={therapy.id}
                                                className={`overflow-hidden rounded-[var(--lume-radius-card)] border p-3.5 text-[color:var(--lume-ink-muted)] transition-[border-color,background-color,color] duration-[var(--lume-dur-firma)] ${reviewStateCardClasses(therapy.review.state, isSelected)}`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className="pt-0.5">
                                                        <input
                                                            id={checkboxId}
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            disabled={!therapy.canApply || isApplying}
                                                            onChange={() => toggleTherapy(therapy.id)}
                                                            className={`h-4 w-4 rounded-full border-[color:color-mix(in_srgb,var(--lume-ink)_24%,transparent)] text-[color:var(--lume-accent)] focus:ring-[color:var(--lume-accent)] ${therapy.canApply ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                                                        />
                                                    </div>

                                                    <div className="min-w-0 flex-1 space-y-3">
                                                        <div className="flex flex-col gap-3">
                                                            <div className="min-w-0 space-y-1.5">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    {therapy.canApply ? (
                                                                        <label htmlFor={checkboxId} className="cursor-pointer break-words text-sm font-bold text-[color:var(--lume-ink)]">
                                                                            {displayName}
                                                                        </label>
                                                                    ) : (
                                                                        <p className="break-words text-sm font-bold text-[color:var(--lume-ink)]">{displayName}</p>
                                                                    )}
                                                                    <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-tighter ${reviewStateBadgeClasses(therapy.review.state)}`}>
                                                                        {reviewStateLabel(therapy.review.state)}
                                                                    </span>
                                                                    <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-tighter ${therapyStateBadgeClasses(therapy.therapyState)}`}>
                                                                        {therapyStateLabel(therapy.therapyState)}
                                                                    </span>
                                                                    <span className="rounded-full bg-[color:var(--lume-surface-field)] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-tighter text-[color:var(--lume-ink-muted)]">
                                                                        {matchTypeLabel(therapy.matchType)}
                                                                    </span>
                                                                </div>
                                                                <p className="break-words text-[10px] font-bold text-[color:var(--lume-ink)]">
                                                                    {[displayPrinciple, displayDosage].filter(Boolean).join(' · ')}
                                                                </p>
                                                                {therapy.match?.aic && (
                                                                    <p className="break-words lume-registro text-[10px] font-bold text-[color:var(--lume-ink-muted)]">
                                                                        AIC {therapy.match.aic}{therapy.match.atc ? ` · ATC ${therapy.match.atc}` : ''}
                                                                    </p>
                                                                )}
                                                            </div>

                                                            <ReviewActionButtons
                                                                isEditing={isEditing}
                                                                onToggleEditor={() => toggleTherapyEditor(therapy.id)}
                                                                onDiscard={() => removeTherapySuggestion(therapy.id)}
                                                            />
                                                        </div>

                                                        <div className="rounded-[20px] border border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] bg-[color:var(--lume-surface-focal)] p-3 text-[11px] text-[color:var(--lume-ink-muted)]">
                                                            <p className="font-semibold text-[color:var(--lume-ink)]">{therapy.review.summary}</p>
                                                            {therapy.review.comparison && (
                                                                <p className="mt-1 text-[color:var(--lume-ink-muted)]">
                                                                    Profilo attuale: {therapy.review.comparison}
                                                                </p>
                                                            )}
                                                            {therapy.blockedReason && therapy.blockedReason !== therapy.review.summary && (
                                                                <p className="mt-1 text-[color:var(--lume-ink-muted)]">
                                                                    Motivo blocco: {therapy.blockedReason}
                                                                </p>
                                                            )}
                                                        </div>

                                                        <div className="space-y-1.5">
                                                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">
                                                                Provenienza · {formatEvidenceMeta(therapy.evidence)}
                                                            </p>
                                                            <div className="rounded-[18px] bg-[color:var(--lume-surface-field)] p-2 text-[10px] italic text-[color:var(--lume-ink-muted)]">
                                                                &ldquo;<PrivacyBlur intensity="sm">{therapy.evidence.excerpt}</PrivacyBlur>&rdquo;
                                                            </div>
                                                        </div>

                                                        <TherapyResolverPreview therapy={therapy} />

                                                        {isEditing && (
                                                            <div className="grid gap-3 rounded-[20px] border border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] bg-[color:var(--lume-surface-field)] p-3">
                                                                <div className="grid gap-3 md:grid-cols-2">
                                                                    <label className="space-y-1">
                                                                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">
                                                                            Nome farmaco
                                                                        </span>
                                                                        <input
                                                                            value={therapy.reviewedDrugName || therapy.drugMention}
                                                                            onChange={(event) => updateTherapySuggestion(therapy.id, (current) => ({
                                                                                ...current,
                                                                                reviewedDrugName: event.target.value,
                                                                            }))}
                                                                            className={smartImportInputClassName}
                                                                        />
                                                                    </label>
                                                                    <label className="space-y-1">
                                                                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">
                                                                            Principio attivo
                                                                        </span>
                                                                        <input
                                                                            value={therapy.reviewedActivePrinciple || therapy.activePrinciple || ''}
                                                                            onChange={(event) => updateTherapySuggestion(therapy.id, (current) => ({
                                                                                ...current,
                                                                                reviewedActivePrinciple: event.target.value,
                                                                            }))}
                                                                            className={smartImportInputClassName}
                                                                        />
                                                                    </label>
                                                                    <label className="space-y-1">
                                                                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">
                                                                            Posologia
                                                                        </span>
                                                                        <input
                                                                            value={therapy.reviewedDosage || therapy.dosage || ''}
                                                                            onChange={(event) => updateTherapySuggestion(therapy.id, (current) => ({
                                                                                ...current,
                                                                                reviewedDosage: event.target.value,
                                                                            }))}
                                                                            className={smartImportInputClassName}
                                                                        />
                                                                    </label>
                                                                    <label className="space-y-1">
                                                                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">
                                                                            Motivazione
                                                                        </span>
                                                                        <input
                                                                            value={therapy.reviewedMotivation || therapy.motivation || ''}
                                                                            onChange={(event) => updateTherapySuggestion(therapy.id, (current) => ({
                                                                                ...current,
                                                                                reviewedMotivation: event.target.value,
                                                                            }))}
                                                                            className={smartImportInputClassName}
                                                                        />
                                                                    </label>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-4 border-t border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] pt-5 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs text-[color:var(--lume-ink-muted)]">
                                Le righe non applicabili restano modificabili o scartabili, ma non vengono selezionate finche non risultano coerenti con il profilo attuale.
                            </p>

                            <button
                                onClick={applySelection}
                                disabled={isApplying || selectedCount === 0 || !smartImportEnabled}
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[color:var(--lume-ink)] px-8 text-xs font-bold text-[color:var(--lume-surface-focal)] shadow-[var(--lume-shadow-focal)] transition-[background-color,opacity,transform] hover:bg-[color:var(--lume-accent)] active:scale-95 disabled:opacity-50"
                            >
                                {isApplying ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                {smartImportEnabled ? 'Applica selezionati' : 'Disabilitata'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
