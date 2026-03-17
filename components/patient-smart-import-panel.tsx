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

    const generateSuggestions = async () => {
        setIsGenerating(true);
        setError(null);
        setStatusMessage(null);

        try {
            const nextAnalysis = await generatePatientSmartImportAnalysis(patient.id);
            setAnalysis(nextAnalysis);
            setSelectedDiagnosisIds(nextAnalysis.diagnoses
                .filter((diagnosis) => diagnosis.canApply && diagnosis.confidence !== 'low')
                .map((diagnosis) => diagnosis.id));
            setSelectedTherapyIds(nextAnalysis.therapies
                .filter((therapy) => therapy.canApply && therapy.confidence !== 'low')
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
        <div className="glass-panel p-6 border-sky-100 dark:border-sky-500/20 shadow-lg shadow-sky-100/50 dark:shadow-none">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-sky-600 p-2 text-white shadow-md shadow-sky-200 dark:shadow-none">
                        <Brain className="h-5 w-5" />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-gray-800 dark:text-white">Smart Import</h3>
                        <p className="text-xs text-gray-500">
                            Note, diario e documenti gia analizzati possono diventare diagnosi ICD-11 e terapie reviewable.
                        </p>
                    </div>
                </div>

                <button
                    onClick={generateSuggestions}
                    disabled={isGenerating || isApplying}
                    className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition-all hover:bg-sky-700 disabled:opacity-60"
                >
                    {isGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {analysis ? 'Aggiorna suggerimenti' : 'Genera suggerimenti smart'}
                </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-gray-500">
                <span className="rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1">
                    Fonti disponibili: {sourceCount}
                </span>
                {analysis && (
                    <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1">
                        Modello: {analysis.model.model}
                    </span>
                )}
            </div>

            {error && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {statusMessage && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{statusMessage}</span>
                </div>
            )}

            {!analysis && !isGenerating && (
                <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50/80 p-4 text-sm text-sky-900">
                    <p className="font-medium">Il prompt resta disponibile finche il paziente ha fonti utili.</p>
                    <p className="mt-1 text-sky-800">
                        Le diagnosi da free text e le terapie vengono proposte per revisione manuale. L&apos;autofill automatico dei documenti resta limitato ai soli ICD espliciti gia gestiti dal flusso OCR-first.
                    </p>
                </div>
            )}

            {analysis && (
                <div className="mt-5 space-y-5">
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        <section className="rounded-2xl border border-red-100 bg-red-50/50 p-4">
                            <div className="mb-3 flex items-center gap-2">
                                <Stethoscope className="h-4 w-4 text-red-500" />
                                <h4 className="font-semibold text-gray-800">Diagnosi candidate</h4>
                            </div>

                            <div className="space-y-3">
                                {analysis.diagnoses.length === 0 && (
                                    <p className="text-sm text-gray-500">Nessuna diagnosi candidabile trovata nelle fonti correnti.</p>
                                )}

                                {analysis.diagnoses.map((diagnosis) => (
                                    <label
                                        key={diagnosis.id}
                                        className={`block rounded-xl border p-3 transition-colors ${diagnosis.canApply
                                            ? 'cursor-pointer border-red-100 bg-white'
                                            : 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-75'
                                            }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <input
                                                type="checkbox"
                                                checked={selectedDiagnosisIds.includes(diagnosis.id)}
                                                disabled={!diagnosis.canApply || isApplying}
                                                onChange={() => toggleDiagnosis(diagnosis.id)}
                                                className="mt-1 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                                            />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <p className="font-medium text-gray-800">{diagnosis.label}</p>
                                                    <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] uppercase text-gray-500">
                                                        {diagnosis.confidence}
                                                    </span>
                                                </div>
                                                {diagnosis.match ? (
                                                    <p className="mt-1 text-sm text-red-700">
                                                        ICD-11 {diagnosis.match.code} · {diagnosis.match.description}
                                                    </p>
                                                ) : (
                                                    <p className="mt-1 text-sm text-amber-700">
                                                        Nessun match ICD-11 affidabile: la proposta resta solo consultiva.
                                                    </p>
                                                )}
                                                <p className="mt-2 text-xs text-gray-500">
                                                    <strong>{diagnosis.evidence.label}:</strong> <PrivacyBlur intensity="sm">{diagnosis.evidence.excerpt}</PrivacyBlur>
                                                </p>
                                                {diagnosis.blockedReason && (
                                                    <p className="mt-2 text-xs text-amber-700">{diagnosis.blockedReason}</p>
                                                )}
                                            </div>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </section>

                        <section className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
                            <div className="mb-3 flex items-center gap-2">
                                <Pill className="h-4 w-4 text-indigo-500" />
                                <h4 className="font-semibold text-gray-800">Terapie candidate</h4>
                            </div>

                            <div className="space-y-3">
                                {analysis.therapies.length === 0 && (
                                    <p className="text-sm text-gray-500">Nessuna terapia candidabile trovata nelle fonti correnti.</p>
                                )}

                                {analysis.therapies.map((therapy) => (
                                    <label
                                        key={therapy.id}
                                        className={`block rounded-xl border p-3 transition-colors ${therapy.canApply
                                            ? 'cursor-pointer border-indigo-100 bg-white'
                                            : 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-75'
                                            }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <input
                                                type="checkbox"
                                                checked={selectedTherapyIds.includes(therapy.id)}
                                                disabled={!therapy.canApply || isApplying}
                                                onChange={() => toggleTherapy(therapy.id)}
                                                className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                            />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <p className="font-medium text-gray-800">{therapy.match?.name || therapy.drugMention}</p>
                                                    <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] uppercase text-gray-500">
                                                        {therapy.confidence}
                                                    </span>
                                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${therapy.matchType === 'catalog'
                                                        ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                                                        : therapy.matchType === 'manual'
                                                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                                                            : 'border-gray-200 bg-gray-50 text-gray-500'
                                                        }`}>
                                                        {therapy.matchType === 'catalog' ? 'catalogo' : therapy.matchType === 'manual' ? 'manuale' : 'nessun match'}
                                                    </span>
                                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${therapyStateBadgeClasses(therapy.therapyState)}`}>
                                                        {therapyStateLabel(therapy.therapyState)}
                                                    </span>
                                                </div>
                                                <p className="mt-1 text-sm text-indigo-700">
                                                    {therapy.activePrinciple ? `${therapy.activePrinciple}` : 'Principio attivo da verificare'}
                                                    {therapy.dosage ? ` · ${therapy.dosage}` : ''}
                                                </p>
                                                {therapy.match?.aic && (
                                                    <p className="mt-1 text-xs text-gray-500">
                                                        AIC {therapy.match.aic}{therapy.match.atc ? ` · ATC ${therapy.match.atc}` : ''}
                                                    </p>
                                                )}
                                                <p className="mt-2 text-xs text-gray-500">
                                                    <strong>{therapy.evidence.label}:</strong> <PrivacyBlur intensity="sm">{therapy.evidence.excerpt}</PrivacyBlur>
                                                </p>
                                                {therapy.reviewNote && therapy.reviewNote !== therapy.blockedReason && (
                                                    <p className="mt-2 text-xs text-gray-600">{therapy.reviewNote}</p>
                                                )}
                                                {therapy.blockedReason && (
                                                    <p className="mt-2 text-xs text-amber-700">{therapy.blockedReason}</p>
                                                )}
                                            </div>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </section>
                    </div>

                    <div className="flex flex-col gap-3 border-t border-gray-100 pt-4 md:flex-row md:items-center md:justify-between">
                        <p className="text-xs text-gray-500">
                            Seleziona solo i suggerimenti confermati. Le terapie in transizione o incerte restano visibili ma bloccate finche non vengono chiarite.
                        </p>
                        <button
                            onClick={applySelection}
                            disabled={isApplying || (!selectedDiagnosisIds.length && !selectedTherapyIds.length)}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-700 disabled:opacity-60"
                        >
                            {isApplying ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            Applica selezionati
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
