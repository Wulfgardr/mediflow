/* @Codex */
'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Eye, FileText, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import DocumentSynthesisFabricReviewCard from '@/components/document-synthesis-fabric-review-card';
import disclosure from '@/components/patient-disclosure.module.css';
import DocumentViewer from '@/components/document-viewer';
import PrivacyBlur from '@/components/privacy-blur';
import { usePrivacy } from '@/components/privacy-provider';
import { useSecurity } from '@/components/security-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { semanticSignalSurfaceClass } from '@/components/ui/semantic-signal';
import {
    AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY,
    isAiDocumentSynthesisEnabledValue,
} from '@/lib/ai-document-synthesis-kill-switch';
import { db, type Attachment } from '@/lib/db';
import { requestAnyDocDecryptedLocalExtractionPreview, type AnyDocLocalExtractionPreview } from '@/lib/domain/documents/anydoc-local-extraction-client';
import { createDocumentUploadQueue, readDocumentDataUrl, type DocumentUploadResult } from '@/lib/domain/documents/document-upload-queue';
import { useLiveQueryState } from '@/lib/live-query';
import { sharedKillSwitchSignal } from '@/lib/ui-semantic-signal';
import { cn } from '@/lib/utils';

interface DocumentUploadProps {
    patientId: string;
    children?: ReactNode;
}

type LocalExtractionState = (Readonly<{ attachmentId: string; sourceSnapshot?: readonly Attachment[] }> & AnyDocLocalExtractionPreview)
    | Readonly<{ attachmentId: string; sourceSnapshot?: readonly Attachment[]; status: 'review_required' | 'interrupted' }>;

function rejectionMessages(rejected: FileRejection[]): string[] {
    return [...new Set(rejected.map((entry) => {
        if (entry.errors.some((error) => error.code === 'too-many-files')) return 'Puoi caricare al massimo 10 file per volta.';
        if (entry.errors.some((error) => error.code === 'file-too-large')) return `${entry.file.name}: supera il limite di 25 MB.`;
        return `${entry.file.name}: file non accettato.`;
    }))];
}

