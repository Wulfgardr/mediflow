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
import { semanticSignalSurfaceClass } from '@/components/ui/semantic-signal';
import { sharedKillSwitchSignal } from '@/lib/ui-semantic-signal';

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
    const documentSynthesisKillSwitch = useLiveQuery(
        () => db.settings.get(AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY),
        [],
        undefined,
        ['settings'],
    );
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
            ai: { icon: Sparkles, text: 'OCR locale', color: 'bg-[color:color-mix(in_srgb,var(--lume-signal-plum)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-plum)_60%,var(--lume-ink))]' },
            hybrid: { icon: Sparkles, text: 'AI + pattern', color: 'bg-[color:color-mix(in_srgb,var(--lume-accent)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-accent)_60%,var(--lume-ink))]' },
            regex: { icon: FileText, text: 'Pattern', color: 'bg-[color:var(--lume-surface-field)] text-[color:var(--lume-ink-muted)]' }
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
                    "relative cursor-pointer overflow-hidden rounded-[var(--lume-radius-card)] border bg-[color:var(--lume-surface-field)] p-6 transition-[background-color,border-color] duration-[var(--lume-dur-fuoco)] ease-[var(--lume-ease)]",
                    isDragActive ? "lume-focal border-[color:color-mix(in_srgb,var(--lume-ink)_24%,transparent)] bg-[color:var(--lume-surface-focal)]" : "border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--lume-ink)_5%,var(--lume-surface-field))]",
                    success ? "border-[color:color-mix(in_srgb,var(--lume-signal-success)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-success)_10%,var(--lume-surface-field))]" : "",
                    error ? "border-[color:color-mix(in_srgb,var(--lume-signal-critical)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_10%,var(--lume-surface-field))]" : ""
                )}
            >
                <input {...getInputProps()} aria-label="Carica documento" />

                {isProcessing ? (
                    <div className="flex flex-col items-center justify-center py-4 text-[color:var(--lume-accent)]">
                        <Loader2 className="w-8 h-8 animate-spin mb-2" />
                        <p className="font-medium">Lettura documento in corso...</p>
                        <p className="mt-1 text-xs text-[color:var(--lume-accent)]">{aiStage || "OCR locale in elaborazione"}</p>
                        {aiModels && (
                            <p className="mt-1 text-[10px] text-[color:var(--lume-ink-muted)]">OCR: {aiModels.ocr} · Clinico: {aiModels.clinical}</p>
                        )}
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-4 text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">
                        <AlertCircle className="w-8 h-8 mb-2" />
                        <p className="font-bold">Errore</p>
                        <p className="text-xs">{error}</p>
                    </div>
                ) : success ? (
                    <div className="flex flex-col items-center justify-center py-4 text-[color:color-mix(in_srgb,var(--lume-signal-success)_60%,var(--lume-ink))]">
                        <CheckCircle className="w-8 h-8 mb-2" />
                        <div className="flex items-center gap-2">
                            <p className="font-bold">Dati estratti</p>
                            {getSourceBadge()}
                        </div>
                        <p className="text-xs">Controlla le proposte prima del salvataggio.</p>
                        {!patientId && (
                            <p className="text-xs">
                                Diagnosi e terapie vengono riconciliate localmente e poi mostrate per il controllo.
                            </p>
                        )}

                        {/* Archive status indicator */}
                        {patientId && (
                            <div className="mt-2 flex items-center gap-2">
                                {isSynthesizing ? (
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))] px-2 py-1 text-xs text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        Salvataggio in Archivio...
                                    </span>
                                ) : archiveSaved ? (
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:color-mix(in_srgb,var(--lume-signal-success)_11%,var(--lume-surface-field))] px-2 py-1 text-xs text-[color:color-mix(in_srgb,var(--lume-signal-success)_60%,var(--lume-ink))]">
                                        <Archive className="w-3 h-3" />
                                        Salvato nell&apos;archivio documenti
                                    </span>
                                ) : null}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex items-center gap-4">
                        <div className="shrink-0 rounded-lg bg-[color:color-mix(in_srgb,var(--lume-accent)_11%,var(--lume-surface-field))] p-3">
                            <div className="relative">
                                <FileText className="h-6 w-6 text-[color:var(--lume-accent)]" />
                                <Sparkles className="absolute -right-1 -top-1 h-3 w-3 text-[color:color-mix(in_srgb,var(--lume-signal-plum)_60%,var(--lume-ink))]" />
                            </div>
                        </div>
                        <div>
                            <h3 className="flex items-center gap-2 font-bold text-[color:var(--lume-ink)]">
                                Importa da documento
                                <span className="rounded-full bg-[color:color-mix(in_srgb,var(--lume-signal-plum)_11%,var(--lume-surface-field))] px-2 py-0.5 text-xs font-normal text-[color:color-mix(in_srgb,var(--lume-signal-plum)_60%,var(--lume-ink))]">
                                    OCR locale
                                </span>
                            </h3>
                            <p className="text-sm text-[color:var(--lume-ink-muted)]">
                                Trascina un PDF o immagine (referto, scheda) per compilare automaticamente i campi.
                            </p>
                            <div className="flex gap-2 mt-1">
                                <span className="inline-flex items-center gap-1 text-xs text-[color:var(--lume-ink-muted)]">
                                    <FileText className="w-3 h-3" /> PDF
                                </span>
                                <span className="inline-flex items-center gap-1 text-xs text-[color:var(--lume-ink-muted)]">
                                    <Image className="w-3 h-3" /> JPG, PNG
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {!documentSynthesisEnabled && (
                <div
                    className={cn(
                        'mt-3 rounded-2xl border p-3 text-xs leading-5',
                        semanticSignalSurfaceClass(sharedKillSwitchSignal(documentSynthesisEnabled)),
                    )}
                    data-testid="document-synthesis-disabled-note"
                >
                    La sintesi clinica documento è disabilitata localmente. L&apos;OCR e il prefill base restano disponibili, ma diagnosi da controllare, terapie candidate e archivio documenti non vengono generati.
                </div>
            )}
        </div>
    );
}
