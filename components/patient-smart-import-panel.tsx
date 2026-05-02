'use client';

import { useState } from 'react';
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
} from '@/lib/patient-smart-import-service';

interface PatientSmartImportPanelProps {
    patient: Patient;
    entries?: ClinicalEntry[];
}

function countUsableSources(
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
    if (state === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (state === 'transition') return 'border-amber-200 bg-amber-50 text-amber-700';
    if (state === 'uncertain') return 'border-orange-200 bg-orange-50 text-orange-700';
    return 'border-gray-200 bg-gray-50 text-gray-600';
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
    if (state === 'new') return 'border-sky-200 bg-sky-50 text-sky-700';
    if (state === 'already-present') return 'border-slate-200 bg-slate-100 text-slate-700';
    if (state === 'update') return 'border-amber-200 bg-amber-50 text-amber-700';
    if (state === 'transition') return 'border-amber-300 bg-amber-100 text-amber-800';
    if (state === 'inactive') return 'border-rose-200 bg-rose-50 text-rose-700';
    return 'border-orange-200 bg-orange-50 text-orange-700';
}

function reviewStateCardClasses(state: SmartImportReviewState, isSelected: boolean): string {
    if (state === 'new') {
        return isSelected
            ? 'border-sky-300 bg-sky-50/70 shadow-[0_0_0_1px_rgba(14,165,233,0.18)] dark:border-sky-400/40 dark:bg-sky-950/20'
            : 'border-slate-100 bg-white hover:border-sky-200 dark:border-white/5 dark:bg-white/5';
    }

    if (state === 'update') {
        return 'border-amber-200/80 bg-amber-50/60 dark:border-amber-400/20 dark:bg-amber-950/10';
    }

    if (state === 'already-present') {
        return 'border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.03]';
    }

    if (state === 'transition') {
        return 'border-amber-300/80 bg-amber-100/70 dark:border-amber-400/30 dark:bg-amber-950/15';
    }

    if (state === 'inactive') {
        return 'border-rose-200/80 bg-rose-50/60 dark:border-rose-400/20 dark:bg-rose-950/10';
    }

    return 'border-orange-200/80 bg-orange-50/60 dark:border-orange-400/20 dark:bg-orange-950/10';
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
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-slate-200 px-3 text-[10px] font-bold uppercase tracking-wide text-slate-600 transition-[border-color,background-color,color] hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 dark:border-white/10 dark:text-slate-300 dark:hover:border-sky-400/30 dark:hover:bg-sky-950/20 dark:hover:text-sky-200"
            >
                <Edit3 className="h-3 w-3" />
                {isEditing ? 'Chiudi modifica' : 'Modifica'}
            </button>
            <button
                type="button"
                onClick={onDiscard}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-slate-200 px-3 text-[10px] font-bold uppercase tracking-wide text-slate-600 transition-[border-color,background-color,color] hover:border-red-200 hover:bg-red-50 hover:text-red-700 dark:border-white/10 dark:text-slate-300 dark:hover:border-red-400/30 dark:hover:bg-red-950/20 dark:hover:text-red-200"
            >
                <Trash2 className="h-3 w-3" />
                Scarta
            </button>
        </div>
    );
}

