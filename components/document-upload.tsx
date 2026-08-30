'use client';

import { useCallback, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Upload, FileText, X, Eye, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
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
import { extractPatientDataSmart, extractDocumentTextForSummary, isImageDocumentInput, isPdfDocumentInput, DocumentTextUnavailableError } from '@/lib/pdf-service';
import {
    canTransitionDocumentOcrQueueState,
    describeDocumentOcrQueueEntry,
    evaluateDocumentOcrQueueCandidate,
    type HostDocumentOcrQueueReason,
    type DocumentOcrQueueState,
} from '@/lib/domain/documents/document-ocr-queue';
/* @Codex */
import { synthesizeDocument } from '@/lib/domain/documents/document-synthesis-service';
/* @Codex */
import { refreshPatientSummaryIfEnabled } from '@/lib/ai-summary-service';
import { useAiModelLabels } from '@/lib/hooks/use-ai-model-labels';
/* @Codex */
import { serializeDocumentParseEvidenceArtifact } from '@/lib/domain/documents/document-parse-evidence-artifact';
import DocumentViewer from '@/components/document-viewer';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { semanticSignalSurfaceClass } from '@/components/ui/semantic-signal';
import { sharedKillSwitchSignal } from '@/lib/ui-semantic-signal';
import { requestAnyDocLocalExtractionPreview } from '@/lib/domain/documents/anydoc-local-extraction-client';

interface DocumentUploadProps {
    patientId: string;
}

/* @Codex */
async function readSourceBytes(source: Blob | undefined): Promise<ArrayBuffer | undefined> {
    if (!source) return undefined;

    try {
        return await source.arrayBuffer();
    } catch {
        return undefined;
    }
}

export default function DocumentUpload({ patientId }: DocumentUploadProps) {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [isProcessing, setIsProcessing] = useState(false);
    const [viewingFile, setViewingFile] = useState<Attachment | null>(null);
    const [extractingId, setExtractingId] = useState<string | null>(null);
    const [localExtractionPreview, setLocalExtractionPreview] = useState<{ attachmentId: string; markdown: string } | null>(null);
    /* @Codex */
    const [aiStage, setAiStage] = useState<string>("");
    /* @Codex */
    const aiModels = useAiModelLabels();

    const attachments = useLiveQuery(
        async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const items = await db.attachments.filter((a: any) => a.patientId === patientId).toArray();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return items.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        },
        [patientId],
        undefined,
        ['attachments'],
    );
    const documentSynthesisKillSwitch = useLiveQuery(
        () => db.settings.get(AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY),
        [],
        undefined,
        ['settings'],
    );
    const documentSynthesisEnabled = isAiDocumentSynthesisEnabledValue(documentSynthesisKillSwitch?.value);



    // Logic to update Patient AI Summary REMOVED to avoid conflict with AIPatientInsight

    /* @Codex WUL-UIUX: feedback inline sulle rejection (max 10 file, 25 MB)
       invece del silenzio (la caption prometteva max 10 senza applicarlo). */
    const [fileRejections, setFileRejections] = useState<string[]>([]);

    const onDropRejected = useCallback((rejected: FileRejection[]) => {
        const messages = rejected.map((entry) => {
            const reason = entry.errors[0]?.code;
            if (reason === 'too-many-files') return 'Puoi caricare al massimo 10 file per volta.';
            if (reason === 'file-too-large') return `${entry.file.name}: supera il limite di 25 MB.`;
            return `${entry.file.name}: file non accettato.`;
        });
        setFileRejections(Array.from(new Set(messages)));
    }, []);

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        setFileRejections([]);
        setIsProcessing(true);
        /* @Codex */
        setAiStage("Inizializzazione AI...");
        let shouldRefreshSummary = false;
        // Limit total files if needed, here we just process
        for (const file of acceptedFiles) {
            try {
                // Auto-extract analysis on upload
                let summary: string | undefined = "Nessuna informazione rilevante trovata.";
                let parseEvidenceArtifactSnapshot: string | undefined;
                let ocrQueue: { state: DocumentOcrQueueState; reason: HostDocumentOcrQueueReason } | undefined;
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

                        const queueCandidate = evaluateDocumentOcrQueueCandidate({
                            inputKind: isPdf ? 'pdf' : 'image',
                            extractedText: rawText || '',
                        });
                        if (queueCandidate.queued) {
                            // Documento muto: niente classificazione debole né summarySnapshot
                            // (la review queue lo legge come "serve testo") finché l'OCR non produce testo.
                            ocrQueue = { state: queueCandidate.state, reason: queueCandidate.reason };
                            summary = undefined;
                            console.info('[DocumentUpload] Documento in coda OCR-needed', {
                                attachmentId,
                                state: queueCandidate.state,
                                reason: queueCandidate.reason,
                            });
                        } else if (rawText && documentSynthesisEnabled) {
                            setAiStage(`Sintesi documento (${aiModels?.clinical ?? 'qwen3.5:35b-a3b'})...`);
                            try {
                                const sourceBytes = await readSourceBytes(file);
                                const result = await synthesizeDocument(rawText, file.name, patientId, { attachmentId, sourceBytes });
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
                        if (err instanceof DocumentTextUnavailableError) {
                            const queueCandidate = evaluateDocumentOcrQueueCandidate({
                                inputKind: isPdf ? 'pdf' : 'image',
                                extractedText: '',
                                extractionFailure: err.textLayerFailure,
                            });
                            if (queueCandidate.queued) {
                                ocrQueue = { state: queueCandidate.state, reason: queueCandidate.reason };
                                summary = undefined;
                                console.info('[DocumentUpload] Documento in coda OCR-needed', {
                                    attachmentId,
                                    state: queueCandidate.state,
                                    reason: queueCandidate.reason,
                                });
                            }
                        } else {
                            console.warn('[DocumentUpload] OCR/Sintesi fallita', err);
                        }
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
                    ocrQueueState: ocrQueue?.state,
                    ocrQueueReason: ocrQueue?.reason,
                    createdAt: new Date()
                });

                // Trigger global update REMOVED

            } catch (e) {
                console.error("Upload failed", e);
                showToast({ tone: 'error', title: 'Caricamento file non riuscito', description: file.name });
            }
        }
        /* @Codex */
        if (shouldRefreshSummary) {
            try {
                setAiStage("Aggiornamento AI Patient Summary...");
                await refreshPatientSummaryIfEnabled(patientId);
            } catch (err) {
                console.warn('[DocumentUpload] Aggiornamento summary fallito', err);
            }
        }
        setIsProcessing(false);
        /* @Codex */
        setAiStage("");
    }, [patientId, aiModels, documentSynthesisEnabled, showToast]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        onDropRejected,
        maxFiles: 10,
        maxSize: 25 * 1024 * 1024,
    });

    const handleDelete = async (id: string) => {
        const { confirmed } = await confirm({
            title: 'Sei sicuro di voler eliminare questo documento?',
            message: 'Il documento verra rimosso dagli allegati del paziente.',
            confirmLabel: 'Elimina',
            tone: 'danger',
        });
        if (confirmed) {
            await db.attachments.delete(id);
            // Re-calculate summary REMOVED
        }
    };

    /* @Codex: preview transitoria; nessuna persistenza o sintesi downstream. */
    const handleLocalExtractionPreview = async (file: Attachment) => {
        if (extractingId) return;
        setExtractingId(file.id);
        setLocalExtractionPreview(null);
        try {
            const preview = await requestAnyDocLocalExtractionPreview(file.id);
            if (preview) setLocalExtractionPreview({ attachmentId: file.id, markdown: preview.markdown });
            else showToast({ tone: 'warning', title: 'Estrazione locale non disponibile', description: 'Il documento richiede revisione manuale.' });
        } finally {
            setExtractingId(null);
        }
    };

    const handleOcrManualReview = async (file: Attachment) => {
        if (!file.ocrQueueState || !canTransitionDocumentOcrQueueState(file.ocrQueueState, 'manual_review')) return;
        try {
            await db.attachments.update(file.id, { ocrQueueState: 'manual_review' });
        } catch (err) {
            console.warn('[DocumentUpload] Passaggio a revisione manuale fallito', err);
        }
    };

    const ocrQueueEntries = (attachments ?? []).filter(
        (file) => file.ocrQueueState && file.ocrQueueState !== 'ocr_done'
    );

    return (
        <div className="space-y-6">

            {/* AI Summary Card REMOVED */}

            {/* Upload Zone */}
            <div
                {...getRootProps()}
                className={cn(
                    "rounded-[var(--lume-radius-card)] border p-6 flex flex-col items-center justify-center cursor-pointer transition-[border-color,background-color] duration-[var(--lume-dur-fuoco)] ease-[var(--lume-ease)]",
                    isDragActive
                        ? "lume-focal border-[color:color-mix(in_srgb,var(--lume-ink)_24%,transparent)] bg-[color:var(--lume-surface-focal)]"
                        : "border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] hover:bg-[color:color-mix(in_srgb,var(--lume-ink)_5%,var(--lume-surface-field))]"
                )}
            >
                <input {...getInputProps()} />
                <div className="mb-3 rounded-full bg-[color:color-mix(in_srgb,var(--lume-accent)_11%,var(--lume-surface-field))] p-3 text-[color:var(--lume-accent)]">
                    {isProcessing ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
                </div>
                <p className="text-sm font-medium text-[color:var(--lume-ink)]">Carica Documenti</p>
                <p className="mt-1 text-xs text-[color:var(--lume-ink-muted)]">L&apos;IA estrarrà il contesto (max 10 file, 25 MB ciascuno).</p>
            </div>

            {fileRejections.length > 0 && (
                <ul className="mt-2 space-y-1 rounded-xl border border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] px-3 py-2 text-xs text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">
                    {fileRejections.map((message) => (
                        <li key={message}>{message}</li>
                    ))}
                </ul>
            )}

            {/* @Codex */}
            {(isProcessing || aiStage) && (
                <div className="text-xs text-[color:var(--lume-ink-muted)]">
                    <span className="font-medium">AI:</span> {aiStage || "Attesa..."}
                    {aiModels && (
                        <div className="mt-1 text-[10px] text-[color:var(--lume-ink-muted)]">
                            OCR: {aiModels.ocr} · Sintesi: {aiModels.clinical}
                        </div>
                    )}
                </div>
            )}

            {!documentSynthesisEnabled && (
                <div
                    className={cn(
                        'rounded-2xl border p-3 text-xs leading-5',
                        semanticSignalSurfaceClass(sharedKillSwitchSignal(documentSynthesisEnabled)),
                    )}
                    data-testid="document-upload-synthesis-disabled-note"
                >
                    La sintesi clinica documento è disabilitata localmente. L&apos;upload e l&apos;OCR restano disponibili, ma l&apos;Archivio Intelligente e l&apos;aggiornamento di AI Patient Insight non vengono eseguiti.
                </div>
            )}

            {/* Coda OCR-needed: documenti bloccati con stato e motivo */}
            {ocrQueueEntries.length > 0 && (
                <div
                    className="rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-signal-warning)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))] p-3 text-xs leading-5 text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]"
                    data-testid="document-ocr-queue-panel"
                >
                    <p className="font-medium">
                        Coda OCR: {ocrQueueEntries.length} {ocrQueueEntries.length === 1 ? 'documento bloccato' : 'documenti bloccati'} (nessuna proposta clinica finché manca testo utile)
                    </p>
                    <ul className="mt-1 space-y-0.5">
                        {ocrQueueEntries.map((file) => (
                            <li key={file.id} className="truncate">
                                {file.name} · {describeDocumentOcrQueueEntry(file.ocrQueueState as string, file.ocrQueueReason)}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* File List */}
            <div className="flex flex-col gap-3">
                {attachments?.map((file) => (
                    <div key={file.id} className="lume-card group flex items-center gap-3 p-3 transition-colors hover:border-[color:color-mix(in_srgb,var(--lume-ink)_24%,transparent)]">
                        <div className="rounded-lg border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] p-2 text-[color:var(--lume-ink-muted)]">
                            <FileText className="w-5 h-5" />
                        </div>

                        <div className="flex-1 min-w-0">
                            <h4 className="truncate text-sm font-bold text-[color:var(--lume-ink)]">{file.name}</h4>
                            <p className="text-[10px] uppercase tracking-wider text-[color:var(--lume-ink-muted)]">
                                {new Date(file.createdAt).toLocaleDateString()}
                            </p>
                            {file.summarySnapshot && (
                                <p className="mt-0.5 truncate text-xs text-[color:var(--lume-ink-muted)]">
                                    AI: {file.summarySnapshot}
                                </p>
                            )}
                            {file.ocrQueueState && (
                                <p
                                    className="mt-0.5 truncate text-xs font-medium text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]"
                                    data-testid="document-ocr-queue-entry"
                                >
                                    OCR: {describeDocumentOcrQueueEntry(file.ocrQueueState as string, file.ocrQueueReason)}
                                </p>
                            )}
                            {localExtractionPreview?.attachmentId === file.id && (
                                <div className="mt-2 rounded-lg border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] p-2" role="status" data-testid="anydoc-local-extraction-preview">
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">Anteprima estrazione locale (sola lettura)</p>
                                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-[color:var(--lume-ink)]">{localExtractionPreview.markdown}</pre>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                            {file.ocrQueueState && file.ocrQueueState !== 'ocr_done' && (
                                <button
                                    onClick={() => handleLocalExtractionPreview(file)}
                                    disabled={extractingId !== null}
                                    className="rounded-lg p-2 text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))] transition-colors hover:bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))] disabled:opacity-50"
                                    title="Estrai testo localmente"
                                    aria-label={`Estrai testo localmente da ${file.name}`}
                                >
                                    <RefreshCw className={cn("w-4 h-4", extractingId === file.id && "animate-spin")} />
                                </button>
                            )}
                            {file.ocrQueueState && canTransitionDocumentOcrQueueState(file.ocrQueueState, 'manual_review') && file.ocrQueueState !== 'manual_review' && (
                                <button
                                    onClick={() => handleOcrManualReview(file)}
                                    disabled={extractingId !== null}
                                    className="rounded-lg p-2 text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))] transition-colors hover:bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))] disabled:opacity-50"
                                    title="Segna per revisione manuale"
                                    aria-label={`Segna ${file.name} per revisione manuale`}
                                >
                                    <AlertTriangle className="w-4 h-4" />
                                </button>
                            )}
                            <button
                                onClick={() => setViewingFile(file)}
                                className="rounded-lg p-2 text-[color:var(--lume-ink-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] hover:text-[color:var(--lume-ink)]"
                                title="Visualizza"
                                aria-label={`Visualizza ${file.name}`}
                            >
                                <Eye className="w-4 h-4" />
                            </button>

                            <button
                                onClick={() => handleDelete(file.id)}
                                className="rounded-lg p-2 text-[color:var(--lume-ink-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] hover:text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]"
                                title="Elimina"
                                aria-label={`Elimina ${file.name}`}
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
