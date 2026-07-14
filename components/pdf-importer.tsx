'use client';

import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { FileText, Loader2, CheckCircle, Image, Sparkles, AlertCircle, Archive } from 'lucide-react';
import { useLiveQuery } from '@/lib/live-query';
import { db } from '@/lib/db';
import { extractPatientDataSmart, ExtractedPatientData, isImageDocumentInput, isPdfDocumentInput } from '@/lib/pdf-service';
import { analyzeDocumentContent, synthesizeDocument } from '@/lib/domain/documents/document-synthesis-service';
import { cn } from '@/lib/utils';
/* @Codex */
import { refreshPatientSummaryIfEnabled } from '@/lib/ai-summary-service';
import { useAiModelLabels } from '@/lib/hooks/use-ai-model-labels';
/* @Codex */
import { enrichExtractedPatientDataForReview } from '@/lib/domain/documents/patient-document-import-service';
import {
    AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY,
    AiDocumentSynthesisDisabledError,
    isAiDocumentSynthesisEnabledValue,
} from '@/lib/ai-document-synthesis-kill-switch';

interface PdfImporterProps {
    onDataExtracted: (data: ExtractedPatientData) => void;
    patientId?: string; // Optional: if provided, enables archiving
}

export default function PdfImporter({ onDataExtracted, patientId }: PdfImporterProps) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSynthesizing, setIsSynthesizing] = useState(false);
    const [success, setSuccess] = useState(false);
    const [extractionSource, setExtractionSource] = useState<'ai' | 'regex' | 'hybrid' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saveToArchive] = useState(true); // Default on (no toggle UI for simplicity)
    const [archiveSaved, setArchiveSaved] = useState(false);
    /* @Codex */
    const [aiStage, setAiStage] = useState<string>("");
    /* @Codex */
    const aiModels = useAiModelLabels();
    const documentSynthesisKillSwitch = useLiveQuery(() => db.settings.get(AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY), []);
    const documentSynthesisEnabled = isAiDocumentSynthesisEnabledValue(documentSynthesisKillSwitch?.value);

    const onDrop = async (acceptedFiles: File[]) => {
        if (acceptedFiles.length === 0) return;

        const file = acceptedFiles[0];
        const isPdf = isPdfDocumentInput(file);
        const isImage = isImageDocumentInput(file);

        if (!isPdf && !isImage) {
            setError('Formati supportati: PDF e immagini comuni elaborabili localmente.');
            return;
        }

        setIsProcessing(true);
        /* @Codex */
        setAiStage('OCR locale in corso...');
        setSuccess(false);
        setError(null);
        setExtractionSource(null);
        setArchiveSaved(false);

        try {
            // Use smart extraction (AI-first with regex fallback)
            const data = await extractPatientDataSmart(file);

            /* @Codex */
            if (!patientId && data.rawText && documentSynthesisEnabled) {
                setIsSynthesizing(true);
                /* @Codex */
                setAiStage('Analisi clinica locale...');
                try {
                    const analysis = await analyzeDocumentContent(data.rawText);
                    data.diagnoses = analysis.diagnoses;
                    data.medications = analysis.medications;
                    data.problemStatements = analysis.problemStatements;
                    data.therapyCandidates = analysis.therapyCandidates;
                    data.servicePrescriptions = analysis.servicePrescriptions;
                    data.documentQuality = analysis.quality;
                    data.documentSummary = analysis.summary;
                    if (!data.notes && analysis.summary) {
                        data.notes = analysis.summary;
                    }
                } catch (analysisError) {
                    if (!(analysisError instanceof AiDocumentSynthesisDisabledError)) {
                        console.error('Document analysis error:', analysisError);
                    }
                } finally {
                    setIsSynthesizing(false);
                }
            }

            if (!patientId && documentSynthesisEnabled) {
                try {
                    setAiStage('Riconciliazione codici e farmaci...');
                    Object.assign(data, await enrichExtractedPatientDataForReview(data));
                } catch (reviewError) {
                    console.error('Document review enrichment error:', reviewError);
                }
            }

            setExtractionSource(data.source);
            onDataExtracted(data);
            setSuccess(true);

            // Auto-save to archive if enabled and patientId is present
            if (saveToArchive && patientId && data.rawText && documentSynthesisEnabled) {
                setIsSynthesizing(true);
                /* @Codex */
                setAiStage('Sintesi del documento...');
                try {
                    await synthesizeDocument(data.rawText, file.name, patientId);
                    setArchiveSaved(true);
                    /* @Codex */
                    setAiStage("Aggiornamento sintesi paziente...");
                    await refreshPatientSummaryIfEnabled(patientId);
                } catch (synthErr) {
                    if (!(synthErr instanceof AiDocumentSynthesisDisabledError)) {
                        console.error('Synthesis error:', synthErr);
                    }
                    // Don't fail the whole operation, just note the archive wasn't saved
                } finally {
                    setIsSynthesizing(false);
                }
            }
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : 'Errore nella lettura del documento.');
        } finally {
            setIsProcessing(false);
            /* @Codex */
            setAiStage("");
        }
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        maxFiles: 1,
        accept: {
            'application/pdf': ['.pdf'],
            'image/*': []
        }
    });

    const getSourceBadge = () => {
        if (!extractionSource) return null;
        const badges = {
            ai: { icon: Sparkles, text: 'OCR locale', color: 'text-purple-600 bg-purple-100' },
            hybrid: { icon: Sparkles, text: 'AI + pattern', color: 'text-blue-600 bg-blue-100' },
            regex: { icon: FileText, text: 'Pattern', color: 'text-gray-600 bg-gray-100' }
        };
        const badge = badges[extractionSource];
        return (
            <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", badge.color)}>
                <badge.icon className="w-3 h-3" />
                {badge.text}
            </span>
        );
    };

    return (
        <div className="mb-8">
            <div
                {...getRootProps()}
                className={cn(
                    "relative cursor-pointer overflow-hidden rounded-[var(--lume-radius-card)] border-2 border-dashed bg-[color:var(--lume-surface-field)] p-6 transition-[background-color,border-color] duration-[var(--lume-dur-riga)]",
                    isDragActive ? "border-blue-500 bg-[color:var(--lume-surface-focal)]" : "border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] hover:bg-[color:var(--lume-surface-focal)]",
                    success ? "border-green-500 bg-green-50 dark:bg-green-900/20" : "",
                    error ? "border-red-500 bg-red-50 dark:bg-red-900/20" : ""
                )}
            >
                <input {...getInputProps()} aria-label="Carica documento" />

                {isProcessing ? (
                    <div className="flex flex-col items-center justify-center py-4 text-blue-600">
                        <Loader2 className="w-8 h-8 animate-spin mb-2" />
                        <p className="font-medium">Lettura documento in corso...</p>
                        <p className="text-xs text-blue-500 mt-1">{aiStage || "OCR locale in elaborazione"}</p>
                        {aiModels && (
                            <p className="text-[10px] text-blue-400 mt-1">OCR: {aiModels.ocr} · Clinico: {aiModels.clinical}</p>
                        )}
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-4 text-red-600">
                        <AlertCircle className="w-8 h-8 mb-2" />
                        <p className="font-bold">Errore</p>
                        <p className="text-xs text-red-700">{error}</p>
                    </div>
                ) : success ? (
                    <div className="flex flex-col items-center justify-center py-4 text-green-600">
                        <CheckCircle className="w-8 h-8 mb-2" />
                        <div className="flex items-center gap-2">
                            <p className="font-bold">Dati estratti</p>
                            {getSourceBadge()}
                        </div>
                        <p className="text-xs text-green-700">Controlla le proposte prima del salvataggio.</p>
                        {!patientId && (
                            <p className="text-xs text-green-700">
                                Diagnosi e terapie vengono riconciliate localmente e poi mostrate per il controllo.
                            </p>
                        )}

                        {/* Archive status indicator */}
                        {patientId && (
                            <div className="mt-2 flex items-center gap-2">
                                {isSynthesizing ? (
                                    <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        Salvataggio in Archivio...
                                    </span>
                                ) : archiveSaved ? (
                                    <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
                                        <Archive className="w-3 h-3" />
                                        Salvato nell&apos;archivio documenti
                                    </span>
                                ) : null}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 rounded-lg shrink-0">
                            <div className="relative">
                                <FileText className="w-6 h-6 text-blue-600" />
                                <Sparkles className="w-3 h-3 text-purple-500 absolute -top-1 -right-1" />
                            </div>
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                                Importa da documento
                                <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                                    OCR locale
                                </span>
                            </h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                Trascina un PDF o immagine (referto, scheda) per compilare automaticamente i campi.
                            </p>
                            <div className="flex gap-2 mt-1">
                                <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                                    <FileText className="w-3 h-3" /> PDF
                                </span>
                                <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                                    <Image className="w-3 h-3" /> JPG, PNG
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {!documentSynthesisEnabled && (
                <div
                    className="mt-3 rounded-2xl border border-amber-200/80 bg-amber-50/80 p-3 text-xs leading-5 text-amber-800 dark:border-amber-500/20 dark:bg-amber-900/10 dark:text-amber-200"
                    data-testid="document-synthesis-disabled-note"
                >
                    La sintesi clinica documento è disabilitata localmente. L&apos;OCR e il prefill base restano disponibili, ma diagnosi da controllare, terapie candidate e archivio documenti non vengono generati.
                </div>
            )}
        </div>
    );
}
