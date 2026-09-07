/* @Codex */
'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Eye, FileText, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import DocumentSynthesisFabricReviewCard from '@/components/document-synthesis-fabric-review-card';
import disclosure from '@/components/patient-disclosure.module.css';
import DocumentViewer from '@/components/document-viewer';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { semanticSignalSurfaceClass } from '@/components/ui/semantic-signal';
import { useToast } from '@/components/ui/toast-provider';
import {
    AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY,
    isAiDocumentSynthesisEnabledValue,
} from '@/lib/ai-document-synthesis-kill-switch';
import { db, type Attachment } from '@/lib/db';
import { requestAnyDocLocalExtractionPreview, type AnyDocLocalExtractionPreview } from '@/lib/domain/documents/anydoc-local-extraction-client';
import { useLiveQuery } from '@/lib/live-query';
import { sharedKillSwitchSignal } from '@/lib/ui-semantic-signal';
import { cn } from '@/lib/utils';

interface DocumentUploadProps {
    patientId: string;
    /* @Codex WUL-678: saved summaries share the review area without duplicate source lists. */
    children?: ReactNode;
}

type LocalExtractionState = (Readonly<{ attachmentId: string }> & AnyDocLocalExtractionPreview)
    | Readonly<{ attachmentId: string; status: 'review_required' | 'interrupted' }>;

function fileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export default function DocumentUpload({ patientId, children }: DocumentUploadProps) {
    const uploadHintId = useId();
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [isProcessing, setIsProcessing] = useState(false);
    const [viewingFile, setViewingFile] = useState<Attachment | null>(null);
    const [extractingId, setExtractingId] = useState<string | null>(null);
    const [localExtraction, setLocalExtraction] = useState<LocalExtractionState | null>(null);
    const activeExtraction = useRef<{ attachmentId: string; controller: AbortController } | null>(null);
    const [fileRejections, setFileRejections] = useState<string[]>([]);

    useEffect(() => () => {
        activeExtraction.current?.controller.abort();
        activeExtraction.current = null;
        setExtractingId(null);
        setLocalExtraction(null);
    }, [patientId]);

    const attachments = useLiveQuery(
        async () => {
            const items = await db.attachments.filter((attachment) => attachment.patientId === patientId).toArray();
            return items.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
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
        for (const file of acceptedFiles) {
            try {
                const attachmentId = uuidv4();
                const base64Data = await fileAsDataUrl(file);

                // The host persists the source before any local extraction or Fabric request.
                await db.attachments.add({
                    id: attachmentId,
                    patientId,
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    path: `uploads/${file.name}`,
                    data: base64Data,
                    createdAt: new Date(),
                });
            } catch (error) {
                console.error('[DocumentUpload] Upload failed', error);
                showToast({ tone: 'error', title: 'Caricamento file non riuscito', description: file.name });
            }
        }
        setIsProcessing(false);
    }, [patientId, showToast]);

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
        if (!confirmed) return;
        await db.attachments.delete(id);
        if (activeExtraction.current?.attachmentId === id) {
            activeExtraction.current.controller.abort();
            activeExtraction.current = null;
            setExtractingId(null);
        }
        if (localExtraction?.attachmentId === id) setLocalExtraction(null);
    };

    const interruptLocalExtraction = () => {
        const operation = activeExtraction.current;
        if (!operation) return;
        operation.controller.abort();
        activeExtraction.current = null;
        setExtractingId(null);
        setLocalExtraction({ attachmentId: operation.attachmentId, status: 'interrupted' });
    };

    const handleLocalExtractionPreview = async (file: Attachment) => {
        if (activeExtraction.current) return;
        const operation = { attachmentId: file.id, controller: new AbortController() };
        activeExtraction.current = operation;
        setExtractingId(file.id);
        setLocalExtraction(null);
        try {
            const preview = await requestAnyDocLocalExtractionPreview(file.id, globalThis.fetch, operation.controller.signal);
            if (activeExtraction.current !== operation) return;
            if (preview) {
                setLocalExtraction({ attachmentId: file.id, ...preview });
                return;
            }
            setLocalExtraction({ attachmentId: file.id, status: 'review_required' });
            showToast({
                tone: 'warning',
                title: 'review_required · unsupported_local_extraction',
                description: 'Il documento richiede revisione manuale.',
            });
        } finally {
            if (activeExtraction.current === operation) {
                activeExtraction.current = null;
                setExtractingId(null);
            }
        }
    };

    return (
        <div className={disclosure.documents} data-testid="patient-documents">
            <section aria-label="Caricamento documenti" data-document-area="upload">
                {attachments?.length === 0 ? <p className={disclosure.empty}>Nessun documento caricato.</p> : null}
                <div
                    {...getRootProps({ role: 'button', 'aria-label': 'Carica documenti', 'aria-describedby': uploadHintId })}
                    className={cn(
                        disclosure.upload,
                        isDragActive
                            ? 'lume-focal border-[color:color-mix(in_srgb,var(--lume-ink)_24%,transparent)] bg-[color:var(--lume-surface-focal)]'
                            : 'border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] hover:bg-[color:color-mix(in_srgb,var(--lume-ink)_5%,var(--lume-surface-field))]',
                    )}
                >
                    {/* @Codex: the dropzone is the single accessible file chooser. */}
                    <input {...getInputProps({ 'aria-hidden': true, tabIndex: -1 })} />
                    <div className={disclosure.uploadIcon} aria-hidden="true">
                        {isProcessing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
                    </div>
                    <p className="text-sm font-medium text-[color:var(--lume-ink)]">Carica documenti</p>
                    <p id={uploadHintId} className={disclosure.hint}>
                        Scegli o trascina fino a 10 file, 25 MB ciascuno. Poi puoi estrarre il testo e richiedere una sintesi.
                    </p>
                </div>

                {fileRejections.length > 0 && (
                    <ul className="space-y-1 rounded-xl border border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] px-3 py-2 text-xs text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">
                        {fileRejections.map((message) => <li key={message}>{message}</li>)}
                    </ul>
                )}
            </section>

            <section aria-label="Documenti caricati" data-document-area="list" className={disclosure.documentList}>
                {attachments?.map((file) => (
                    <article key={file.id} className={disclosure.documentRow}>
                        <div className={disclosure.documentHead}>
                            <div className="rounded-lg border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] p-2 text-[color:var(--lume-ink-muted)]">
                                <FileText className="h-5 w-5" aria-hidden="true" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h4 className={disclosure.documentTitle}>{file.name}</h4>
                                <p className={disclosure.hint}>
                                    Caricato il {new Date(file.createdAt).toLocaleDateString('it-IT')} · {Math.max(1, Math.ceil(file.size / 1024))} KB
                                </p>
                            </div>
                            <div className={disclosure.documentActions}>
                                <button
                                    type="button"
                                    onClick={() => handleLocalExtractionPreview(file)}
                                    disabled={extractingId !== null}
                                    className={disclosure.documentAction}
                                    title="Estrai testo localmente"
                                    aria-label={`Estrai testo localmente da ${file.name}`}
                                >
                                    <RefreshCw className={cn('h-4 w-4', extractingId === file.id && 'animate-spin')} aria-hidden="true" />
                                    Estrai testo
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setViewingFile(file)}
                                    className={disclosure.documentAction}
                                    title="Visualizza"
                                    aria-label={`Visualizza ${file.name}`}
                                >
                                    <Eye className="h-4 w-4" aria-hidden="true" />
                                    Apri
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDelete(file.id)}
                                    className={`${disclosure.documentAction} ${disclosure.removeAction}`}
                                    title="Elimina"
                                    aria-label={`Elimina ${file.name}`}
                                >
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                    Elimina
                                </button>
                            </div>
                        </div>

                        {extractingId === file.id && (
                            <div className="mt-3 flex items-center gap-3 text-xs" role="status">
                                <span>Estrazione locale in corso.</span>
                                <button type="button" onClick={interruptLocalExtraction} className="rounded-lg border px-3 py-2">
                                    Interrompi attesa
                                </button>
                            </div>
                        )}
                        {localExtraction?.attachmentId === file.id && localExtraction.status === 'available' && (
                            <div className="mt-3 rounded-lg border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] p-2" role="status" data-testid="anydoc-local-extraction-preview">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                    {localExtraction.ocr ? 'Anteprima OCR locale · sola lettura' : 'Anteprima AnyDoc locale · sola lettura'}
                                </p>
                                {localExtraction.ocr && (
                                    <p className="mt-1 text-xs text-[color:var(--lume-ink-muted)]">
                                        OCR completato su questo dispositivo · {localExtraction.ocr.ocrPageCount} {localExtraction.ocr.ocrPageCount === 1 ? 'pagina' : 'pagine'} su {localExtraction.ocr.pageCount}. Rivedi il testo prima di usarlo.
                                    </p>
                                )}
                                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-[color:var(--lume-ink)]">{localExtraction.markdown}</pre>
                            </div>
                        )}
                        {localExtraction?.attachmentId === file.id && localExtraction.status !== 'available' && (
                            <p className="mt-3 rounded-lg border border-[color:color-mix(in_srgb,var(--lume-signal-warning)_28%,transparent)] p-2 text-xs text-[color:color-mix(in_srgb,var(--lume-signal-warning)_65%,var(--lume-ink))]" role="status">
                                {localExtraction.status === 'interrupted'
                                    ? 'Attesa interrotta · revisione manuale necessaria. Puoi riprovare.'
                                    : 'review_required · unsupported_local_extraction — revisione manuale necessaria.'}
                            </p>
                        )}

                    </article>
                ))}
                {attachments === undefined ? <p role="status">Caricamento documenti…</p> : null}
            </section>

            {/* @Codex WUL-678: reviews stay mounted when folded, preserving proposal and currentness. */}
            {Boolean(attachments?.length) || children ? (
                <section aria-label="Sintesi documentali" data-document-area="summary" className={disclosure.summaries}>
                    <h3>Sintesi documentali</h3>
                    <p className={disclosure.hint}>Proposte da confrontare con le fonti. Nessun aggiornamento automatico della cartella.</p>
                    {Boolean(attachments?.length) && !documentSynthesisEnabled && (
                        <div
                            className={cn(
                                'rounded-2xl border p-3 text-xs leading-5',
                                semanticSignalSurfaceClass(sharedKillSwitchSignal(documentSynthesisEnabled)),
                            )}
                            data-testid="document-upload-synthesis-disabled-note"
                        >
                            La sintesi Fabric è disabilitata localmente. Upload, anteprima AnyDoc e revisione manuale restano disponibili; nessuna proposta viene generata.
                        </div>
                    )}

                    {attachments?.map((file) => (
                        <details key={file.id} className={disclosure.disclosure}>
                            <summary>Sintesi · {file.name}</summary>
                            <DocumentSynthesisFabricReviewCard
                                patientId={patientId}
                                attachmentId={file.id}
                                attachmentName={file.name}
                                enabled={documentSynthesisEnabled}
                            />
                        </details>
                    ))}
                    {children}
                </section>
            ) : null}

            {viewingFile?.data && (
                <DocumentViewer
                    file={viewingFile.data}
                    fileName={viewingFile.name}
                    onClose={() => setViewingFile(null)}
                />
            )}
        </div>
    );
}
