'use client';

import { useState } from 'react';
import { Brain, CheckCircle2, Pill, RefreshCw, Sparkles, Stethoscope, AlertTriangle } from 'lucide-react';
import PrivacyBlur from '@/components/privacy-blur';
import { useLiveQuery } from '@/lib/live-query';
import { db, type ClinicalEntry, type Patient } from '@/lib/db';
import {
    applyPatientSmartImportSelection,
    generatePatientSmartImportAnalysis,
    type PatientSmartImportAnalysis,
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

function shouldPreselectDiagnosisSuggestion(diagnosis: PatientSmartImportAnalysis['diagnoses'][number]): boolean {
    return diagnosis.canApply && diagnosis.confidence === 'high';
}

function shouldPreselectTherapySuggestion(therapy: PatientSmartImportAnalysis['therapies'][number]): boolean {
    return therapy.canApply
        && therapy.confidence === 'high'
        && therapy.matchType === 'catalog'
        && therapy.therapyState === 'active'
        && Boolean(therapy.dosage?.trim());
}

export default function PatientSmartImportPanel({ patient, entries = [] }: PatientSmartImportPanelProps) {
    const [analysis, setAnalysis] = useState<PatientSmartImportAnalysis | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isApplying, setIsApplying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedDiagnosisIds, setSelectedDiagnosisIds] = useState<string[]>([]);
    const [selectedTherapyIds, setSelectedTherapyIds] = useState<string[]>([]);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    const attachments = useLiveQuery(
        async () => {
            const items = await db.attachments.filter((attachment: { patientId: string }) => attachment.patientId === patient.id).toArray();
            return items.filter((attachment) => attachment.summarySnapshot?.trim());
        },
        [patient.id]
    );

    const sourceCount = countUsableSources(patient, entries, attachments?.length || 0);
    if (sourceCount === 0) {
        return null;
    }

    const autoSelectedCount = analysis
        ? analysis.diagnoses.filter(shouldPreselectDiagnosisSuggestion).length
        + analysis.therapies.filter(shouldPreselectTherapySuggestion).length
        : 0;
    const consultiveCount = analysis
        ? analysis.diagnoses.filter((diagnosis) => !shouldPreselectDiagnosisSuggestion(diagnosis)).length
        + analysis.therapies.filter((therapy) => !shouldPreselectTherapySuggestion(therapy)).length
        : 0;

    const generateSuggestions = async () => {
        setIsGenerating(true);
        setError(null);
        setStatusMessage(null);

        try {
            const nextAnalysis = await generatePatientSmartImportAnalysis(patient.id);
            setAnalysis(nextAnalysis);
            setSelectedDiagnosisIds(nextAnalysis.diagnoses
                .filter(shouldPreselectDiagnosisSuggestion)
                .map((diagnosis) => diagnosis.id));
            setSelectedTherapyIds(nextAnalysis.therapies
                .filter(shouldPreselectTherapySuggestion)
                .map((therapy) => therapy.id));
        } catch (generationError) {
            setError(generationError instanceof Error ? generationError.message : 'Analisi non disponibile');
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
            setStatusMessage(`Import completato: ${result.diagnosesApplied} diagnosi, ${result.therapiesApplied} terapie.`);
        } catch (applyError) {
            setError(applyError instanceof Error ? applyError.message : 'Applicazione non riuscita');
        } finally {
            setIsApplying(false);
        }
    };

    return (
        <div className="glass-panel overflow-hidden rounded-[28px] border-sky-100/50 bg-sky-50/10 p-0 backdrop-blur-2xl dark:border-sky-500/20 dark:bg-sky-950/10">
            <div className="border-b border-sky-200/30 p-5 dark:border-white/5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-[18px] bg-sky-600 text-white shadow-lg shadow-sky-500/20">
                            <Brain className="h-5 w-5" />
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-slate-900 dark:text-white">Smart Import</h3>
                            <div className="mt-0.5 flex items-center gap-2">
                                <span className="inline-flex items-center rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tight text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                                    {sourceCount} fonti
                                </span>
                                {analysis && (
                                    <span className="text-[9px] font-medium text-slate-400 uppercase tracking-tight">
                                        {analysis.model.model}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={generateSuggestions}
                        disabled={isGenerating || isApplying}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-sky-600 px-5 text-xs font-bold text-white shadow-lg shadow-sky-500/20 transition-all hover:bg-sky-700 active:scale-95 disabled:opacity-50"
                    >
                        {isGenerating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {analysis ? 'Aggiorna' : 'Analizza fonti'}
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

                {!analysis && !isGenerating && (
                    <div className="rounded-[24px] border border-sky-100 bg-sky-50/30 p-4 text-sm leading-relaxed text-sky-900 dark:border-sky-500/10 dark:text-sky-200">
                        Analisi automatica di note, diario e documenti per suggerire diagnosi ICD-11 e terapie farmacologiche da importare in scheda.
                    </div>
                )}

                {isGenerating && (
                    <div className="py-10 text-center space-y-4">
                        <div className="relative mx-auto h-12 w-12">
                            <Brain className="h-12 w-12 text-sky-500/20 animate-pulse" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <RefreshCw className="h-5 w-5 text-sky-600 animate-spin" />
                            </div>
                        </div>
                        <p className="text-xs font-bold uppercase tracking-widest text-sky-600">Elaborazione fonti cliniche...</p>
                    </div>
                )}

                {analysis && !isGenerating && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                            {/* Diagnoses Section */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 px-1">
                                    <Stethoscope className="h-3.5 w-3.5 text-rose-500" />
                                    <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Diagnosi Candidate</h4>
                                </div>

                                <div className="space-y-2">
                                    {analysis.diagnoses.length === 0 && (
                                        <p className="py-4 text-center text-xs italic text-slate-400">Nessun match trovato</p>
                                    )}

                                    {analysis.diagnoses.map((diagnosis) => (
                                        <div
                                            key={diagnosis.id}
                                            className={`group relative overflow-hidden rounded-[24px] border transition-all ${diagnosis.canApply
                                                ? 'border-slate-100 bg-white hover:border-sky-200 dark:border-white/5 dark:bg-white/5'
                                                : 'border-slate-100 bg-slate-50 opacity-60 dark:border-white/5 dark:bg-white/5'
                                            }`}
                                        >
                                            <label className="flex cursor-pointer items-start gap-3 p-3.5">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedDiagnosisIds.includes(diagnosis.id)}
                                                    disabled={!diagnosis.canApply || isApplying}
                                                    onChange={() => toggleDiagnosis(diagnosis.id)}
                                                    className="mt-1 h-4 w-4 rounded-full border-slate-300 text-sky-600 focus:ring-sky-500"
                                                />
                                                <div className="min-w-0 flex-1 space-y-1.5">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className="text-sm font-bold text-slate-900 dark:text-white">{diagnosis.label}</p>
                                                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-tighter text-slate-500 dark:bg-white/10">
                                                            {diagnosis.confidence}
                                                        </span>
                                                    </div>
                                                    {diagnosis.match && (
                                                        <p className="font-mono text-[10px] font-bold text-rose-600 dark:text-rose-400">
                                                            ICD-11 {diagnosis.match.code} · {diagnosis.match.description}
                                                        </p>
                                                    )}
                                                    <div className="rounded-[18px] bg-slate-50 p-2 text-[10px] italic text-slate-500 dark:bg-white/5">
                                                        &ldquo;<PrivacyBlur intensity="sm">{diagnosis.evidence.excerpt}</PrivacyBlur>&rdquo;
                                                    </div>
                                                </div>
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Therapies Section */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 px-1">
                                    <Pill className="h-3.5 w-3.5 text-sky-500" />
                                    <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Terapie Candidate</h4>
                                </div>

                                <div className="space-y-2">
                                    {analysis.therapies.length === 0 && (
                                        <p className="py-4 text-center text-xs italic text-slate-400">Nessun match trovato</p>
                                    )}

                                    {analysis.therapies.map((therapy) => (
                                        <div
                                            key={therapy.id}
                                            className={`group relative overflow-hidden rounded-[24px] border transition-all ${therapy.canApply
                                                ? 'border-slate-100 bg-white hover:border-sky-200 dark:border-white/5 dark:bg-white/5'
                                                : 'border-slate-100 bg-slate-50 opacity-60 dark:border-white/5 dark:bg-white/5'
                                            }`}
                                        >
                                            <label className="flex cursor-pointer items-start gap-3 p-3.5">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedTherapyIds.includes(therapy.id)}
                                                    disabled={!therapy.canApply || isApplying}
                                                    onChange={() => toggleTherapy(therapy.id)}
                                                    className="mt-1 h-4 w-4 rounded-full border-slate-300 text-sky-600 focus:ring-sky-500"
                                                />
                                                <div className="min-w-0 flex-1 space-y-1.5">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className="text-sm font-bold text-slate-900 dark:text-white">{therapy.match?.name || therapy.drugMention}</p>
                                                        <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-tighter ${therapyStateBadgeClasses(therapy.therapyState)}`}>
                                                            {therapyStateLabel(therapy.therapyState)}
                                                        </span>
                                                    </div>
                                                    <p className="text-[10px] font-bold text-sky-700 dark:text-sky-400">
                                                        {therapy.activePrinciple} {therapy.dosage && `· ${therapy.dosage}`}
                                                    </p>
                                                    <div className="rounded-[18px] bg-slate-50 p-2 text-[10px] italic text-slate-500 dark:bg-white/5">
                                                        &ldquo;<PrivacyBlur intensity="sm">{therapy.evidence.excerpt}</PrivacyBlur>&rdquo;
                                                    </div>
                                                </div>
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-4 border-t border-slate-100 pt-5 dark:border-white/5 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex gap-4">
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Preselezionati</span>
                                    <span className="text-xs font-bold text-emerald-600">{autoSelectedCount} solidi</span>
                                </div>
                                <div className="h-6 w-px bg-slate-200 dark:bg-white/10" />
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Da rivedere</span>
                                    <span className="text-xs font-bold text-amber-600">{consultiveCount} incerti</span>
                                </div>
                            </div>

                            <button
                                onClick={applySelection}
                                disabled={isApplying || (!selectedDiagnosisIds.length && !selectedTherapyIds.length)}
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-emerald-600 px-8 text-xs font-bold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                            >
                                {isApplying ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                Applica Selezionati
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