function DocumentUploadSession({ patientId, children }: DocumentUploadProps) {
    const { isPrivacyMode } = usePrivacy();
    const uploadHintId = useId();
    const summaryTitleId = useId();
    const confirm = useConfirm();
    const [isProcessing, setIsProcessing] = useState(false);
    const [stopRequested, setStopRequested] = useState(false);
    const [uploadResult, setUploadResult] = useState<DocumentUploadResult | null>(null);
    const [viewingId, setViewingId] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState('');
    const summaryHeading = useRef<HTMLHeadingElement>(null);
    const [extractingId, setExtractingId] = useState<string | null>(null);
    const [localExtraction, setLocalExtraction] = useState<LocalExtractionState | null>(null);
    const activeExtraction = useRef<{ attachmentId: string; sourceSnapshot: readonly Attachment[] | undefined; controller: AbortController } | null>(null);
    const activeDelete = useRef<object | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [deleteErrorId, setDeleteErrorId] = useState<string | null>(null);
    const [fileRejections, setFileRejections] = useState<string[]>([]);
    const generation = useRef(0);
    const [uploadQueue] = useState(() => createDocumentUploadQueue<File>({
        read: readDocumentDataUrl,
        persist: (file, data) => db.attachments.add({
            id: uuidv4(), patientId, name: file.name, type: file.type, size: file.size,
            path: `uploads/${file.name}`, data, createdAt: new Date(),
        }),
    }));

    useEffect(() => {
        // A full navigation/bfcache transition may happen before React unmounts.
        // Retire unsubmitted work and transient document views, not durable writes.
        const retireDocument = () => {
            uploadQueue.cancel();
            activeExtraction.current?.controller.abort();
            activeExtraction.current = null;
            activeDelete.current = null;
            setStopRequested(true);
            setExtractingId(null); setDeletingId(null);
            setSelectedId(''); setViewingId(null); setLocalExtraction(null);
        };
        window.addEventListener('pagehide', retireDocument);
        return () => {
            window.removeEventListener('pagehide', retireDocument);
            generation.current += 1;
            uploadQueue.cancel();
            activeExtraction.current?.controller.abort();
            activeExtraction.current = null;
            activeDelete.current = null;
        };
    }, [uploadQueue]);

    const { data: attachments, error: listError, loading: listLoading, refresh: refreshAttachments } = useLiveQueryState(
        async () => {
            const items = await db.attachments.query({ patientId }).toArray();
            return items.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
        },
        [patientId], undefined, ['attachments'],
    );
    const { data: killSwitch, error: settingError, loading: settingLoading, refresh: refreshSetting } = useLiveQueryState(
        () => db.settings.get(AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY),
        [], undefined, ['settings'],
    );
    const documentSynthesisEnabled = !settingLoading && !settingError && isAiDocumentSynthesisEnabledValue(killSwitch?.value);
    // A failed refresh does not turn the previous list into a new empty result.
    // Old source actions/publications are withheld until a successful reread.
    const currentAttachments = listError ? undefined : attachments;
    const selectedAttachment = currentAttachments?.find((file) => file.id === selectedId);
    const viewingFile = currentAttachments?.find((file) => file.id === viewingId);

    const onDrop = useCallback(async (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
        const task = uploadQueue.start(acceptedFiles);
        // Rejections belong to this selection, including mixed accepted/rejected drops.
        setFileRejections(rejectionMessages(rejectedFiles));
        if (!task) return;
        const token = generation.current;
        setIsProcessing(true); setStopRequested(false); setUploadResult(null);
        try {
            const result = await task;
            if (token === generation.current) setUploadResult(result);
        } finally {
            if (token === generation.current) setIsProcessing(false);
        }
    }, [uploadQueue]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop, disabled: isProcessing, maxFiles: 10, maxSize: 25 * 1024 * 1024,
    });

    const handleDelete = async (file: Attachment) => {
        if (activeDelete.current) return;
        const operation = {};
        activeDelete.current = operation;
        setDeletingId(file.id); setDeleteErrorId(null);
        try {
            const { confirmed } = await confirm({
                title: 'Eliminare questo documento?',
                message: 'Il documento verrà rimosso dagli allegati del paziente.',
                confirmLabel: 'Elimina', tone: 'danger',
            });
            if (!confirmed || activeDelete.current !== operation) return;
            await db.attachments.delete(file.id);
            if (activeDelete.current !== operation) return;
            if (activeExtraction.current?.attachmentId === file.id) {
                activeExtraction.current.controller.abort(); activeExtraction.current = null; setExtractingId(null);
            }
            setLocalExtraction((value) => value?.attachmentId === file.id ? null : value);
            setViewingId((value) => value === file.id ? null : value);
            setSelectedId((value) => value === file.id ? '' : value);
        } catch {
            // Do not log source names, file bytes or backend error bodies.
            if (activeDelete.current === operation) setDeleteErrorId(file.id);
        } finally {
            if (activeDelete.current === operation) { activeDelete.current = null; setDeletingId(null); }
        }
    };

    /* @Codex: extraction-only lifecycle; upload/delete/synthesis ownership is unchanged. */
    const extractionSessionSignal = db.getSessionReadSignal();
    const retireExtraction = useCallback(() => {
        activeExtraction.current?.controller.abort(); activeExtraction.current = null;
        setExtractingId(null); setLocalExtraction(null);
    }, []);
    useEffect(() => {
        extractionSessionSignal.addEventListener('abort', retireExtraction, { once: true });
        return () => extractionSessionSignal.removeEventListener('abort', retireExtraction);
    }, [extractionSessionSignal, retireExtraction]);
    useEffect(() => {
        // A source/view choice retires only transient extraction work.
        return () => retireExtraction();
    }, [selectedId, viewingId, retireExtraction]);
    useEffect(() => {
        const pending = activeExtraction.current;
        // Any refresh of the attachment view retires transient extraction. The ordinary
        // list intentionally has no host currentness tuple, so do not invent one here.
        if (pending && (listError || listLoading || attachments !== pending.sourceSnapshot))
            pending.controller.abort();
    }, [attachments, listError, listLoading]);
    if (localExtraction && (listError || listLoading || attachments !== localExtraction.sourceSnapshot))
        setLocalExtraction(null);

    const interruptLocalExtraction = () => {
        const operation = activeExtraction.current;
        if (!operation) return;
        operation.controller.abort(); activeExtraction.current = null; setExtractingId(null);
        setLocalExtraction({ attachmentId: operation.attachmentId, sourceSnapshot: operation.sourceSnapshot, status: 'interrupted' });
    };

    const handleLocalExtractionPreview = async (file: Attachment) => {
        if (activeExtraction.current || listLoading || listError || deletingId === file.id || extractionSessionSignal.aborted) return;
        const operation = { attachmentId: file.id, sourceSnapshot: attachments, controller: new AbortController() };
        const signal = AbortSignal.any([operation.controller.signal, extractionSessionSignal]);
        activeExtraction.current = operation; setExtractingId(file.id); setLocalExtraction(null);
        try {
            const preview = await requestAnyDocDecryptedLocalExtractionPreview(file.id, async () => {
                if (signal.aborted) return null;
                const source = await db.attachments.get(file.id, { signal });
                return !signal.aborted && source?.patientId === patientId ? source : null;
            }, globalThis.fetch, signal);
            if (activeExtraction.current !== operation || signal.aborted) return;
            setLocalExtraction(preview ? { attachmentId: file.id, sourceSnapshot: operation.sourceSnapshot, ...preview }
                : { attachmentId: file.id, sourceSnapshot: operation.sourceSnapshot, status: 'review_required' });
        } finally {
            if (activeExtraction.current === operation) { activeExtraction.current = null; setExtractingId(null); }
        }
    };

    return (
        <div className={disclosure.documents} data-testid="patient-documents">
            <section aria-label="Caricamento documenti" data-document-area="upload">
                {currentAttachments?.length === 0 && !listLoading ? (
                    <p className={disclosure.empty}>Nessun documento caricato. Aggiungi un file per consultarlo e, separatamente, richiedere una sintesi.</p>
                ) : null}
                <div
                    {...getRootProps({ role: 'button', 'aria-label': 'Carica documenti', 'aria-describedby': uploadHintId,
                        'aria-disabled': isProcessing, 'aria-busy': isProcessing })}
                    className={cn(disclosure.upload, isDragActive
                        ? 'lume-focal border-[color:color-mix(in_srgb,var(--lume-ink)_24%,transparent)] bg-[color:var(--lume-surface-focal)]'
                        : 'border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)]')}
                >
                    <input {...getInputProps({ 'aria-hidden': true, tabIndex: -1 })} />
                    <div className={disclosure.uploadIcon} aria-hidden="true">
                        {isProcessing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
                    </div>
                    <p className="text-sm font-medium">Carica documenti</p>
                    <p id={uploadHintId} className={disclosure.hint}>Scegli o trascina fino a 10 file, 25 MB ciascuno. Il caricamento salva gli allegati, senza avviare estrazione o sintesi.</p>
                </div>
                {isProcessing && (
                    <div className="mt-3 flex flex-wrap items-center gap-3" role="status">
                        <span>{stopRequested ? 'Interruzione richiesta. Attesa dell’esito del file già inviato.' : 'Salvataggio allegati in corso…'}</span>
                        <button type="button" className={disclosure.documentAction} data-lume-action="quiet" disabled={stopRequested}
                            onClick={() => { uploadQueue.cancel(); setStopRequested(true); }}>Interrompi coda</button>
                        <p className={disclosure.hint}>Un file già inviato può essere salvato; l’interruzione ferma solo lettura e invii successivi.</p>
                    </div>
                )}
                {uploadResult && (
                    <div className="mt-3" role="status">
                        <p>{uploadResult.saved} {uploadResult.saved === 1 ? 'allegato salvato' : 'allegati salvati'}.
                            {uploadResult.interrupted ? ` Coda interrotta: ${uploadResult.notStarted} file non inviati.` : ''}</p>
                        {uploadResult.unconfirmed.length > 0 && <>
                            <p>Salvataggio non confermato per:</p>
                            <ul>{uploadResult.unconfirmed.map((name, index) => <li key={`${index}-${name}`}><PrivacyBlur>{name}</PrivacyBlur></li>)}</ul>
                            <p>Rileggi l’elenco prima di caricare di nuovo: un file potrebbe essere già stato salvato.</p>
                            <button type="button" className={disclosure.documentAction} data-lume-action="quiet" onClick={refreshAttachments} disabled={listLoading}>Rileggi elenco</button>
                        </>}
                    </div>
                )}
                {fileRejections.length > 0 && (
                    <div className="mt-3" role="alert"><ul>{fileRejections.map((message) => <li key={message}><PrivacyBlur>{message}</PrivacyBlur></li>)}</ul></div>
                )}
            </section>

            <section aria-label="Documenti caricati" data-document-area="list" className={disclosure.documentList} aria-busy={listLoading}>
                {listError ? <div role="alert">
                    <p>Elenco documenti non disponibile. Non è possibile stabilire quali file siano presenti.</p>
                    <button type="button" className={disclosure.documentAction} data-lume-action="quiet" onClick={refreshAttachments} disabled={listLoading}>Riprova elenco</button>
                </div> : null}
                {!listError && attachments === undefined ? <p role="status">Caricamento documenti…</p> : null}
                {currentAttachments?.map((file) => (
                    <article key={file.id} className={disclosure.documentRow} data-document-id={file.id}>
                        <div className={disclosure.documentHead}>
                            <FileText className="h-5 w-5 shrink-0" aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                                <h4 className={disclosure.documentTitle}><PrivacyBlur>{file.name}</PrivacyBlur></h4>
                                <p className={disclosure.hint}>Caricato il {new Date(file.createdAt).toLocaleDateString('it-IT')} · {Math.max(1, Math.ceil(file.size / 1024))} KB</p>
                                <p className={disclosure.hint} data-testid="document-source-status">
                                    {extractingId === file.id ? 'Estrazione in corso' : localExtraction?.attachmentId === file.id
                                        ? localExtraction.status === 'available' ? 'Testo disponibile · da rivedere' : 'Revisione manuale necessaria'
                                        : 'Allegato salvato · testo non verificato in questa sessione'}
                                </p>
                            </div>
                            <div className={disclosure.documentActions}>
                                <button type="button" onClick={() => setViewingId(file.id)} disabled={!file.data || deletingId === file.id}
                                    className={disclosure.documentAction} data-lume-action="quiet" title={file.data ? 'Visualizza' : 'Contenuto file non disponibile'} aria-label={`Visualizza ${file.name}`}>
                                    <Eye className="h-4 w-4" aria-hidden="true" />Apri
                                </button>
                                <button type="button" onClick={() => handleLocalExtractionPreview(file)} disabled={extractingId !== null || deletingId === file.id}
                                    className={disclosure.documentAction} data-lume-action="quiet" aria-label={`Estrai testo localmente da ${file.name}`}>
                                    <RefreshCw className={cn('h-4 w-4', extractingId === file.id && 'animate-spin')} aria-hidden="true" />Estrai testo
                                </button>
                                <button type="button" className={disclosure.documentAction} data-lume-action="quiet" disabled={deletingId === file.id}
                                    aria-label={`Prepara sintesi di ${file.name}`} onClick={() => { setSelectedId(file.id); summaryHeading.current?.focus(); }}>Sintesi</button>
                                <button type="button" onClick={() => handleDelete(file)} disabled={deletingId !== null}
                                    className={`${disclosure.documentAction} ${disclosure.removeAction}`} data-lume-action="quiet" aria-label={`Elimina ${file.name}`}>
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />{deletingId === file.id ? 'Eliminazione…' : 'Elimina'}
                                </button>
                            </div>
                        </div>
                        {deleteErrorId === file.id && <div className="mt-3" role="alert">
                            <p>Eliminazione non confermata. Rileggi l’elenco prima di riprovare.</p>
                            <button type="button" className={disclosure.documentAction} data-lume-action="quiet" onClick={refreshAttachments} disabled={listLoading}>Rileggi elenco</button>
                        </div>}
                        {extractingId === file.id && <div className="mt-3 flex flex-wrap items-center gap-3" role="status">
                            <span>Estrazione locale in corso.</span>
                            <button type="button" onClick={interruptLocalExtraction} className={disclosure.documentAction} data-lume-action="quiet">Interrompi attesa</button>
                        </div>}
                        {localExtraction?.attachmentId === file.id && localExtraction.status === 'available' && (
                            <details className={disclosure.disclosure} data-testid="anydoc-local-extraction-preview">
                                <summary>{localExtraction.ocr ? 'Testo OCR locale · da rivedere' : 'Testo estratto localmente · da rivedere'}</summary>
                                {localExtraction.ocr && <p className={disclosure.hint}>OCR: {localExtraction.ocr.ocrPageCount} pagine su {localExtraction.ocr.pageCount}. Rivedi il testo prima di usarlo.</p>}
                                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-sm"><PrivacyBlur>{localExtraction.markdown}</PrivacyBlur></pre>
                            </details>
                        )}
                        {localExtraction?.attachmentId === file.id && localExtraction.status !== 'available' && <div className="mt-3" role="status">
                            <p>{localExtraction.status === 'interrupted' ? 'Attesa interrotta. Puoi riprovare con “Estrai testo”.' : 'Testo locale non disponibile. Apri il documento per la revisione manuale o riprova con “Estrai testo”.'}</p>
                            {localExtraction.status === 'review_required' && <details className={disclosure.disclosure}><summary>Dettagli estrazione</summary><p>review_required · esito non confermato</p><p>Un errore di rete o di sessione non dimostra unsupported_local_extraction.</p></details>}
                        </div>}
                    </article>
                ))}
            </section>

            {Boolean(currentAttachments?.length) || children ? (
                <section aria-labelledby={summaryTitleId} data-document-area="summary" className={disclosure.summaries}>
                    <h3 id={summaryTitleId} ref={summaryHeading} tabIndex={-1}>Sintesi documentale</h3>
                    <p className={disclosure.hint}>Scegli una fonte e genera una proposta solo dopo la conferma. Nessun aggiornamento automatico della cartella.</p>
                    {Boolean(currentAttachments?.length) && <>
                        <label className="mt-3 grid min-w-0 gap-2">
                            Documento da sintetizzare
                            <select className="min-h-11 min-w-0 max-w-full rounded-xl border bg-[color:var(--lume-surface-field)] px-3 py-2"
                                value={selectedAttachment?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)}>
                                <option value="">Scegli un documento</option>
                                {currentAttachments?.map((file, index) => <option key={file.id} value={file.id}>{isPrivacyMode ? `Documento ${index + 1}` : file.name}</option>)}
                            </select>
                        </label>
                        <p className={disclosure.hint}>Cambiare documento chiude la proposta corrente, senza cancellare l’allegato o le sintesi archiviate.</p>
                        {settingLoading ? <p role="status">Verifica impostazione di sintesi…</p> : settingError ? <div role="alert">
                            <p>Impostazione di sintesi non disponibile. Nessuna generazione consentita.</p>
                            <button type="button" className={disclosure.documentAction} data-lume-action="quiet" onClick={refreshSetting}>Riprova impostazione</button>
                        </div> : !documentSynthesisEnabled ? <div className={cn('mt-3', semanticSignalSurfaceClass(sharedKillSwitchSignal(false)))} data-testid="document-upload-synthesis-disabled-note">
                            La sintesi dei documenti è disattivata. Puoi continuare a caricare i documenti, estrarne il testo sul computer e rivederli manualmente.
                        </div> : null}
                        {selectedAttachment && documentSynthesisEnabled && <DocumentSynthesisFabricReviewCard
                            patientId={patientId}
                            key={selectedAttachment.id}
                            attachmentId={selectedAttachment.id}
                            attachmentName={selectedAttachment.name}
                            enabled={documentSynthesisEnabled && deletingId !== selectedAttachment.id}
                        />}
                    </>}
                    {children}
                </section>
            ) : null}
            {viewingFile?.data && <DocumentViewer file={viewingFile.data} fileName={viewingFile.name} onClose={() => setViewingId(null)} />}
        </div>
    );
}

export default function DocumentUpload(props: DocumentUploadProps) {
    const { isLocked, isAuthenticated, authRecoveryState, user } = useSecurity();
    if (isLocked || !isAuthenticated || authRecoveryState !== 'ready') return null;
    // No patient-scoped state, pending confirmation or file read crosses identity/lock.
    return <DocumentUploadSession key={JSON.stringify([props.patientId, user?.id])} {...props} />;
}
