import 'server-only';
import { createHash } from 'node:crypto';

import { continueAnyDocImageOrScanWithLocalOcr } from './anydoc-apple-vision-ocr-composition';
import { extractAnyDocLocalBytes } from './anydoc-local-extraction-runner';
import { readAttachmentExtractionProjectionBytes } from './attachment-extraction-projection-transport';
import type { DossierHostExtraction } from './dossier-import';

/**
 * Estrazione dossier in sola lettura (ADR 0175). I byte arrivano dal client Web
 * autenticato su loopback, come nella proiezione degli allegati; l'host esegue
 * AnyDoc e, per le pagine immagine, l'OCR locale esistente. Nessuna scrittura,
 * nessun log del contenuto, nessuna persistenza dei byte oltre la richiesta.
 */
let active = false;

export type DossierExtractionHostOutcome = { status: 'busy' } | { status: 'unreadable' } | DossierHostExtraction;

export async function extractDossierSource(request: Request): Promise<DossierExtractionHostOutcome> {
    if (active) return { status: 'busy' };
    active = true;
    let bytes: Uint8Array | null = null;
    try {
        const signal = request.signal;
        bytes = await readAttachmentExtractionProjectionBytes(request, { signal, current: () => !signal.aborted });
        if (!bytes || signal.aborted) return { status: 'unreadable' };
        // Identità tecnica della sola chiamata: digest dei byte, mai nome o percorso.
        const id = `dossier-${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}`;
        let result = await extractAnyDocLocalBytes(id, bytes);
        if (signal.aborted) return { status: 'unreadable' };
        if (result.status === 'review_required' && result.detail === 'image_or_scan') {
            result = await continueAnyDocImageOrScanWithLocalOcr(id, bytes, result);
            if (signal.aborted) return { status: 'unreadable' };
        }
        if (result.status === 'denied') return { status: 'failed', detail: 'unavailable' };
        if (result.status === 'extracted') {
            const ocr = result.receipt.ocrProvenance;
            return { status: 'extracted', markdown: result.markdown,
                ocr: ocr ? { pageCount: ocr.pageCount, ocrPageCount: ocr.ocrPageCount } : null };
        }
        return { status: 'failed', detail: result.detail };
    } catch {
        return { status: 'failed', detail: 'unavailable' };
    } finally {
        bytes?.fill(0);
        active = false;
    }
}
