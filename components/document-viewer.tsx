'use client';

import ink from './ink-secondary.module.css';
import styles from './clinical-register.module.css';
import { X, FileText } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import DocumentPreviewCanvas from './document-viewer-canvas';
import DocumentOriginalSave from './document-original-save';
import { readDocumentPreview, releaseDocumentPreview, type DocumentPreview } from './document-viewer-preview.ts';
import { PREVIEW_LIMITS, PreviewError, previewFailure, textWindow, type PreviewFailure } from './document-viewer-policy.ts';

type DocumentFile = Blob | string;

type DocumentViewerProps = {
    fileName: string;
    onClose: () => void;
    inline?: boolean;
    closeLabel?: string;
    signal?: AbortSignal;
    draftPreview?: ReactNode;
} & ({ file: DocumentFile; pending?: never } | { file?: undefined; pending: ReactNode });

function DocumentText({ text }: { text: string }) {
    const [page, setPage] = useState(1);
    const window = textWindow(text, page);
    return <section className="absolute inset-0 flex min-h-0 flex-col">
        {window.count > 1 && <nav aria-label="Sezioni del testo" className="flex flex-wrap items-center justify-center gap-3 p-3">
            <button type="button" className="mf-btn-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Testo precedente</button>
            <span aria-live="polite">Sezione {page} di {window.count}</span>
            <button type="button" className="mf-btn-secondary" disabled={page >= window.count} onClick={() => setPage((value) => value + 1)}>Testo successivo</button>
        </nav>}
        <pre data-testid="document-preview-text" tabIndex={0} aria-label="Testo del documento"
            className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 text-sm"
            style={{ overflowWrap: 'anywhere' }}>{window.text}</pre>
    </section>;
}

type Source = { file: Blob | string; fileName: string; attempt: number };
type PreviewState = { source: Source; preview: DocumentPreview; signal: AbortSignal }
    | { source: Source; error: PreviewFailure };

function DocumentPreviewBody({ file, fileName, fitWidth }: { file: DocumentFile; fileName: string; fitWidth: boolean }) {
    const [attempt, setAttempt] = useState(0);
    const source = useMemo(() => ({ file, fileName, attempt }), [file, fileName, attempt]);
    const [state, setState] = useState<PreviewState | null>(null);
    // This gate is synchronous with render: an old canvas/text/error cannot be
    // published under the new filename while effect cleanup is still pending.
    const current = state?.source === source ? state : null;
    useEffect(() => {
        const controller = new AbortController();
        let decoded: DocumentPreview | undefined;
        const retire = (error: PreviewError) => {
            controller.abort(error);
            if (decoded) { releaseDocumentPreview(decoded); decoded = undefined; }
            setState({ source, error: previewFailure(error) });
        };
        const pagehide = () => retire(new PreviewError('cancelled'));
        const lifetime = setTimeout(() => retire(new PreviewError('expired')), PREVIEW_LIMITS.viewLifetimeMs);
        window.addEventListener('pagehide', pagehide);
        void readDocumentPreview(source.file, controller.signal).then((preview) => {
            if (controller.signal.aborted) { releaseDocumentPreview(preview); return; }
            decoded = preview;
            setState({ source, preview, signal: controller.signal });
        }).catch((error: unknown) => {
            if (!controller.signal.aborted) setState({ source, error: previewFailure(error) });
        });
        return () => {
            controller.abort();
            clearTimeout(lifetime);
            window.removeEventListener('pagehide', pagehide);
            if (decoded) releaseDocumentPreview(decoded);
        };
    }, [source]);
    if (!current) return <p role="status" data-testid="document-preview-loading" className="p-4 text-center">Caricamento anteprima…</p>;
    if ('error' in current) return <div className="p-4 text-center">
        <p role="alert" data-testid="document-preview-error" data-error-code={current.error.code}>{current.error.message}</p>
        <button type="button" className="mf-btn-secondary mt-3" onClick={() => setAttempt((value) => value + 1)}>Riprova anteprima</button>
    </div>;
    return current.preview.kind === 'text'
        ? <DocumentText text={current.preview.text} />
        : <DocumentPreviewCanvas source={current.preview} signal={current.signal} fitWidth={fitWidth} />;
}

