/* @Codex */
'use client';

import { useCallback, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Eye, FileText, Loader2, RefreshCw, Upload, X } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import DocumentSynthesisFabricReviewCard from '@/components/document-synthesis-fabric-review-card';
import DocumentViewer from '@/components/document-viewer';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { semanticSignalSurfaceClass } from '@/components/ui/semantic-signal';
import { useToast } from '@/components/ui/toast-provider';
import {
    AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY,
    isAiDocumentSynthesisEnabledValue,
} from '@/lib/ai-document-synthesis-kill-switch';
import { db, type Attachment } from '@/lib/db';
import { requestAnyDocLocalExtractionPreview } from '@/lib/domain/documents/anydoc-local-extraction-client';
import { useLiveQuery } from '@/lib/live-query';
import { sharedKillSwitchSignal } from '@/lib/ui-semantic-signal';
import { cn } from '@/lib/utils';

interface DocumentUploadProps {
    patientId: string;
}

type LocalExtractionState = Readonly<{
    attachmentId: string;
    status: 'available' | 'review_required';
    markdown?: string;
}>;

function fileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export default function DocumentUpload({ patientId }: DocumentUploadProps) {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [isProcessing, setIsProcessing] = useState(false);
    const [viewingFile, setViewingFile] = useState<Attachment | null>(null);
    const [extractingId, setExtractingId] = useState<string | null>(null);
    const [localExtraction, setLocalExtraction] = useState<LocalExtractionState | null>(null);
    const [fileRejections, setFileRejections] = useState<string[]>([]);

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
        if (localExtraction?.attachmentId === id) setLocalExtraction(null);
    };

    const handleLocalExtractionPreview = async (file: Attachment) => {
        if (extractingId) return;
        setExtractingId(file.id);
        setLocalExtraction(null);
        try {
            const preview = await requestAnyDocLocalExtractionPreview(file.id);
            if (preview) {
                setLocalExtraction({ attachmentId: file.id, status: 'available', markdown: preview.markdown });
                return;
            }
            setLocalExtraction({ attachmentId: file.id, status: 'review_required' });
            showToast({
                tone: 'warning',
                title: 'review_required · unsupported_local_extraction',
                description: 'Il documento richiede revisione manuale.',
            });
        } finally {
            setExtractingId(null);
        }
    };

    return (
        <div className="space-y-6">
            <div
                {...getRootProps()}
                className={cn(
                    'flex cursor-pointer flex-col items-center justify-center rounded-[var(--lume-radius-card)] border p-6 transition-[border-color,background-color] duration-[var(--lume-dur-fuoco)] ease-[var(--lume-ease)]',
                    isDragActive
                        ? 'lume-focal border-[color:color-mix(in_srgb,var(--lume-ink)_24%,transparent)] bg-[color:var(--lume-surface-focal)]'
                        : 'border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] hover:bg-[color:color-mix(in_srgb,var(--lume-ink)_5%,var(--lume-surface-field))]',
                )}
            >
                <input {...getInputProps()} aria-label="Carica documenti" />
                <div className="mb-3 rounded-full bg-[color:color-mix(in_srgb,var(--lume-accent)_11%,var(--lume-surface-field))] p-3 text-[color:var(--lume-accent)]">
                    {isProcessing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
                </div>
                <p className="text-sm font-medium text-[color:var(--lume-ink)]">Carica documenti</p>
                <p className="mt-1 text-center text-xs text-[color:var(--lume-ink-muted)]">
                    Prima viene registrato l&apos;allegato; estrazione locale e sintesi partono solo su azione manuale (max 10 file, 25 MB ciascuno).
                </p>
            </div>

            {fileRejections.length > 0 && (
                <ul className="space-y-1 rounded-xl border border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] px-3 py-2 text-xs text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">
                    {fileRejections.map((message) => <li key={message}>{message}</li>)}
                </ul>
            )}

            {!documentSynthesisEnabled && (
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

            <div className="flex flex-col gap-3">
                {attachments?.map((file) => (
                    <article key={file.id} className="lume-card group p-3 transition-colors hover:border-[color:color-mix(in_srgb,var(--lume-ink)_24%,transparent)]">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] p-2 text-[color:var(--lume-ink-muted)]">
                                <FileText className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h4 className="truncate text-sm font-bold text-[color:var(--lume-ink)]">{file.name}</h4>
                                <p className="text-[10px] uppercase tracking-wider text-[color:var(--lume-ink-muted)]">
                                    {new Date(file.createdAt).toLocaleDateString()}
                                </p>
                            </div>
                            <div className="flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                                <button
                                    type="button"
                                    onClick={() => handleLocalExtractionPreview(file)}
                                    disabled={extractingId !== null}
                                    className="rounded-lg p-2 text-[color:var(--lume-accent)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--lume-accent)_9%,var(--lume-surface-field))] disabled:opacity-50"
                                    title="Estrai testo localmente"
                                    aria-label={`Estrai testo localmente da ${file.name}`}
                                >
                                    <RefreshCw className={cn('h-4 w-4', extractingId === file.id && 'animate-spin')} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setViewingFile(file)}
                                    className="rounded-lg p-2 text-[color:var(--lume-ink-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] hover:text-[color:var(--lume-ink)]"
                                    title="Visualizza"
                                    aria-label={`Visualizza ${file.name}`}
                                >
                                    <Eye className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDelete(file.id)}
                                    className="rounded-lg p-2 text-[color:var(--lume-ink-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] hover:text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]"
                                    title="Elimina"
                                    aria-label={`Elimina ${file.name}`}
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        {localExtraction?.attachmentId === file.id && localExtraction.status === 'available' && (
                            <div className="mt-3 rounded-lg border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] p-2" role="status" data-testid="anydoc-local-extraction-preview">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">Anteprima AnyDoc locale · sola lettura</p>
                                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-[color:var(--lume-ink)]">{localExtraction.markdown}</pre>
                            </div>
                        )}
                        {localExtraction?.attachmentId === file.id && localExtraction.status === 'review_required' && (
                            <p className="mt-3 rounded-lg border border-[color:color-mix(in_srgb,var(--lume-signal-warning)_28%,transparent)] p-2 text-xs text-[color:color-mix(in_srgb,var(--lume-signal-warning)_65%,var(--lume-ink))]" role="status">
                                review_required · unsupported_local_extraction — revisione manuale necessaria.
                            </p>
                        )}

                        <DocumentSynthesisFabricReviewCard
                            attachmentId={file.id}
                            enabled={documentSynthesisEnabled}
                        />
                    </article>
                ))}
            </div>

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
