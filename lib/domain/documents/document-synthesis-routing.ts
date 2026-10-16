import { normalizeDocumentInput } from './document-input-normalization';
import { routeDocumentClass } from './document-class-router';
import {
    getRememberedPdfDocumentMetadata,
    type PdfDocumentMetadata,
} from '../../pdf-document-metadata';

export interface DocumentSynthesisRoutingOptions {
    pdfMetadata?: PdfDocumentMetadata;
}

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
