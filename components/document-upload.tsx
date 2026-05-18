'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, X, Eye, Loader2 } from 'lucide-react';
import { db, Attachment } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { cn } from '@/lib/utils';
import { useLiveQuery } from '@/lib/live-query';
import {
    AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY,
    AiDocumentSynthesisDisabledError,
    isAiDocumentSynthesisEnabledValue,
} from '@/lib/ai-document-synthesis-kill-switch';
/* @Codex */
import { extractPatientDataSmart, extractDocumentTextForSummary, isImageDocumentInput, isPdfDocumentInput } from '@/lib/pdf-service';
/* @Codex */
import { synthesizeDocument } from '@/lib/document-synthesis-service';
/* @Codex */
import { regeneratePatientSummary, getAiModelLabels } from '@/lib/ai-summary-service';
/* @Codex */
import { serializeDocumentParseEvidenceArtifact } from '@/lib/document-parse-evidence-artifact';
import DocumentViewer from '@/components/document-viewer';

interface DocumentUploadProps {
    patientId: string;
}

export default function DocumentUpload({ patientId }: DocumentUploadProps) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [viewingFile, setViewingFile] = useState<Attachment | null>(null);
    /* @Codex */
    const [aiStage, setAiStage] = useState<string>("");
    /* @Codex */
    const [aiModels, setAiModels] = useState<{ ocr: string; clinical: string } | null>(null);

    /* @Codex */
    useEffect(() => {
        const loadModels = async () => {
            const models = await getAiModelLabels();
            setAiModels(models);
        };
        loadModels();
    }, []);

    const attachments = useLiveQuery(
        async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const items = await db.attachments.filter((a: any) => a.patientId === patientId).toArray();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return items.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        },
        [patientId]
    );
    const documentSynthesisKillSwitch = useLiveQuery(() => db.settings.get(AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY), []);
    const documentSynthesisEnabled = isAiDocumentSynthesisEnabledValue(documentSynthesisKillSwitch?.value);



    // Logic to update Patient AI Summary REMOVED to avoid conflict with AIPatientInsight

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        setIsProcessing(true);
        /* @Codex */
        setAiStage("Inizializzazione AI...");
        let shouldRefreshSummary = false;
        // Limit total files if needed, here we just process
        for (const file of acceptedFiles) {
            try {
                // Auto-extract analysis on upload
                let summary = "Nessuna informazione rilevante trovata.";
                let parseEvidenceArtifactSnapshot: string | undefined;
                const attachmentId = uuidv4();
                const isPdf = isPdfDocumentInput(file);
                const isImage = isImageDocumentInput(file);

                /* @Codex */
                /* @Codex */
                if (isPdf || isImage) {
                    try {
                        setAiStage(`OCR in corso (${aiModels?.ocr ?? 'deepseek-ocr'})...`);
                        const extracted = await extractPatientDataSmart(file);
                        let rawText = extracted.rawText;
                        if (!rawText || rawText.length < 200) {
                            rawText = await extractDocumentTextForSummary(file);
                        }

                        if (rawText && documentSynthesisEnabled) {
                            setAiStage(`Sintesi documento (${aiModels?.clinical ?? 'qwen3.5:35b-a3b'})...`);
                            try {
                                const result = await synthesizeDocument(rawText, file.name, patientId, { attachmentId });
                                const insight = result.insight;
                                summary = insight.summary;
                                parseEvidenceArtifactSnapshot = serializeDocumentParseEvidenceArtifact(result.parseEvidenceArtifact);
                                shouldRefreshSummary = true;
                            } catch (synthesisError) {
                                if (synthesisError instanceof AiDocumentSynthesisDisabledError) {
                                    summary = 'Sintesi clinica documento disabilitata localmente.';
                                } else {
                                    throw synthesisError;
                                }
                            }
                        } else if (rawText && !documentSynthesisEnabled) {
                            summary = 'Sintesi clinica documento disabilitata localmente.';
                        } else if (extracted.notes) {
                            summary = extracted.notes;
                        } else {
                            summary = "Analisi completata (nessuna diagnosi esplicita rilevata)";
                        }
                    } catch (err) {
                        console.warn('[DocumentUpload] OCR/Sintesi fallita', err);
                    }
                }

                const base64Data = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                await db.attachments.add({
                    id: attachmentId,
                    patientId: patientId,
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    path: `uploads/${file.name}`,
                    data: base64Data,
                    summarySnapshot: summary,
                    parseEvidenceArtifactSnapshot,
                    createdAt: new Date()
                });

                // Trigger global update REMOVED

            } catch (e) {
                console.error("Upload failed", e);
                alert("Errore caricamento file: " + file.name);
            }
        }
        /* @Codex */
        if (shouldRefreshSummary) {
            try {
                setAiStage("Aggiornamento AI Patient Summary...");
                await regeneratePatientSummary(patientId);
            } catch (err) {
                console.warn('[DocumentUpload] Aggiornamento summary fallito', err);
            }
        }
        setIsProcessing(false);
        /* @Codex */
        setAiStage("");
    }, [patientId, aiModels, documentSynthesisEnabled]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

    const handleDelete = async (id: string) => {
        if (confirm("Sei sicuro di voler eliminare questo documento?")) {
            await db.attachments.delete(id);
            // Re-calculate summary REMOVED
        }
    };

    return (
        <div className="space-y-6">

            {/* AI Summary Card REMOVED */}

            {/* Upload Zone */}
            <div
                {...getRootProps()}
                className={cn(
                    "border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all",
                    isDragActive
                        ? "border-slate-400 bg-slate-50 dark:bg-white/10"
                        : "border-gray-300 dark:border-white/10 hover:border-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 bg-white/50 dark:bg-white/5"
                )}
            >
                <input {...getInputProps()} />
                <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-700 dark:bg-white/10 dark:text-slate-200">
                    {isProcessing ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
                </div>
                <p className="text-gray-700 dark:text-gray-200 font-medium text-sm">Carica Documenti</p>
                <p className="text-gray-400 text-xs mt-1">L&apos;IA estrarrà il contesto (max 10 file).</p>
            </div>

            {/* @Codex */}
            {(isProcessing || aiStage) && (
                <div className="text-xs text-gray-500">
                    <span className="font-medium">AI:</span> {aiStage || "Attesa..."}
                    {aiModels && (
                        <div className="mt-1 text-[10px] text-gray-400">
                            OCR: {aiModels.ocr} · Sintesi: {aiModels.clinical}
                        </div>
                    )}
                </div>
            )}

            {!documentSynthesisEnabled && (
                <div
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
                    data-testid="document-upload-synthesis-disabled-note"
                >
                    La sintesi clinica documento è disabilitata localmente. L&apos;upload e l&apos;OCR restano disponibili, ma l&apos;Archivio Intelligente e l&apos;aggiornamento di AI Patient Insight non vengono eseguiti.
                </div>
            )}

            {/* File List */}
            <div className="flex flex-col gap-3">
                {attachments?.map((file) => (
                    <div key={file.id} className="glass-card group flex items-center gap-3 p-3 transition-colors hover:border-slate-300 dark:hover:border-white/20">
                        <div className="p-2 bg-red-50 dark:bg-red-900/10 rounded-lg text-red-500 dark:text-red-400 border border-red-100 dark:border-white/5">
                            <FileText className="w-5 h-5" />
                        </div>

                        <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-gray-800 dark:text-gray-100 text-sm truncate">{file.name}</h4>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                {new Date(file.createdAt).toLocaleDateString()}
                            </p>
                            {file.summarySnapshot && (
                                <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-300">
                                    AI: {file.summarySnapshot}
                                </p>
                            )}
                        </div>

                        <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                                onClick={() => setViewingFile(file)}
                                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-slate-50 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-200"
                                title="Visualizza"
                            >
                                <Eye className="w-4 h-4" />
                            </button>

                            <button
                                onClick={() => handleDelete(file.id)}
                                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                title="Elimina"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Viewer Modal */}
            {viewingFile && viewingFile.data && (
                <DocumentViewer
                    file={viewingFile.data}
                    fileName={viewingFile.name}
                    onClose={() => setViewingFile(null)}
                />
            )}
        </div>
    );
}