function DiagnosisResolverPreview({ diagnosis }: { diagnosis: DiagnosisSmartImportSuggestion }) {
    return (
        <div className="space-y-2 rounded-[20px] border border-slate-100 bg-slate-50/80 p-3 dark:border-white/5 dark:bg-white/[0.03]">
            <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Resolver ICD locale</p>
                {diagnosis.resolver.queries.length > 0 && (
                    <span className="max-w-full break-words rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-black/20 dark:text-slate-300">
                        {diagnosis.resolver.queries.join(' · ')}
                    </span>
                )}
            </div>
            {diagnosis.resolver.candidates.length > 0 ? (
                <div className="space-y-2">
                    {diagnosis.resolver.candidates.map((candidate) => (
                        <div
                            key={`${candidate.code}-${candidate.query}`}
                            className="rounded-[16px] border border-white/70 bg-white/80 p-2.5 dark:border-white/5 dark:bg-black/10"
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-[10px] font-bold text-rose-600 dark:text-rose-400">
                                    {candidate.code}
                                </span>
                                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tight ${candidate.selected ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300'}`}>
                                    {candidate.selected ? 'scelto' : `score ${formatResolverScore(candidate.score)}`}
                                </span>
                            </div>
                            <p className="mt-1 break-words text-[11px] font-medium text-slate-700 dark:text-slate-100">{candidate.description}</p>
                            <p className="mt-1 break-words text-[10px] text-slate-500 dark:text-slate-400">Query: {candidate.query}</p>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Nessun candidato ICD-11 locale affidabile.</p>
            )}
        </div>
    );
}

function TherapyResolverPreview({ therapy }: { therapy: TherapySmartImportSuggestion }) {
    return (
        <div className="space-y-2 rounded-[20px] border border-slate-100 bg-slate-50/80 p-3 dark:border-white/5 dark:bg-white/[0.03]">
            <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Resolver AIFA locale</p>
                {therapy.resolver.searchTerms.length > 0 && (
                    <span className="max-w-full break-words rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-black/20 dark:text-slate-300">
                        {therapy.resolver.searchTerms.join(' · ')}
                    </span>
                )}
            </div>
            {therapy.resolver.candidates.length > 0 ? (
                <div className="space-y-2">
                    {therapy.resolver.candidates.map((candidate) => (
                        <div
                            key={`${candidate.aic}-${candidate.searchTerm}`}
                            className="rounded-[16px] border border-white/70 bg-white/80 p-2.5 dark:border-white/5 dark:bg-black/10"
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-[10px] font-bold text-sky-700 dark:text-sky-300">
                                    AIC {candidate.aic}
                                </span>
                                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tight ${candidate.selected ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300'}`}>
                                    {candidate.selected ? 'scelto' : `score ${formatResolverScore(candidate.score)}`}
                                </span>
                                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tight ${candidate.dosageAligned ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'}`}>
                                    {candidate.dosageAligned ? 'dosaggio coerente' : 'dosaggio divergente'}
                                </span>
                            </div>
                            <p className="mt-1 break-words text-[11px] font-medium text-slate-700 dark:text-slate-100">{candidate.name}</p>
                            <p className="mt-1 break-words text-[10px] text-slate-500 dark:text-slate-400">
                                {[candidate.activePrinciple, candidate.packaging, candidate.atc ? `ATC ${candidate.atc}` : undefined]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </p>
                            <p className="mt-1 break-words text-[10px] text-slate-500 dark:text-slate-400">Search: {candidate.searchTerm}</p>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Nessun candidato AIFA locale affidabile.</p>
            )}
        </div>
    );
}

export default function PatientSmartImportPanel({ patient, entries = [] }: PatientSmartImportPanelProps) {
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
            const items = await db.attachments.filter((attachment: { patientId: string }) => attachment.patientId === patient.id).toArray();
            return items.filter((attachment) => attachment.summarySnapshot?.trim());
        },
        [patient.id]
    );
    const smartImportKillSwitch = useLiveQuery(() => db.settings.get(AI_SMART_IMPORT_KILL_SWITCH_KEY), []);

    const sourceCount = countUsableSources(patient, entries, attachments?.length || 0);
    const smartImportEnabled = isAiSmartImportEnabledValue(smartImportKillSwitch?.value);
    if (sourceCount === 0) {
        return null;
    }

    const reviewableCount = analysis
        ? analysis.diagnoses.filter((diagnosis) => diagnosis.canApply && !selectedDiagnosisIds.includes(diagnosis.id)).length
        + analysis.therapies.filter((therapy) => therapy.canApply && !selectedTherapyIds.includes(therapy.id)).length
        : 0;
    const blockedCount = analysis
        ? analysis.diagnoses.filter((diagnosis) => !diagnosis.canApply).length
        + analysis.therapies.filter((therapy) => !therapy.canApply).length
        : 0;
    const selectedCount = countSelectedReviewItems(selectedDiagnosisIds, selectedTherapyIds);

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
                className="glass-panel overflow-hidden rounded-[28px] border-red-200/70 bg-red-50/20 p-6 backdrop-blur-xl dark:border-red-500/20 dark:bg-red-950/10"
                data-testid="smart-import-disabled-card"
            >
                <div className="flex flex-col items-center text-center space-y-5">
                    <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-red-100 text-red-600 shadow-[0_12px_24px_rgba(239,68,68,0.12)] dark:bg-red-500/10 dark:text-red-300">
                        <AlertTriangle className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-500">Kill switch locale</p>
                        <h3 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">Smart Import disabilitato</h3>
                        <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                            La lane è stata fermata localmente per prudenza. La scheda resta consultabile, ma non avvia analisi né apply finché il toggle non viene riattivato in Impostazioni.
                        </p>
                    </div>

                    <Link
                        href="/settings#ai"
                        className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                    >
                        Apri Impostazioni AI
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="glass-panel overflow-hidden rounded-[28px] border-sky-100/50 bg-sky-50/10 p-0 backdrop-blur-2xl dark:border-sky-500/20 dark:bg-sky-950/10">
            <div className="border-b border-sky-200/30 p-5 dark:border-white/5">
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] bg-sky-600 text-white shadow-lg shadow-sky-500/20">
                            <Brain className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h3 className="text-base font-bold text-slate-900 dark:text-white">Smart Import</h3>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="inline-flex items-center rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tight text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                                    {sourceCount} fonti
                                </span>
                                {analysis && (
                                    <span className="break-all text-[9px] font-medium uppercase tracking-tight text-slate-400">
                                        {analysis.model.model}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={generateSuggestions}
                        disabled={isGenerating || isApplying || !smartImportEnabled}
                        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-full bg-sky-600 px-5 text-xs font-bold text-white shadow-lg shadow-sky-500/20 transition-[background-color,opacity,transform] hover:bg-sky-700 active:scale-95 disabled:opacity-50"
                    >
                        {isGenerating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {analysis ? (smartImportEnabled ? 'Aggiorna' : 'Disabilitata') : (smartImportEnabled ? 'Analizza fonti' : 'Disabilitata')}
                    </button>
                </div>
            </div>

            <div className="p-5">
                {error && (
                    <div className="mb-4 flex items-start gap-2 rounded-[20px] border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {statusMessage && (
                    <div className="mb-4 flex items-start gap-2 rounded-[20px] border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{statusMessage}</span>
                    </div>
                )}

                {!smartImportEnabled && (
                    <div
                        className="mb-4 flex items-start gap-2 rounded-[20px] border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-900/10 dark:text-red-200"
                        data-testid="smart-import-disabled-banner"
                    >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                            <p className="font-semibold">Smart Import disabilitato localmente</p>
                            <p className="mt-1">Puoi consultare gli ultimi suggerimenti già generati, ma analisi e apply restano bloccati finché non riattivi il toggle in Impostazioni.</p>
                        </div>
                    </div>
                )}

                {!analysis && !isGenerating && (
                    <div className="rounded-[24px] border border-sky-100 bg-sky-50/30 p-4 text-sm leading-relaxed text-sky-900 dark:border-sky-500/10 dark:text-sky-200">
                        Analisi automatica di note, diario e documenti per suggerire diagnosi ICD-11 e terapie farmacologiche da importare in scheda.
                    </div>
                )}

                {isGenerating && (
                    <div className="space-y-4 py-10 text-center">
                        <div className="relative mx-auto h-12 w-12">
                            <Brain className="h-12 w-12 animate-pulse text-sky-500/20" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <RefreshCw className="h-5 w-5 animate-spin text-sky-600" />
                            </div>
                        </div>
                        <p className="text-xs font-bold uppercase tracking-widest text-sky-600">Elaborazione fonti cliniche...</p>
                    </div>
                )}

                {analysis && !isGenerating && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 gap-5 rounded-[24px] border border-slate-100 bg-white/70 p-4 dark:border-white/5 dark:bg-white/[0.03] lg:grid-cols-3">
                            <div className="flex flex-col">
                                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Selezionati</span>
                                <span className="text-sm font-bold text-emerald-600">{selectedCount} pronti</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Reviewabili</span>
                                <span className="text-sm font-bold text-sky-600">{reviewableCount} da confermare</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Bloccati</span>
                                <span className="text-sm font-bold text-amber-600">{blockedCount} da correggere o scartare</span>
                            </div>
                        </div>

                        <div
                            className="grid gap-5"
                            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 24rem), 1fr))' }}
                        >
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 px-1">
                                    <Stethoscope className="h-3.5 w-3.5 text-rose-500" />
                                    <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Diagnosi Candidate</h4>
                                </div>

                                <div className="space-y-3">
                                    {analysis.diagnoses.length === 0 && (
                                        <p className="py-4 text-center text-xs italic text-slate-400">Nessun match trovato</p>
                                    )}

                                    {analysis.diagnoses.map((diagnosis) => {
                                        const isEditing = editingDiagnosisIds.includes(diagnosis.id);
                                        const isSelected = selectedDiagnosisIds.includes(diagnosis.id);
                                        const checkboxId = `smart-import-diagnosis-${diagnosis.id}`;
                                        const displayLabel = getDiagnosisDisplayLabel(diagnosis);

                                        return (
                                            <div
                                                key={diagnosis.id}
                                                className={`overflow-hidden rounded-[24px] border p-3.5 transition-[border-color,background-color,box-shadow] ${reviewStateCardClasses(diagnosis.review.state, isSelected)}`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className="pt-0.5">
                                                        <input
                                                            id={checkboxId}
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            disabled={!diagnosis.canApply || isApplying}
                                                            onChange={() => toggleDiagnosis(diagnosis.id)}
                                                            className={`h-4 w-4 rounded-full border-slate-300 text-sky-600 focus:ring-sky-500 ${diagnosis.canApply ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                                                        />
                                                    </div>

                                                    <div className="min-w-0 flex-1 space-y-3">
                                                        <div className="flex flex-col gap-3">
                                                            <div className="min-w-0 space-y-1.5">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    {diagnosis.canApply ? (
                                                                        <label htmlFor={checkboxId} className="cursor-pointer break-words text-sm font-bold text-slate-900 dark:text-white">
                                                                            {displayLabel}
                                                                        </label>
                                                                    ) : (
                                                                        <p className="break-words text-sm font-bold text-slate-900 dark:text-white">{displayLabel}</p>
                                                                    )}
                                                                    <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-tighter ${reviewStateBadgeClasses(diagnosis.review.state)}`}>
                                                                        {reviewStateLabel(diagnosis.review.state)}
                                                                    </span>
                                                                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-tighter text-slate-500 dark:bg-white/10">
                                                                        {diagnosis.confidence}
                                                                    </span>
                                                                </div>
                                                                {diagnosis.match && (
                                                                    <p className="break-words font-mono text-[10px] font-bold text-rose-600 dark:text-rose-400">
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

                                                        <div className="rounded-[20px] border border-slate-100 bg-white/80 p-3 text-[11px] text-slate-600 dark:border-white/5 dark:bg-black/10 dark:text-slate-300">
                                                            <p className="font-semibold text-slate-700 dark:text-slate-100">{diagnosis.review.summary}</p>
                                                            {diagnosis.review.comparison && (
                                                                <p className="mt-1 text-slate-500 dark:text-slate-400">
                                                                    Profilo attuale: {diagnosis.review.comparison}
                                                                </p>
                                                            )}
                                                            {diagnosis.blockedReason && diagnosis.blockedReason !== diagnosis.review.summary && (
                                                                <p className="mt-1 text-slate-500 dark:text-slate-400">
                                                                    Motivo blocco: {diagnosis.blockedReason}
                                                                </p>
                                                            )}
                                                        </div>

                                                        <div className="space-y-1.5">
                                                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                                                Provenienza · {formatEvidenceMeta(diagnosis.evidence)}
                                                            </p>
                                                            <div className="rounded-[18px] bg-slate-50 p-2 text-[10px] italic text-slate-500 dark:bg-white/5">
                                                                &ldquo;<PrivacyBlur intensity="sm">{diagnosis.evidence.excerpt}</PrivacyBlur>&rdquo;
                                                            </div>
                                                        </div>

                                                        <DiagnosisResolverPreview diagnosis={diagnosis} />

                                                        {isEditing && (
                                                            <div className="grid gap-3 rounded-[20px] border border-slate-100 bg-slate-50/80 p-3 dark:border-white/5 dark:bg-white/[0.03]">
                                                                <label className="space-y-1">
                                                                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                                                        Descrizione da importare
                                                                    </span>
                                                                    <input
                                                                        value={diagnosis.reviewedLabel || diagnosis.label}
                                                                        onChange={(event) => updateDiagnosisSuggestion(diagnosis.id, (current) => ({
                                                                            ...current,
                                                                            reviewedLabel: event.target.value,
                                                                        }))}
                                                                        className="h-10 w-full rounded-[16px] border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-[border-color,box-shadow] focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                                                                    />
                                                                </label>
                                                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
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
                                    <Pill className="h-3.5 w-3.5 text-sky-500" />
                                    <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Terapie Candidate</h4>
                                </div>

                                <div className="space-y-3">
                                    {analysis.therapies.length === 0 && (
                                        <p className="py-4 text-center text-xs italic text-slate-400">Nessun match trovato</p>
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
                                                className={`overflow-hidden rounded-[24px] border p-3.5 transition-[border-color,background-color,box-shadow] ${reviewStateCardClasses(therapy.review.state, isSelected)}`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className="pt-0.5">
                                                        <input
                                                            id={checkboxId}
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            disabled={!therapy.canApply || isApplying}
                                                            onChange={() => toggleTherapy(therapy.id)}
                                                            className={`h-4 w-4 rounded-full border-slate-300 text-sky-600 focus:ring-sky-500 ${therapy.canApply ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                                                        />
                                                    </div>

                                                    <div className="min-w-0 flex-1 space-y-3">
                                                        <div className="flex flex-col gap-3">
                                                            <div className="min-w-0 space-y-1.5">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    {therapy.canApply ? (
                                                                        <label htmlFor={checkboxId} className="cursor-pointer break-words text-sm font-bold text-slate-900 dark:text-white">
                                                                            {displayName}
                                                                        </label>
                                                                    ) : (
                                                                        <p className="break-words text-sm font-bold text-slate-900 dark:text-white">{displayName}</p>
                                                                    )}
                                                                    <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-tighter ${reviewStateBadgeClasses(therapy.review.state)}`}>
                                                                        {reviewStateLabel(therapy.review.state)}
                                                                    </span>
                                                                    <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-tighter ${therapyStateBadgeClasses(therapy.therapyState)}`}>
                                                                        {therapyStateLabel(therapy.therapyState)}
                                                                    </span>
                                                                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-tighter text-slate-500 dark:bg-white/10">
                                                                        {therapy.matchType}
                                                                    </span>
                                                                </div>
                                                                <p className="break-words text-[10px] font-bold text-sky-700 dark:text-sky-400">
                                                                    {[displayPrinciple, displayDosage].filter(Boolean).join(' · ')}
                                                                </p>
                                                                {therapy.match?.aic && (
                                                                    <p className="break-words font-mono text-[10px] font-bold text-slate-500 dark:text-slate-300">
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

                                                        <div className="rounded-[20px] border border-slate-100 bg-white/80 p-3 text-[11px] text-slate-600 dark:border-white/5 dark:bg-black/10 dark:text-slate-300">
                                                            <p className="font-semibold text-slate-700 dark:text-slate-100">{therapy.review.summary}</p>
                                                            {therapy.review.comparison && (
                                                                <p className="mt-1 text-slate-500 dark:text-slate-400">
                                                                    Profilo attuale: {therapy.review.comparison}
                                                                </p>
                                                            )}
                                                            {therapy.blockedReason && therapy.blockedReason !== therapy.review.summary && (
                                                                <p className="mt-1 text-slate-500 dark:text-slate-400">
                                                                    Motivo blocco: {therapy.blockedReason}
                                                                </p>
                                                            )}
                                                        </div>

                                                        <div className="space-y-1.5">
                                                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                                                Provenienza · {formatEvidenceMeta(therapy.evidence)}
                                                            </p>
                                                            <div className="rounded-[18px] bg-slate-50 p-2 text-[10px] italic text-slate-500 dark:bg-white/5">
                                                                &ldquo;<PrivacyBlur intensity="sm">{therapy.evidence.excerpt}</PrivacyBlur>&rdquo;
                                                            </div>
                                                        </div>

                                                        <TherapyResolverPreview therapy={therapy} />

                                                        {isEditing && (
                                                            <div className="grid gap-3 rounded-[20px] border border-slate-100 bg-slate-50/80 p-3 dark:border-white/5 dark:bg-white/[0.03]">
                                                                <div className="grid gap-3 md:grid-cols-2">
                                                                    <label className="space-y-1">
                                                                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                                                            Nome farmaco
                                                                        </span>
                                                                        <input
                                                                            value={therapy.reviewedDrugName || therapy.drugMention}
                                                                            onChange={(event) => updateTherapySuggestion(therapy.id, (current) => ({
                                                                                ...current,
                                                                                reviewedDrugName: event.target.value,
                                                                            }))}
                                                                            className="h-10 w-full rounded-[16px] border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-[border-color,box-shadow] focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                                                                        />
                                                                    </label>
                                                                    <label className="space-y-1">
                                                                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                                                            Principio attivo
                                                                        </span>
                                                                        <input
                                                                            value={therapy.reviewedActivePrinciple || therapy.activePrinciple || ''}
                                                                            onChange={(event) => updateTherapySuggestion(therapy.id, (current) => ({
                                                                                ...current,
                                                                                reviewedActivePrinciple: event.target.value,
                                                                            }))}
                                                                            className="h-10 w-full rounded-[16px] border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-[border-color,box-shadow] focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                                                                        />
                                                                    </label>
                                                                    <label className="space-y-1">
                                                                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                                                            Posologia
                                                                        </span>
                                                                        <input
                                                                            value={therapy.reviewedDosage || therapy.dosage || ''}
                                                                            onChange={(event) => updateTherapySuggestion(therapy.id, (current) => ({
                                                                                ...current,
                                                                                reviewedDosage: event.target.value,
                                                                            }))}
                                                                            className="h-10 w-full rounded-[16px] border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-[border-color,box-shadow] focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                                                                        />
                                                                    </label>
                                                                    <label className="space-y-1">
                                                                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                                                            Motivazione
                                                                        </span>
                                                                        <input
                                                                            value={therapy.reviewedMotivation || therapy.motivation || ''}
                                                                            onChange={(event) => updateTherapySuggestion(therapy.id, (current) => ({
                                                                                ...current,
                                                                                reviewedMotivation: event.target.value,
                                                                            }))}
                                                                            className="h-10 w-full rounded-[16px] border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-[border-color,box-shadow] focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white"
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

                        <div className="flex flex-col gap-4 border-t border-slate-100 pt-5 dark:border-white/5 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Le righe non applicabili restano modificabili o scartabili, ma non vengono selezionate finche non risultano coerenti con il profilo attuale.
                            </p>

                            <button
                                onClick={applySelection}
                                disabled={isApplying || selectedCount === 0 || !smartImportEnabled}
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-emerald-600 px-8 text-xs font-bold text-white shadow-lg shadow-emerald-500/20 transition-[background-color,opacity,transform] hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
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
