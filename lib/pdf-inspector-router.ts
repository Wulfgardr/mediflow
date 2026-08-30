/* @Codex */

export type PdfInspectionFailureReason =
    | 'password_protected'
    | 'corrupted_pdf'
    | 'parser_failed'
    | 'resource_limit';

export class PdfInspectionError extends Error {
    readonly reason: PdfInspectionFailureReason;

    constructor(reason: PdfInspectionFailureReason) {
        super('PDF inspection unavailable');
        this.name = 'PdfInspectionError';
        this.reason = reason;
    }
}

export interface PdfInspection {
    text: string;
    pageCount: number;
    pagesNeedingOcr: number[];
    state: 'native' | 'mixed' | 'ocr_required';
    pages: Array<{ page: number; text: string; needsOcr: boolean }>;
}

interface WorkerPage {
    pageIndex: number;
    markdown: string;
    needsOcr: boolean;
}

export function normalizePdfInspection(pages: WorkerPage[]): PdfInspection {
    if (
        pages.length === 0
        || pages.some((page, index) => (
            page.pageIndex !== index
            || typeof page.markdown !== 'string'
            || typeof page.needsOcr !== 'boolean'
        ))
    ) {
        throw new PdfInspectionError('parser_failed');
    }
    if (pages.length > 500) {
        throw new PdfInspectionError('resource_limit');
    }

    const pagesNeedingOcr = pages
        .filter((page) => page.needsOcr)
        .map((page) => page.pageIndex + 1);
    const text = pages
        .filter((page) => !page.needsOcr && page.markdown.trim())
        .map((page) => page.markdown.trim())
        .join('\n\n');
    const state = pagesNeedingOcr.length === 0
        ? 'native'
        : pagesNeedingOcr.length === pages.length
            ? 'ocr_required'
            : 'mixed';

    return {
        text,
        pageCount: pages.length,
        pagesNeedingOcr,
        state,
        pages: pages.map((page) => ({
            page: page.pageIndex + 1,
            text: page.needsOcr ? '' : page.markdown.trim(),
            needsOcr: page.needsOcr,
        })),
    };
}