export default function DocumentViewer({ file, fileName, onClose, inline = false, signal, closeLabel = 'Chiudi', draftPreview, pending }: DocumentViewerProps) {

    const fromDraft = Boolean(draftPreview);
    const source = useMemo(() => ({ file, fileName, signal, token: Symbol('document-view') }), [file, fileName, signal]);
    const [closedView, setClosedView] = useState<symbol | null>(null);
    const closed = closedView === source.token;
    const titleId = useId();
    const shell = useRef<HTMLDivElement>(null);
    const closeButton = useRef<HTMLButtonElement>(null);
    const close = () => { setClosedView(source.token); onClose(); };
    useEffect(() => {
        const retire = () => setClosedView(source.token);
        if (signal?.aborted) retire();
        signal?.addEventListener('abort', retire, { once: true });
        return () => signal?.removeEventListener('abort', retire);
    }, [signal, source]);
    useEffect(() => {
        if (closed || inline) return;
        const root = shell.current;
        if (!root) return;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        closeButton.current?.focus();
        const keydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); closeButton.current?.click(); }
            if (event.key !== 'Tab') return;
            const items = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), [tabindex="0"]'))
                .filter((item) => item.getClientRects().length > 0);
            const first = items[0], last = items[items.length - 1];
            if (!first || !last) { event.preventDefault(); return; }
            if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
                event.preventDefault(); first.focus();
            }
        };
        document.addEventListener('keydown', keydown);
        return () => {
            document.removeEventListener('keydown', keydown);
            if (!fromDraft && previous?.isConnected) previous.focus();
        };
    }, [closed, inline, fromDraft]);
    if (closed) return null;

    const save = file ? <DocumentOriginalSave file={file} fileName={fileName} signal={signal} /> : null;
    const viewer = <div ref={shell} role={inline ? 'region' : 'dialog'} aria-modal={inline ? undefined : true} aria-labelledby={titleId} data-testid="document-viewer"
        onKeyDown={event => { if (fromDraft && event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } }}
        className={inline ? styles.inlineViewer : `${ink.surface} ${ink.viewer} mf-modal-shell lume-overlay-shadow relative w-full h-full flex flex-col overflow-hidden ${fromDraft ? styles.draftViewer : 'max-w-6xl'}`}>
        <header className={inline ? undefined : fromDraft ? styles.draftViewerHeader : 'flex items-center justify-between gap-3 p-4 graphite-divider'}>
            <div className="flex min-w-0 items-center gap-3"><FileText size={18} aria-hidden /><h3 id={titleId}>{fileName}</h3></div>
            {fromDraft ? save : null}
            <button ref={closeButton} type="button" onClick={close} className={styles.control} aria-label={closeLabel} title={closeLabel}>{closeLabel === 'Chiudi' ? <X size={18} aria-hidden /> : closeLabel}</button>
        </header>
        {fromDraft ? null : save}
        <div className={inline ? `${styles.inlineCanvas} relative` : 'min-h-0 flex-1 relative'} style={{ background: 'var(--lume-surface-field)' }}>
            {file ? <DocumentPreviewBody file={file} fileName={fileName} fitWidth={fromDraft} /> : pending}
        </div>
        {fromDraft ? <footer aria-label="Bozza" className={styles.draftStrip}>
            {draftPreview}
            <button type="button" className={styles.control} onClick={close}>Riprendi la bozza</button>
        </footer> : null}
    </div>;
    if (inline) return viewer;
    const modal = <div className={`mf-modal-backdrop ${fromDraft ? styles.draftBackdrop : 'p-4 md:p-8'}`} style={{ zIndex: 100 }}>
        <button type="button" tabIndex={fromDraft ? -1 : undefined} aria-label="Chiudi sfondo" className="absolute inset-0 cursor-default" onClick={close} />
        {viewer}
    </div>;
    return fromDraft ? createPortal(modal, document.body) : modal;
}
