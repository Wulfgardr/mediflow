'use client';

import { formatCountLabel } from '@/lib/format-count';
import { PatientSheetMenu } from '@/components/patient-sheet-menu';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/disclosure';
import styles from './clinical-register.module.css';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Eye, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import DocumentSynthesisFabricReviewCard from '@/components/document-synthesis-fabric-review-card';
import { ChoiceField } from '@/components/choice-field';
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
import { db, captureAttachmentWritePrecondition, type Attachment } from '@/lib/db';
import { requestAnyDocDecryptedLocalExtractionPreview, type AnyDocLocalExtractionPreview } from '@/lib/domain/documents/anydoc-local-extraction-client';
import { createDocumentUploadQueue, readDocumentDataUrl, type DocumentUploadResult } from '@/lib/domain/documents/document-upload-queue';
import { useLiveQueryState } from '@/lib/live-query';
import { isEncryptedFieldValue, isLockedDataPlaceholder } from '@/lib/locked-field-guard';
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

type OriginalResult = Readonly<{ metadata: Attachment; signal: AbortSignal }> &
    (Readonly<{ file: Attachment }> | Readonly<{ error: string; refreshList?: boolean }>);

function DocumentOriginal({ patientId, attachment, onClose, onRefreshList }: {
    patientId: string; attachment: Attachment; onClose: () => void; onRefreshList: () => void;
}) {
    const [result, setResult] = useState<OriginalResult | null>(null);
    const [attempt, setAttempt] = useState(0);
    const sessionSignal = db.getSessionReadSignal();
    useEffect(() => {
        const controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, sessionSignal]);
        const clear = () => setResult(null);
        const retire = () => controller.abort();
        signal.addEventListener('abort', clear, { once: true });
        window.addEventListener('pagehide', retire);
        const fail = (error: string, refreshList = false) => setResult({ metadata: attachment, signal, error, refreshList });
        void (async () => {
            try {
                const { expected } = captureAttachmentWritePrecondition(attachment);
                if (attachment.patientId !== patientId) throw new Error('Attachment unavailable');
                const file = await db.attachments.get(attachment.id, { signal });
                if (signal.aborted) return;
                if (!file) { fail('Originale non disponibile. Rileggi l’elenco prima di riprovare.', true); return; }
                if (file.id !== attachment.id || file.patientId !== patientId
                    || file.currentness?.sourceRef !== expected.sourceRef
                    || file.currentness.revision !== expected.revision
                    || file.currentness.freshnessEpoch !== expected.freshnessEpoch) {
                    fail('Il documento è cambiato. Rileggi l’elenco prima di aprirlo.', true); return;
                }
                if (isLockedDataPlaceholder(file.data) || isEncryptedFieldValue(file.data)) {
                    fail('Originale non leggibile con la chiave di questa sessione.'); return;
                }
                if (!file.data) { fail('Contenuto originale non disponibile. Puoi riprovare o rileggere l’elenco.', true); return; }
                setResult({ metadata: attachment, signal, file });
            } catch {
                if (!signal.aborted) fail('Impossibile caricare l’originale. Riprova.');
            }
        })();
        return () => {
            window.removeEventListener('pagehide', retire);
            signal.removeEventListener('abort', clear);
            controller.abort();
        };
    }, [attachment, patientId, sessionSignal, attempt]);
    // Hide the previous source during render, before the effect retires its request.
    // A list refresh unmounts this view; it never promotes old bytes to new metadata.
    const current = result?.metadata === attachment && !result.signal.aborted ? result : null;
    if (current && 'file' in current)
        return <DocumentViewer inline file={current.file.data!} fileName={current.file.name} onClose={onClose} />;
    return <>
        <p role={current ? 'alert' : 'status'} className={styles.empty}>{current?.error ?? 'Caricamento originale…'}</p>
        {current && <button type="button" className={disclosure.documentAction} data-lume-action="quiet"
            onClick={() => { setResult(null); setAttempt(value => value + 1); }}>Riprova originale</button>}
        {current?.refreshList && <button type="button" className={disclosure.documentAction} data-lume-action="quiet"
            onClick={onRefreshList}>Rileggi elenco</button>}
        <button type="button" className={disclosure.documentAction} data-lume-action="quiet" onClick={onClose}>Chiudi</button>
    </>;
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
        () => db.attachments.query({ patientId, metadataOnly: true }).toArray(),
        [patientId], undefined, ['attachments'],
    );
    const { data: killSwitch, error: settingError, loading: settingLoading, refresh: refreshSetting } = useLiveQueryState(
        () => db.settings.get(AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY, { signal: db.getSessionReadSignal() }),
        [], undefined, ['settings'],
    );
    const documentSynthesisEnabled = !settingLoading && !settingError && isAiDocumentSynthesisEnabledValue(killSwitch?.value);
    // A failed refresh does not turn the previous list into a new empty result.
    // Old source actions/publications are withheld until a successful reread.
    const currentAttachments = listError ? undefined : attachments;
    const selectedAttachment = currentAttachments?.find((file) => file.id === selectedId);
    const viewingFile = currentAttachments?.find((file) => file.id === viewingId);
    const selectSource = (id: string) => { setSelectedId(id); setViewingId(id || null); };

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
            const attachmentPrecondition = captureAttachmentWritePrecondition(file);
            const { confirmed } = await confirm({
                title: 'Eliminare questo documento?',
                message: 'Il documento verrà rimosso dagli allegati del paziente.',
                confirmLabel: 'Elimina', tone: 'danger',
            });
            if (!confirmed || activeDelete.current !== operation) return;
            await db.attachments.delete(file.id, { attachmentPrecondition });
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
        // extraction lifecycle stays bound to its observed list snapshot.
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
        <div className={`${styles.register} ${styles.documentLayout}`} data-testid="patient-documents">
            <div className={styles.documentRail}>
            <section aria-label="Caricamento documenti" data-document-area="upload">
                {currentAttachments?.length === 0 && !listLoading ? (
                    <p className={disclosure.empty}>Nessun documento caricato. Aggiungi un file per consultarlo e, separatamente, richiedere una sintesi.</p>
                ) : null}
                <div
                    {...getRootProps({ role: 'button', 'aria-label': 'Carica documenti', 'aria-describedby': uploadHintId,
                        'aria-disabled': isProcessing, 'aria-busy': isProcessing })}
                    className={cn(styles.upload, isDragActive && styles.selected)}
                >
                    <input {...getInputProps({ 'aria-hidden': true, tabIndex: -1 })} />
                    <div className={disclosure.uploadIcon} aria-hidden="true">
                        {isProcessing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
                    </div>
                    <p className="text-sm font-medium">Carica documenti</p>
                    <p id={uploadHintId} className={styles.uploadHint}>Scegli o trascina fino a 10 file, 25 MB ciascuno. Il caricamento salva gli allegati, senza avviare estrazione o sintesi.</p>
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
                            {uploadResult.interrupted ? ` Coda interrotta: ${formatCountLabel(uploadResult.notStarted, 'file non inviato', 'file non inviati')}.` : ''}</p>
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
                <table className={`${styles.table} ${styles.documentTable}`}><thead><tr><th>Documento</th><th>Azioni</th></tr></thead>
                {currentAttachments?.map(file => <tbody key={file.id} data-document-id={file.id}>
                    <tr className={viewingId === file.id ? styles.selected : undefined}><td>
                                <h4 className={styles.documentName}><PrivacyBlur>{file.name}</PrivacyBlur></h4>
                                <p className={disclosure.hint}>Caricato il {new Date(file.createdAt).toLocaleDateString('it-IT')} · {Math.max(1, Math.ceil(file.size / 1024))} KB</p>
                                <p className={disclosure.hint} data-testid="document-source-status">
                                    {extractingId === file.id ? 'Estrazione in corso' : localExtraction?.attachmentId === file.id
                                        ? localExtraction.status === 'available' ? 'Testo disponibile · da rivedere' : 'Revisione manuale necessaria'
                                        : 'Allegato salvato · testo non verificato in questa sessione'}
                                </p>

                    </td><td>
                            <div className={styles.documentActions}>
                                <button type="button" onClick={() => selectSource(file.id)} disabled={listLoading || deletingId === file.id}
                                    className={disclosure.documentAction} data-lume-action="quiet" title="Visualizza" aria-label={`Visualizza ${file.name}`}>
                                    <Eye className="h-4 w-4" aria-hidden="true" />Apri
                                </button>
                                <PatientSheetMenu label={`Azioni documento ${file.name}`} trigger={props =>
                                    <Button {...props} variant="text" aria-label={`Altro per ${file.name}`}>Altro</Button>}>
                                    <button type="button" role="menuitem" tabIndex={-1} onClick={() => handleLocalExtractionPreview(file)} disabled={extractingId !== null || deletingId === file.id}
                                        className="mf-popover-row" aria-label={`Estrai testo localmente da ${file.name}`}>
                                        <RefreshCw className={cn('h-4 w-4', extractingId === file.id && 'animate-spin')} aria-hidden="true" />Estrai testo
                                    </button>
                                    <button type="button" role="menuitem" tabIndex={-1} className="mf-popover-row" disabled={deletingId === file.id}
                                        aria-label={`Prepara sintesi di ${file.name}`} onClick={() => { selectSource(file.id); summaryHeading.current?.focus(); }}>Prepara sintesi</button>
                                    <div role="separator" className="my-3 border-t border-[color:var(--lume-rule)]" />
                                    <button type="button" role="menuitem" tabIndex={-1} onClick={() => handleDelete(file)} disabled={deletingId !== null}
                                        className="mf-popover-row mf-button-destructive" aria-label={`Elimina ${file.name}`}>
                                        <Trash2 className="h-4 w-4" aria-hidden="true" />{deletingId === file.id ? 'Eliminazione…' : 'Elimina'}
                                    </button>
                                </PatientSheetMenu>
                            </div>

                    </td></tr>
                    {(deleteErrorId === file.id || extractingId === file.id || localExtraction?.attachmentId === file.id) && <tr><td colSpan={2}>
                        {deleteErrorId === file.id && <div className="mt-3" role="alert">
                            <p>Eliminazione non confermata. Rileggi l’elenco prima di riprovare.</p>
                            <button type="button" className={disclosure.documentAction} data-lume-action="quiet" onClick={refreshAttachments} disabled={listLoading}>Rileggi elenco</button>
                        </div>}
                        {extractingId === file.id && <div className="mt-3 flex flex-wrap items-center gap-3" role="status">
                            <span>Estrazione locale in corso.</span>
                            <button type="button" onClick={interruptLocalExtraction} className={disclosure.documentAction} data-lume-action="quiet">Interrompi attesa</button>
                        </div>}
                        {localExtraction?.attachmentId === file.id && localExtraction.status === 'available' && (
                            <Disclosure className={disclosure.disclosure} data-testid="anydoc-local-extraction-preview" title={<>{localExtraction.ocr ? 'Testo OCR locale · da rivedere' : 'Testo estratto localmente · da rivedere'}</>}>
                                {localExtraction.ocr && <p className={disclosure.hint}>OCR: {formatCountLabel(localExtraction.ocr.ocrPageCount, 'pagina', 'pagine')} su {localExtraction.ocr.pageCount}. Rivedi il testo prima di usarlo.</p>}
                                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-sm"><PrivacyBlur>{localExtraction.markdown}</PrivacyBlur></pre>
                            </Disclosure>
                        )}
                        {localExtraction?.attachmentId === file.id && localExtraction.status !== 'available' && <div className="mt-3" role="status">
                            <p>{localExtraction.status === 'interrupted' ? 'Attesa interrotta. Puoi riprovare con “Estrai testo”.' : 'Testo locale non disponibile. Apri il documento per la revisione manuale o riprova con “Estrai testo”.'}</p>
                            {localExtraction.status === 'review_required' && <Disclosure className={disclosure.disclosure} title="Dettagli estrazione"><p>Estrazione da rivedere · esito non confermato.</p><p>Un errore di rete o di sessione non indica necessariamente che l’estrazione locale non sia supportata.</p></Disclosure>}
                        </div>}

                    </td></tr>}
                </tbody>)}
                </table>
            </section>

            {Boolean(currentAttachments?.length) || Boolean(selectedId && currentAttachments) ? (
                <section aria-labelledby={summaryTitleId} data-document-area="summary" className={disclosure.summaries}>
                    <h3 id={summaryTitleId} ref={summaryHeading} tabIndex={-1}>Nuova sintesi</h3>
                    <p className={disclosure.hint}>Scegli una fonte e genera una proposta solo dopo la conferma. Nessun aggiornamento automatico della cartella.</p>
                    <div className={styles.sourceChoice}>
                        <ChoiceField label="Documento da sintetizzare" value={selectedAttachment?.id ?? ''}
                            onChange={(event) => selectSource(event.target.value)}
                            description="Cambiare documento chiude la proposta corrente, senza cancellare l’allegato o le sintesi archiviate.">
                                <option value="">Scegli un documento</option>
                                {currentAttachments?.map((file, index) => <option key={file.id} value={file.id}>{isPrivacyMode ? `Documento ${index + 1}` : file.name}</option>)}
                        </ChoiceField>
                        {!selectedAttachment && <p role="status" className={disclosure.hint}>{listLoading ? 'Rilettura della fonte selezionata…' : selectedId
                            ? 'La fonte selezionata non è più disponibile nell’elenco. Rileggi l’elenco o scegli un altro documento.'
                            : 'Scegli un documento per preparare una nuova sintesi.'}</p>}
                        {selectedId && !selectedAttachment && <button type="button" className={disclosure.documentAction}
                            data-lume-action="quiet" onClick={refreshAttachments} disabled={listLoading}>Rileggi elenco</button>}
                    </div>
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
                </section>
            ) : null}
            {children ? <section data-document-area="archive" aria-label="Archivio delle sintesi" className={styles.documentArchive}>
                {children}
            </section> : null}
            </div>
            <aside className={styles.documentOriginal} aria-label="Originale del documento">
                <h3>Originale</h3>
                {viewingFile && !listLoading ? <DocumentOriginal key={viewingFile.id} patientId={patientId} attachment={viewingFile}
                    onClose={() => setViewingId(null)} onRefreshList={refreshAttachments} />
                    : <p className={styles.empty}>{viewingId && listLoading ? 'Rilettura elenco documenti…'
                        : viewingId && listError ? 'Rileggi l’elenco documenti per consultare l’originale.'
                            : 'Apri un documento dall’elenco per consultare l’originale accanto alle proposte.'}</p>}
            </aside>
        </div>
    );
}

export default function DocumentUpload(props: DocumentUploadProps) {
    const { isLocked, isAuthenticated, authRecoveryState, user } = useSecurity();
    if (isLocked || !isAuthenticated || authRecoveryState !== 'ready') return null;
    // No patient-scoped state, pending confirmation or file read crosses identity/lock.
    return <DocumentUploadSession key={JSON.stringify([props.patientId, user?.id])} {...props} />;
}
