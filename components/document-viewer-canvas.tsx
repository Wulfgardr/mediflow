'use client';
/* @Codex — source/job identity gates all publications, including successful late jobs. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { clearPreviewCanvas, PreviewError, previewFailure, type PreviewFailure } from './document-viewer-policy.ts';
import type { DocumentPreview } from './document-viewer-preview.ts';
import { renderPdfPreview } from './document-viewer-pdf';
import { renderRasterPreview } from './document-viewer-raster.ts';

type CanvasPreview = Exclude<DocumentPreview, { kind: 'text' }>;
type Job = { source: CanvasPreview; page: number; attempt: number };
type Snapshot = { job: Job; state: 'ready' } | { job: Job; state: 'error'; error: PreviewFailure };

type CanvasProps = { source: CanvasPreview; signal: AbortSignal };

export default function DocumentPreviewCanvas({ source, signal }: CanvasProps) {
    const [owner, setOwner] = useState(() => ({ source, signal, revision: 0 }));
    if (owner.source !== source || owner.signal !== signal) {
        // A new source owns page 1, retry state, canvas and jobs together. Reset
        // before commit, not in a passive effect that could first request page 2
        // of a one-page replacement. Never key by filename or document bytes.
        setOwner({ source, signal, revision: owner.revision + 1 });
        return null;
    }
    return <OwnedDocumentPreviewCanvas key={owner.revision} source={source} signal={signal} />;
}

function OwnedDocumentPreviewCanvas({ source, signal }: CanvasProps) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const active = useRef<AbortController | null>(null);
    const [page, setPage] = useState(1);
    const [attempt, setAttempt] = useState(0);
    const job = useMemo(() => ({ source, page, attempt }), [source, page, attempt]);
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [pageCount, setPageCount] = useState<{ source: CanvasPreview; count: number } | null>(null);
    const current = snapshot?.job === job ? snapshot : null;
    const status = current?.state ?? 'loading';
    const count = pageCount?.source === source ? pageCount.count : undefined;
    const isPdf = source.kind === 'pdf';

    useEffect(() => {
        const target = canvas.current;
        if (!target) return;
        const controller = new AbortController();
        const abort = () => controller.abort(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        active.current = controller;
        clearPreviewCanvas(target);
        const work = source.kind === 'pdf'
            ? renderPdfPreview(source.bytes, page, target, controller.signal)
            : renderRasterPreview(source, target, controller.signal).then(() => ({ pages: 1 }));
        void work.then((result) => {
            if (controller.signal.aborted) return;
            setPageCount({ source, count: result.pages });
            setSnapshot({ job, state: 'ready' });
        }).catch((error: unknown) => {
            if (!controller.signal.aborted) setSnapshot({ job, state: 'error', error: previewFailure(error, isPdf ? 'invalid_pdf' : 'invalid_image') });
        });
        return () => {
            controller.abort();
            signal.removeEventListener('abort', abort);
            if (active.current === controller) active.current = null;
            clearPreviewCanvas(target);
        };
    }, [source, page, job, signal, isPdf]);

    const cancel = () => {
        active.current?.abort();
        if (canvas.current) clearPreviewCanvas(canvas.current);
        setSnapshot({ job, state: 'error', error: previewFailure(new PreviewError('cancelled')) });
    };
    return (
        <section data-testid={isPdf ? 'document-preview-pdf' : 'document-preview-image'} data-state={status}
            className="absolute inset-0 flex min-h-0 flex-col" aria-busy={status === 'loading'}>
            {isPdf && <nav aria-label="Pagine PDF" className="flex flex-wrap items-center justify-center gap-3 p-3">
                <button type="button" className="mf-btn-secondary" disabled={status !== 'ready' || page <= 1}
                    onClick={() => setPage((value) => value - 1)}>Pagina precedente</button>
                <span aria-live="polite" data-testid="document-preview-page-number">Pagina {page} di {count ?? '…'}</span>
                <button type="button" className="mf-btn-secondary" disabled={status !== 'ready' || !count || page >= count}
                    onClick={() => setPage((value) => value + 1)}>Pagina successiva</button>
            </nav>}
            {status === 'loading' && <div className="p-3 text-center">
                <p role="status" data-testid="document-preview-loading">{isPdf ? 'Caricamento pagina PDF…' : 'Caricamento immagine…'}</p>
                <button type="button" className="mf-btn-secondary mt-2" onClick={cancel}>Interrompi anteprima</button>
            </div>}
            {current?.state === 'error' && <div className="p-4 text-center">
                <p role="alert" data-testid="document-preview-error" data-error-code={current.error.code}>{current.error.message}</p>
                <button type="button" className="mf-btn-secondary mt-3" onClick={() => setAttempt((value) => value + 1)}>Riprova anteprima</button>
            </div>}
            <div className="min-h-0 flex-1 overflow-auto p-2" tabIndex={0} aria-label={isPdf ? 'Pagina PDF' : 'Immagine locale'}>
                <canvas ref={canvas} data-testid={isPdf ? 'document-preview-pdf-page' : 'document-preview-image-canvas'}
                    role="img" aria-label={isPdf ? `Anteprima grafica, pagina ${page}` : 'Anteprima grafica dell’immagine'}
                    style={{ display: status === 'ready' ? 'block' : 'none', maxWidth: '100%', height: 'auto', margin: 'auto' }} />
            </div>
            {isPdf && <p className="px-3 py-2 text-xs" style={{ color: 'var(--lume-ink-muted)' }}>
                Anteprima grafica locale, senza moduli o collegamenti attivi. I caratteri possono differire dall’originale.
            </p>}
        </section>
    );
}
