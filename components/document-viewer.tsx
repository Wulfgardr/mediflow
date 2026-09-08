'use client';

import { X, FileText } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import DocumentPreviewCanvas from './document-viewer-canvas';
import { readDocumentPreview, releaseDocumentPreview, type DocumentPreview } from './document-viewer-preview.ts';
import { PREVIEW_LIMITS, PreviewError, previewFailure, textWindow, type PreviewFailure } from './document-viewer-policy.ts';

interface DocumentViewerProps {
    file: Blob | string;
    fileName: string;
    onClose: () => void;
}

/* @Codex */
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

/* @Codex */
function DocumentPreviewBody({ file, fileName }: Pick<DocumentViewerProps, 'file' | 'fileName'>) {
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
        : <DocumentPreviewCanvas source={current.preview} signal={current.signal} />;
}

export default function DocumentViewer({ file, fileName, onClose }: DocumentViewerProps) {
    /* @Codex */
    const [closed, setClosed] = useState(false);
    const titleId = useId();
    const shell = useRef<HTMLDivElement>(null);
    const closeButton = useRef<HTMLButtonElement>(null);
    const close = () => { setClosed(true); onClose(); };
    useEffect(() => {
        if (closed) return;
        const root = shell.current;
        if (!root) return;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        closeButton.current?.focus();
        const keydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeButton.current?.click(); }
            if (event.key !== 'Tab') return;
            const items = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]'))
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
            if (previous?.isConnected) previous.focus();
        };
    }, [closed]);
    if (closed) return null;

    return (
        // @Codex WUL-229: full-screen document viewer reuses specular chrome + vitreous canvas
        <div className="mf-modal-backdrop p-4 md:p-8 animate-in fade-in duration-[var(--lume-dur-riga)]" style={{ zIndex: 100 }}>
            <button type="button" aria-label="Chiudi sfondo" className="absolute inset-0 cursor-default" onClick={close} />
            <div ref={shell} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="document-viewer"
                className="mf-modal-shell lume-overlay-shadow relative w-full h-full max-w-6xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-[var(--lume-dur-fuoco)]">
                <div className="flex items-center justify-between gap-3 p-4 graphite-divider">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="p-2 rounded-xl flex items-center justify-center"
                            style={{ background: 'color-mix(in srgb, var(--lume-accent) 12%, var(--lume-surface-field))', color: 'var(--lume-accent)' }}>
                            <FileText className="w-5 h-5" />
                        </div>
                        <h3 id={titleId} className="font-semibold text-sm md:text-base truncate" style={{ color: 'var(--lume-ink)' }}>{fileName}</h3>
                    </div>
                    <button ref={closeButton} type="button" onClick={close} className="mf-btn-secondary !p-2 !rounded-full" aria-label="Chiudi" title="Chiudi">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="min-h-0 flex-1 relative" style={{ background: 'var(--lume-surface-field)' }}>
                    <DocumentPreviewBody file={file} fileName={fileName} />
                </div>
            </div>
        </div>
    );
}
