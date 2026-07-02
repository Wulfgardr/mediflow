'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Upload, FileText, X, Eye, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { db, Attachment } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { cn } from '@/lib/utils';
import { useLiveQuery, notifyDbChange } from '@/lib/live-query';
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
    type DocumentOcrQueueReason,
    type DocumentOcrQueueState,
} from '@/lib/document-ocr-queue';
/* @Codex */
import { synthesizeDocument } from '@/lib/document-synthesis-service';
/* @Codex */
import { refreshPatientSummaryIfEnabled, getAiModelLabels } from '@/lib/ai-summary-service';
/* @Codex */
import { serializeDocumentParseEvidenceArtifact } from '@/lib/document-parse-evidence-artifact';
import DocumentViewer from '@/components/document-viewer';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';

interface DocumentUploadProps {
    patientId: string;
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default function DocumentUpload({ patientId }: DocumentUploadProps) {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [isProcessing, setIsProcessing] = useState(false);
    const [viewingFile, setViewingFile] = useState<Attachment | null>(null);
    const [replayingId, setReplayingId] = useState<string | null>(null);
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
                let ocrQueue: { state: DocumentOcrQueueState; reason: DocumentOcrQueueReason } | undefined;
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

    // Replay documentale post-OCR: aggiorna l'allegato in-place (mai duplicato),
    // idempotente per hash documento lato server.
    const handleOcrReplay = async (file: Attachment) => {
        if (!file.data || replayingId) return;
        setReplayingId(file.id);
        try {
            await db.attachments.update(file.id, { ocrQueueState: 'processing' });
            let ocrText = '';
            try {
                const blob = await (await fetch(file.data)).blob();
                const replayFile = new File([blob], file.name, { type: file.type || blob.type });
                ocrText = await extractDocumentTextForSummary(replayFile);
            } catch (ocrError) {
                console.warn('[DocumentUpload] Replay OCR: estrazione fallita', ocrError);
            }

            const documentSha256 = await sha256Hex(file.data);
            const response = await fetch(`/api/attachments/${file.id}/ocr-replay`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ocrText, documentSha256 }),
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err?.error || 'Replay OCR fallito');
            }
            const replay = await response.json();
            console.info('[DocumentUpload] Replay OCR', {
                attachmentId: file.id,
                outcome: replay.outcome,
                state: replay.state,
                reason: replay.reason,
            });

            // Niente proposta clinica finché il testo non è sufficiente.
            if (replay.outcome === 'applied' && replay.state === 'ocr_done' && replay.sufficientText) {
                if (documentSynthesisEnabled) {
                    try {
                        const result = await synthesizeDocument(ocrText, file.name, patientId, { attachmentId: file.id });
                        await db.attachments.update(file.id, {
                            summarySnapshot: result.insight.summary,
                            parseEvidenceArtifactSnapshot: serializeDocumentParseEvidenceArtifact(result.parseEvidenceArtifact),
                        });
                        await refreshPatientSummaryIfEnabled(patientId);
                    } catch (synthesisError) {
                        if (synthesisError instanceof AiDocumentSynthesisDisabledError) {
                            await db.attachments.update(file.id, { summarySnapshot: 'Sintesi clinica documento disabilitata localmente.' });
                        } else {
                            console.warn('[DocumentUpload] Replay OCR: sintesi fallita', synthesisError);
                        }
                    }
                } else {
                    await db.attachments.update(file.id, { summarySnapshot: 'Sintesi clinica documento disabilitata localmente.' });
                }
            }
        } catch (err) {
            console.warn('[DocumentUpload] Replay OCR fallito', err);
            await db.attachments.update(file.id, { ocrQueueState: 'ocr_failed' }).catch(() => undefined);
        } finally {
            setReplayingId(null);
            notifyDbChange();
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
                <p className="text-gray-400 text-xs mt-1">L&apos;IA estrarrà il contesto (max 10 file, 25 MB ciascuno).</p>
            </div>

            {fileRejections.length > 0 && (
                <ul className="mt-2 space-y-1 rounded-xl border border-[color:rgba(163,58,47,0.28)] bg-[color:rgba(163,58,47,0.08)] px-3 py-2 text-xs text-[color:var(--mf-critical)]">
                    {fileRejections.map((message) => (
                        <li key={message}>{message}</li>
                    ))}
                </ul>
            )}

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

            {/* Coda OCR-needed: documenti bloccati con stato e motivo */}
            {ocrQueueEntries.length > 0 && (
                <div
                    className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
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
                            {file.ocrQueueState && (
                                <p
                                    className="mt-0.5 truncate text-xs font-medium text-amber-600 dark:text-amber-400"
                                    data-testid="document-ocr-queue-entry"
                                >
                                    OCR: {describeDocumentOcrQueueEntry(file.ocrQueueState as string, file.ocrQueueReason)}
                                </p>
                            )}
                        </div>

                        <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                            {file.ocrQueueState && file.ocrQueueState !== 'ocr_done' && (
                                <button
                                    onClick={() => handleOcrReplay(file)}
                                    disabled={replayingId !== null}
                                    className="rounded-lg p-2 text-[color:var(--mf-warning)] transition-colors hover:bg-[color:rgba(154,106,47,0.1)] disabled:opacity-50 dark:hover:bg-white/10"
                                    title="Riprova OCR"
                                    aria-label={`Riprova OCR su ${file.name}`}
                                >
                                    <RefreshCw className={cn("w-4 h-4", replayingId === file.id && "animate-spin")} />
                                </button>
                            )}
                            {file.ocrQueueState && canTransitionDocumentOcrQueueState(file.ocrQueueState, 'manual_review') && file.ocrQueueState !== 'manual_review' && (
                                <button
                                    onClick={() => handleOcrManualReview(file)}
                                    disabled={replayingId !== null}
                                    className="rounded-lg p-2 text-[color:var(--mf-warning)] transition-colors hover:bg-[color:rgba(154,106,47,0.1)] disabled:opacity-50 dark:hover:bg-white/10"
                                    title="Segna per revisione manuale"
                                    aria-label={`Segna ${file.name} per revisione manuale`}
                                >
                                    <AlertTriangle className="w-4 h-4" />
                                </button>
                            )}
                            <button
                                onClick={() => setViewingFile(file)}
                                className="rounded-lg p-2 text-[color:var(--mf-muted)] transition-colors hover:bg-[color:rgba(15,23,42,0.06)] hover:text-[color:var(--mf-ink)] dark:hover:bg-white/10"
                                title="Visualizza"
                                aria-label={`Visualizza ${file.name}`}
                            >
                                <Eye className="w-4 h-4" />
                            </button>

                            <button
                                onClick={() => handleDelete(file.id)}
                                className="p-2 text-[color:var(--mf-muted)] hover:text-[color:var(--mf-critical)] hover:bg-[color:rgba(163,58,47,0.1)] rounded-lg transition-colors"
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
