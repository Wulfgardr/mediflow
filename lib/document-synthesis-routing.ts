/* @Codex */
import { normalizeDocumentInput } from './document-input-normalization';
/* @Codex */
import { routeDocumentClass } from './document-class-router';
/* @Codex */
import {
    getRememberedPdfDocumentMetadata,
    type PdfDocumentMetadata,
} from './pdf-document-metadata';

/* @Codex */
export interface DocumentSynthesisRoutingOptions {
    pdfMetadata?: PdfDocumentMetadata;
}

/* @Codex */
export function routeDocumentClassForSynthesis(
    rawMarkdown: string,
    fileName: string,
    options: DocumentSynthesisRoutingOptions = {},
) {
    const normalized = normalizeDocumentInput(rawMarkdown);
    const pdfMetadata = options.pdfMetadata
        ?? getRememberedPdfDocumentMetadata(fileName, normalized.normalizedText)
        ?? getRememberedPdfDocumentMetadata(fileName, rawMarkdown);

    return routeDocumentClass({
        fileName,
        textSample: normalized.normalizedText,
        producer: pdfMetadata?.producer,
        creator: pdfMetadata?.creator,
    });
}
