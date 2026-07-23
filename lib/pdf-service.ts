import type { DocumentDiagnosisSuggestion, DocumentQualityLevel } from './db';
import type {
    SmartImportConfidence,
    SmartImportDiagnosisExtraction,
    SmartImportServicePrescriptionExtraction,
    SmartImportTherapyExtraction,
    TherapySuggestionState,
} from './ai-task-contracts';
/* @Codex */
import { normalizeDocumentInput } from './domain/documents/document-input-normalization';
import {
    looksLikeLowSignalOcrText,
} from './domain/documents/document-ocr-queue';
/* @Codex */
import {
    normalizePdfDocumentMetadata,
    rememberPdfDocumentMetadata,
    type PdfDocumentMetadata,
} from './pdf-document-metadata';

// Client-side text parsing only - Extraction happens on server via API

export interface ExtractedPatientData {
    firstName?: string;
    lastName?: string;
    taxCode?: string;
    birthDate?: Date;
    address?: string;
    phone?: string;
    diagnosis?: string;
    medications?: string[];
    notes?: string;
    diagnoses?: DocumentDiagnosisSuggestion[];
    problemStatements?: SmartImportDiagnosisExtraction[];
    therapyCandidates?: SmartImportTherapyExtraction[];
    servicePrescriptions?: SmartImportServicePrescriptionExtraction[];
    reviewDiagnoses?: ExtractedPatientReviewDiagnosis[];
    reviewTherapies?: ExtractedPatientReviewTherapy[];
    documentSummary?: string;
    documentQuality?: {
        level: DocumentQualityLevel;
        reason?: string;
    };
    rawText: string;
    source: 'ai' | 'regex' | 'hybrid';  // Track extraction method
    confidence: number;  // 0-1 confidence score
}

export interface ExtractedPatientReviewDiagnosis {
    label: string;
    code: string;
    description: string;
    system: 'ICD-9' | 'ICD-10' | 'ICD-11';
    evidence?: string;
    confidence?: SmartImportConfidence;
    blockedReason?: string;
    sourceType?: 'explicit_document_code' | 'reviewable_local_match';
}

export interface ExtractedPatientReviewTherapy {
    drugName: string;
    dosage?: string;
    activePrinciple?: string;
    motivation?: string;
    aic?: string;
    atc?: string;
    confidence?: SmartImportConfidence;
    therapyState: TherapySuggestionState;
    matchType: 'catalog' | 'manual' | 'none';
    evidence?: string;
    blockedReason?: string;
    sourceType?: 'document_explicit' | 'reviewable_local_match';
}

function isOcrFailureNote(value: string): boolean {
    return /^OCR extraction failed:/i.test(value.trim());
}

function looksLikeStructuredPayload(value: string): boolean {
    const trimmed = value.trim();
    return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('```');
}

export type PdfTextLayerFailureReason =
    | 'corrupted_pdf'
    | 'password_protected'
    | 'parser_failed'
    | 'resource_limit';

export class PdfTextLayerUnreadableError extends Error {
    readonly reason: PdfTextLayerFailureReason;

    constructor(message: string, reason: PdfTextLayerFailureReason) {
        super(message);
        this.name = 'PdfTextLayerUnreadableError';
        this.reason = reason;
    }
}

export class DocumentTextUnavailableError extends Error {
    readonly textLayerFailure?: PdfTextLayerFailureReason;

    constructor(message: string, textLayerFailure?: PdfTextLayerFailureReason) {
        super(message);
        this.name = 'DocumentTextUnavailableError';
        this.textLayerFailure = textLayerFailure;
    }
}

/* @Codex */
function inspectionFailure(error: unknown): DocumentTextUnavailableError {
    if (error instanceof DocumentTextUnavailableError) return error;
    if (error instanceof PdfTextLayerUnreadableError) {
        return new DocumentTextUnavailableError(error.message, error.reason);
    }
    return new DocumentTextUnavailableError('Ispezione PDF locale non disponibile.', 'parser_failed');
}

/* @Codex */
export interface PdfTextLayerResult {
    text: string;
    state: 'native' | 'mixed' | 'ocr_required';
    pageCount: number;
    pagesNeedingOcr: number[];
    pages: Array<{ page: number; text: string; needsOcr: boolean }>;
}

/* @Codex */
export function extractUsableOcrText(data: { rawMarkdown?: unknown; notes?: unknown } | null | undefined): string {
    const rawMarkdown = typeof data?.rawMarkdown === 'string' ? data.rawMarkdown.trim() : '';
    if (rawMarkdown && !looksLikeStructuredPayload(rawMarkdown) && !looksLikeLowSignalOcrText(rawMarkdown)) {
        return normalizeDocumentInput(rawMarkdown).normalizedText;
    }

    const notes = typeof data?.notes === 'string' ? data.notes.trim() : '';
    if (notes && !isOcrFailureNote(notes) && !looksLikeLowSignalOcrText(notes)) {
        return normalizeDocumentInput(notes).normalizedText;
    }

    return '';
}

/* @Codex */
const OCR_PAGE_LIMIT = 6;
/* @Codex */
type RenderedPdfForOcr = {
    images: string[];
    pageNumbers: number[];
    metadata?: PdfDocumentMetadata;
};
/* @Codex */
const IMAGE_EXTENSION_REGEX = /\.(apng|avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i;
/* @Codex */
const PERSON_PLACEHOLDER_TOKENS = new Set([
    'NOME',
    'COGNOME',
    'COGNOME E NOME',
    'NOME E COGNOME',
    'PAZIENTE',
    'ASSISTITO',
    'SIG',
    'SIG.',
    'SIGRA',
    'SIG.RA'
]);

/* @Codex */
export function isPdfDocumentInput(file: Pick<File, 'name' | 'type'>): boolean {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
}

/* @Codex */
export function isImageDocumentInput(file: Pick<File, 'name' | 'type'>): boolean {
    return file.type.startsWith('image/') || IMAGE_EXTENSION_REGEX.test(file.name || '');
}

/* @Codex */
function sanitizePersonValue(value: string | undefined): string | undefined {
    if (!value) return undefined;

    const normalized = value
        .replace(/\s+/g, ' ')
        .replace(/^[\s:;.,-]+|[\s:;.,-]+$/g, '')
        .trim();

    if (!normalized || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(normalized)) {
        return undefined;
    }

    const upper = normalized.toUpperCase();
    if (PERSON_PLACEHOLDER_TOKENS.has(upper)) {
        return undefined;
    }

    const tokens = upper.split(/\s+/);
    if (tokens.every((token) => PERSON_PLACEHOLDER_TOKENS.has(token))) {
        return undefined;
    }

    return normalized;
}

/* @Codex */
function stripPatientIdentityTail(value: string): string {
    return value
        .replace(/\s*,?\s*(?:nat[oa]|data\s+di\s+nascita|nato\s+a)\b.*$/i, '')
        .replace(/\s*,?\s*(?:codice\s+fiscale|cf|indirizzo|telefono|cellulare|residente)\b.*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/* @Codex */
function isLikelySurnameFirstPatientValue(label: string, candidate: string): boolean {
    if (/^cognome\b.*\bnome$/i.test(label)) return true;
    if (!/^(paziente|assistito)$/i.test(label.trim())) return false;

    const parts = candidate.split(/\s+/).filter(Boolean);
    if (parts.length !== 2) return false;
    return parts.every((part) => part === part.toLocaleUpperCase('it-IT') && /[A-ZÀ-Ý]{2,}/.test(part));
}

/* @Codex */
function extractPatientName(text: string): { firstName?: string; lastName?: string } {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    let firstName: string | undefined;
    let lastName: string | undefined;

    for (const line of lines) {
        const nameMatch = line.match(/^nome(?!\s*(?:e|\/|-)?\s*cognome)\s*[:.]?\s*(.+)$/i);
        if (!firstName && nameMatch) {
            firstName = sanitizePersonValue(stripPatientIdentityTail(nameMatch[1]));
            continue;
        }

        const surnameMatch = line.match(/^cognome(?!\s*(?:e|\/|-)?\s*nome)\s*[:.]?\s*(.+)$/i);
        if (!lastName && surnameMatch) {
            lastName = sanitizePersonValue(stripPatientIdentityTail(surnameMatch[1]));
            continue;
        }

        const fullNameMatch = line.match(/^(cognome\s*(?:e|\/|-)?\s*nome|nome\s*(?:e|\/|-)?\s*cognome|paziente|assistito|sig(?:\.|\.ra)?|signor(?:a)?)\s*[:.]?\s*(.+)$/i);
        if (fullNameMatch) {
            const label = fullNameMatch[1].toLowerCase();
            const candidate = sanitizePersonValue(stripPatientIdentityTail(fullNameMatch[2]));
            if (!candidate) continue;
            const parts = candidate.split(/\s+/).filter(Boolean);
            if (parts.length >= 2) {
                const surnameFirst = isLikelySurnameFirstPatientValue(label, candidate);
                const given = surnameFirst ? parts.slice(-1).join(' ') : parts.slice(0, -1).join(' ');
                const family = surnameFirst ? parts.slice(0, -1).join(' ') : parts.slice(-1).join(' ');
                firstName ||= sanitizePersonValue(given);
                lastName ||= sanitizePersonValue(family);
            }
        }
    }

    if (!firstName || !lastName) {
        const cleanText = text.replace(/\s+/g, ' ');
        const fallbackName = cleanText.match(/(?:^|\b)nome\s*[:.]?\s*([A-Za-zÀ-ÖØ-öø-ÿ' -]{2,60}?)(?=\s+(?:cognome|codice|cf|nato|nata|data|indirizzo|telefono|medico|$))/i);
        const fallbackSurname = cleanText.match(/(?:^|\b)cognome\s*[:.]?\s*([A-Za-zÀ-ÖØ-öø-ÿ' -]{2,60}?)(?=\s+(?:nome|codice|cf|nato|nata|data|indirizzo|telefono|medico|$))/i);
        firstName ||= sanitizePersonValue(fallbackName?.[1]);
        lastName ||= sanitizePersonValue(fallbackSurname?.[1]);
    }

    return { firstName, lastName };
}

/* @Codex */
function extractPatientAddress(text: string): string | undefined {
    const cleanText = text.replace(/\s+/g, ' ');
    const match = cleanText.match(/\bindirizzo\s*[:.]?\s*(.{4,140}?)(?=\s+(?:ausl|asl|medico curante|diagnosi|farmaco|posologia|codice fiscale|cf|telefono|data\b|$))/i);
    if (!match?.[1]) return undefined;

    const address = match[1]
        .replace(/^[\s:;.,-]+|[\s:;.,-]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    return /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(address) ? address : undefined;
}

/* @Codex */
function extractClinicalValueAfterLabelLine(text: string): string | undefined {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (let index = 0; index < lines.length; index += 1) {
        if (!/\bdiagnosi\b/i.test(lines[index])) continue;

        for (let cursor = index + 1; cursor < Math.min(lines.length, index + 4); cursor += 1) {
            const candidate = lines[cursor].trim();
            if (!candidate) continue;
            if (/^(?:farmaco|posologia|terapia|data|medico|firma)\b/i.test(candidate)) break;
            return candidate.replace(/\s+/g, ' ').trim();
        }
    }

    return undefined;
}

/**
 * Extract text from PDF (server-side via pdfjs)
 */
export async function extractPdfTextLayer(file: Blob): Promise<PdfTextLayerResult> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/pdf-extract', {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const failureReason = err?.textLayer?.reason;
        if (failureReason === 'corrupted_pdf' || failureReason === 'password_protected') {
            throw new PdfTextLayerUnreadableError(err.error || "Failed to extract text from PDF", failureReason);
        }
        if (failureReason === 'resource_limit') {
            throw new DocumentTextUnavailableError(
                'Il PDF supera i limiti locali di ispezione.',
                'resource_limit',
            );
        }
        if (failureReason === 'parser_failed') {
            throw new DocumentTextUnavailableError(
                'Ispezione PDF locale non disponibile.',
                'parser_failed',
            );
        }
        throw new Error(err.error || "Failed to extract text from PDF");
    }

    const data = await response.json();
    const layer = data?.textLayer;
    const pagesNeedingOcr = Array.isArray(layer?.pagesNeedingOcr)
        ? layer.pagesNeedingOcr
        : [];
    const pages = Array.isArray(layer?.pages) ? layer.pages : [];
    const validPages = pagesNeedingOcr.every((page: unknown, index: number) => (
        Number.isInteger(page)
        && Number(page) > 0
        && Number(page) <= layer?.pageCount
        && (index === 0 || Number(page) > Number(pagesNeedingOcr[index - 1]))
    ));
    const validState = layer?.state === 'native'
        ? pagesNeedingOcr.length === 0
        : layer?.state === 'ocr_required'
            ? pagesNeedingOcr.length === layer?.pageCount
            : layer?.state === 'mixed'
                ? pagesNeedingOcr.length > 0 && pagesNeedingOcr.length < layer?.pageCount
                : false;
    const validPageSet = pages.length === layer?.pageCount && pages.every((page: any, index: number) => (
        page?.page === index + 1
        && typeof page?.text === 'string'
        && typeof page?.needsOcr === 'boolean'
        && page.needsOcr === pagesNeedingOcr.includes(index + 1)
    ));
    if (
        !Number.isInteger(layer?.pageCount)
        || layer.pageCount <= 0
        || !validPages
        || !validState
        || !validPageSet
    ) {
        throw new Error('Invalid PDF inspection response');
    }
    return {
        text: typeof data.text === 'string' ? data.text : '',
        state: layer.state,
        pageCount: layer.pageCount,
        pagesNeedingOcr,
        pages,
    };
}

export async function extractTextFromPdf(file: Blob): Promise<string> {
    const layer = await extractPdfTextLayer(file);
    if (layer.state !== 'native') {
        throw new DocumentTextUnavailableError(
            'Il PDF richiede OCR selettivo prima di restituire testo completo.',
        );
    }
    return layer.text;
}

/**
 * Convert file to base64 for AI-OCR processing
 */
async function fileToBase64(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/* @Codex */
async function callOcr(imageBase64: string, mode: 'full' | 'patient' | 'labs' = 'patient') {
    const response = await fetch('/api/ocr/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageBase64, mode })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || "OCR extraction failed");
    }

    const payload = await response.json();
    return payload?.data || null;
}

/* @Codex */
async function readPdfDocumentMetadata(pdf: any): Promise<PdfDocumentMetadata | undefined> {
    try {
        if (typeof pdf?.getMetadata !== 'function') return undefined;
        const metadata = await pdf.getMetadata();
        return normalizePdfDocumentMetadata(metadata?.info);
    } catch {
        return undefined;
    }
}

/* @Codex */
async function renderPdfToImages(
    file: Blob,
    maxPages = OCR_PAGE_LIMIT,
    preferredPages?: readonly number[],
): Promise<RenderedPdfForOcr> {
    const buffer = await file.arrayBuffer();
    try {
        if (!(globalThis as any).pdfjsWorker) {
            await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
        }
    } catch {
        // Fall back to the legacy fake-worker path if the side-effect import is unavailable.
    }

    const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs');

    try {
        if (pdfjsLib?.GlobalWorkerOptions) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = "";
        }
    } catch {
        // No-op: worker disabled below
    }

    const loadingTask = pdfjsLib.getDocument({
        data: buffer,
        disableWorker: true
    });
    const pdf = await loadingTask.promise;
    const metadata = await readPdfDocumentMetadata(pdf);
    const pagesToRender = maxPages === 0
        ? []
        : preferredPages?.length
        ? Array.from(new Set(preferredPages))
            .filter((page) => Number.isInteger(page) && page >= 1 && page <= pdf.numPages)
            .slice(0, maxPages)
        : await selectPdfPagesForOcr(pdf, maxPages);

    const images: string[] = [];
    for (const pageNumber of pagesToRender) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.6 });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;

        images.push(canvas.toDataURL('image/png'));
    }

    return { images, pageNumbers: pagesToRender, metadata };
}

/* @Codex */
async function selectPdfPagesForOcr(pdf: any, maxPages: number): Promise<number[]> {
    const total = pdf.numPages || 1;
    const analysisPages = Math.min(total, Math.max(maxPages + 3, 9));
    const keywords = [
        'diagnosi', 'terapia', 'farmac', 'prescr', 'anamnesi', 'esami', 'referto',
        'dimission', 'valutazione', 'conclusioni', 'paziente', 'medico'
    ];

    const scores: { page: number; score: number }[] = [];

    for (let i = 1; i <= analysisPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const text = (textContent.items as any[]).map((item) => item.str).join(' ');
        const lower = text.toLowerCase();

        let score = text.length;
        for (const keyword of keywords) {
            if (lower.includes(keyword)) score += 500;
        }
        if (/\d{1,3}[,\.]\d+/.test(lower)) score += 200;

        scores.push({ page: i, score });
    }

    const selected = new Set<number>();
    selected.add(1);
    if (total > 1) selected.add(total);

    scores
        .sort((a, b) => b.score - a.score)
        .forEach(({ page }) => {
            if (selected.size >= maxPages) return;
            selected.add(page);
        });

    return Array.from(selected).sort((a, b) => a - b).slice(0, maxPages);
}

/* @Codex */
async function extractOcrTextByPage(rendered: RenderedPdfForOcr): Promise<Map<number, string>> {
    const chunks = new Map<number, string>();
    for (let index = 0; index < rendered.images.length; index += 1) {
        try {
            const result = await callOcr(rendered.images[index], 'full');
            const raw = result?.rawMarkdown || "";
            if (raw) chunks.set(rendered.pageNumbers[index], raw);
        } catch (e) {
            console.warn('[PDF Service] OCR full failed for page', e);
        }
    }
    return chunks;
}

/* @Codex */
export function mergePdfPageText(layer: PdfTextLayerResult, ocrByPage: Map<number, string>): string {
    if (layer.pagesNeedingOcr.some((page) => {
        const text = ocrByPage.get(page)?.trim() || '';
        return !text || looksLikeLowSignalOcrText(text);
    })) {
        throw new DocumentTextUnavailableError(
            'OCR selettivo incompleto: almeno una pagina non ha prodotto testo utile.',
        );
    }
    return layer.pages
        .map((page) => page.needsOcr ? ocrByPage.get(page.page) || '' : page.text)
        .filter((text) => text.trim())
        .join('\n\n');
}

/* @Codex */
function mapOcrToPatientData(
    data: any,
    rawText: string,
    source: 'ai' | 'hybrid' | 'regex'
): ExtractedPatientData {
    const fallbackText = rawText || extractUsableOcrText(data);
    const notes = typeof data?.notes === 'string' && !isOcrFailureNote(data.notes)
        ? data.notes.trim() || undefined
        : undefined;

    return {
        firstName: data?.firstName,
        lastName: data?.lastName,
        taxCode: data?.taxCode,
        birthDate: data?.birthDate ? new Date(data.birthDate) : undefined,
        address: data?.address,
        phone: data?.phone,
        diagnosis: data?.diagnosis,
        medications: data?.medications,
        notes: notes || (fallbackText ? fallbackText.slice(0, 500) : undefined),
        rawText: fallbackText,
        source,
        confidence: data?.confidence || 0.6
    };
}

/* @Codex */
export function buildOcrFallbackResult(
    data: any,
    source: 'ai' | 'hybrid' | 'regex',
    rawText = ''
): ExtractedPatientData | null {
    if (!data || typeof data !== 'object') return null;

    const result = mapOcrToPatientData(data, rawText, source);
    const hasMeaningfulContent = Boolean(
        result.firstName ||
        result.lastName ||
        result.taxCode ||
        result.birthDate ||
        result.address ||
        result.phone ||
        result.diagnosis ||
        result.notes ||
        result.rawText ||
        result.medications?.length
    );

    return hasMeaningfulContent ? result : null;
}

/* @Codex */
export async function extractDocumentTextForSummary(file: File): Promise<string> {
    const isPdf = isPdfDocumentInput(file);
    const isImage = isImageDocumentInput(file);

    if (!isPdf && !isImage) {
        return "";
    }

    if (isPdf) {
        let layer: PdfTextLayerResult | undefined;
        try {
            layer = await extractPdfTextLayer(file);
            if (layer.state === 'native' && layer.text.trim()) {
                const metadata = (await renderPdfToImages(file, 0)).metadata;
                rememberPdfDocumentMetadata(file.name, layer.text, metadata);
                return layer.text;
            }
        } catch (error) {
            throw inspectionFailure(error);
        }
        if (layer && layer.pagesNeedingOcr.length > OCR_PAGE_LIMIT) {
            throw new DocumentTextUnavailableError(
                'Il PDF supera il limite locale di pagine OCR selettive.',
                'resource_limit',
            );
        }
        const rendered = await renderPdfToImages(
            file,
            OCR_PAGE_LIMIT,
            layer?.pagesNeedingOcr,
        );
        const ocrByPage = rendered.images.length
            ? await extractOcrTextByPage(rendered)
            : new Map<number, string>();
        const normalizedText = normalizeDocumentInput(
            layer ? mergePdfPageText(layer, ocrByPage) : Array.from(ocrByPage.values()).join('\n\n'),
            { sourceKind: 'ocr' },
        ).normalizedText;
        rememberPdfDocumentMetadata(file.name, normalizedText, rendered.metadata);
        return normalizedText;
    }

    const base64 = await fileToBase64(file);
    const result = await callOcr(base64, 'full');
    return extractUsableOcrText(result);
}

/**
 * Smart extraction: AI-OCR first, regex validation/fallback
 * Supports PDF and locally processable image inputs.
 */
export async function extractPatientDataSmart(file: File): Promise<ExtractedPatientData> {
    const isImage = isImageDocumentInput(file);
    const isPdf = isPdfDocumentInput(file);

    if (!isImage && !isPdf) {
        throw new Error("Formato non supportato. Usa un PDF o un'immagine comune elaborabile localmente.");
    }

    let pdfLayer: PdfTextLayerResult | undefined;
    if (isPdf) {
        try {
            pdfLayer = await extractPdfTextLayer(file);
        } catch (error) {
            throw inspectionFailure(error);
        }
    }
    if (pdfLayer && pdfLayer.pagesNeedingOcr.length > OCR_PAGE_LIMIT) {
        throw new DocumentTextUnavailableError(
            'Il PDF supera il limite locale di pagine OCR selettive.',
            'resource_limit',
        );
    }

    /* @Codex */
    // Try AI-OCR first (PDF: render to images, Image: direct)
    let aiResult: ExtractedPatientData | null = null;
    let ocrText = '';
    let ocrByPage = new Map<number, string>();

    try {
        if (isPdf) {
            const rendered = pdfLayer?.state === 'native'
                ? { images: [], pageNumbers: [] }
                : await renderPdfToImages(file, OCR_PAGE_LIMIT, pdfLayer?.pagesNeedingOcr);
            const { images } = rendered;
            if (images.length) {
                let patientData: any = null;
                try {
                    patientData = await callOcr(images[0], 'patient');
                    if (patientData && patientData.confidence > 0.5) {
                        aiResult = mapOcrToPatientData(patientData, '', 'ai');
                    }
                } catch (e) {
                    console.warn('[PDF Service] OCR patient extraction failed', e);
                }

                ocrByPage = await extractOcrTextByPage(rendered);
                ocrText = Array.from(ocrByPage.values()).join('\n\n');
                if (ocrText) {
                    ocrText = normalizeDocumentInput(ocrText, { sourceKind: 'ocr' }).normalizedText;
                }
                if (aiResult && ocrText) {
                    aiResult.rawText = ocrText;
                }
                if (!aiResult && patientData) {
                    aiResult = buildOcrFallbackResult(patientData, 'ai', ocrText);
                }
            }
        } else if (isImage) {
            const base64 = await fileToBase64(file);
            const patientData = await callOcr(base64, 'patient');
            if (patientData && patientData.confidence > 0.5) {
                aiResult = mapOcrToPatientData(patientData, patientData.rawMarkdown || '', 'ai');
            }
            try {
                const fullResult = await callOcr(base64, 'full');
                ocrText = extractUsableOcrText(fullResult);
                if (aiResult && ocrText) {
                    aiResult.rawText = ocrText;
                }
            } catch (e) {
                console.warn('[PDF Service] OCR full extraction failed for image', e);
            }
            if (!aiResult && patientData) {
                aiResult = buildOcrFallbackResult(patientData, 'ai', ocrText);
            }
        }
    } catch (e) {
        console.warn('[PDF Service] AI-OCR failed, falling back to regex', e);
    }

    // For PDFs, also extract text with pdfjs for regex validation
    const pdfText = pdfLayer?.text || '';

    const combinedText = pdfLayer
        ? mergePdfPageText(pdfLayer, ocrByPage)
        : [pdfText, ocrText].filter(Boolean).join('\n\n');

    // If AI gave good results, validate with regex
    if (aiResult && aiResult.confidence > 0.7) {
        return mergeExtractedPatientDataWithTextFallback(aiResult, combinedText);
    }

    // Fallback: regex parsing (for PDF text)
    if (combinedText) {
        const regexResult = parsePatientData(combinedText);

        // Merge AI and regex results (prefer AI where available)
        if (aiResult) {
            return mergeExtractedPatientDataWithTextFallback({
                ...aiResult,
                rawText: combinedText,
                source: 'hybrid',
                confidence: Math.max(aiResult.confidence, 0.5)
            }, combinedText);
        }

        return { ...regexResult, source: 'regex', confidence: 0.6, rawText: combinedText };
    }

    // Last resort: return AI result even with low confidence
    if (aiResult) return aiResult;

    throw new DocumentTextUnavailableError(
        'Nessun testo utile estratto localmente dal documento. Verifica OCR locale o prova un PDF/immagine piu leggibile.',
    );
}

/**
 * Validate Italian Codice Fiscale format
 */
function isValidCodiceFiscale(cf: string): boolean {
    // Omocodia replaces digits with L/M/N/P/Q/R/S/T/U/V; keep aligned with
    // ITALIAN_TAX_CODE_REGEX in document-identity-resolution.ts.
    return /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/i.test(cf);
}

/* @Codex */
function parseItalianBirthDate(value: string): Date | undefined {
    const [day, month, year] = value.split(/[\/\-.]/).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day
        ? date
        : undefined;
}

/* @Codex */
export function mergeExtractedPatientDataWithTextFallback(
    aiResult: ExtractedPatientData,
    fallbackText: string,
): ExtractedPatientData {
    const usableText = fallbackText.trim() || aiResult.rawText || '';
    if (!usableText.trim()) {
        return aiResult;
    }

    const regexResult = parsePatientData(usableText);
    const taxCode = aiResult.taxCode && isValidCodiceFiscale(aiResult.taxCode)
        ? aiResult.taxCode.toUpperCase()
        : regexResult.taxCode || aiResult.taxCode;
    const firstName = aiResult.firstName || regexResult.firstName;
    const lastName = aiResult.lastName || regexResult.lastName;
    const birthDate = aiResult.birthDate || regexResult.birthDate;
    const address = aiResult.address || regexResult.address;
    const phone = aiResult.phone || regexResult.phone;
    const notes = aiResult.notes || regexResult.notes;
    const fallbackContributed = firstName !== aiResult.firstName
        || lastName !== aiResult.lastName
        || taxCode !== aiResult.taxCode
        || birthDate !== aiResult.birthDate
        || address !== aiResult.address
        || phone !== aiResult.phone
        || notes !== aiResult.notes;

    return {
        ...aiResult,
        firstName,
        lastName,
        taxCode,
        birthDate,
        address,
        phone,
        notes,
        rawText: usableText,
        source: aiResult.source === 'ai' && fallbackContributed ? 'hybrid' : aiResult.source,
        confidence: Math.max(aiResult.confidence, regexResult.confidence),
    };
}

export function parsePatientData(text: string): ExtractedPatientData {
    const data: ExtractedPatientData = { rawText: text, source: 'regex', confidence: 0.6 };

    // Clean text: remove excessive whitespace
    const cleanText = text.replace(/\s+/g, ' ');

    // 1. C.F.
    const cfRegex = /(?<![\p{L}\p{N}])[A-Za-z]{6}[0-9LMNPQRSTUVlmnpqrstuv]{2}[A-Za-z][0-9LMNPQRSTUVlmnpqrstuv]{2}[A-Za-z][0-9LMNPQRSTUVlmnpqrstuv]{3}[A-Za-z](?![\p{L}\p{N}])/u;
    const cfMatch = cleanText.match(cfRegex);
    if (cfMatch) data.taxCode = cfMatch[0].toUpperCase();

    // 2. BIRTH DATE
    // Only keyword-anchored dates qualify: an unanchored fallback would promote the first
    // date in the document (visit/print/report date) to birth date, which is clinically
    // worse than leaving birthDate empty.
    const dateKeywords = /\b(?:nato|nata|nascita)\b(?:\s+a\s+(?:(?!\bil\b)[A-Za-zÀ-ÖØ-öø-ÿ'\u2019 -]){2,80}?\s+il)?(?:\s+il)?\s*[:\.]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/i;
    const dateMatch = cleanText.match(dateKeywords);
    if (dateMatch) {
        const [, dateStr] = dateMatch;
        data.birthDate = parseItalianBirthDate(dateStr);
    }

    // 3. NAME
    const extractedName = extractPatientName(text);
    data.firstName = extractedName.firstName;
    data.lastName = extractedName.lastName;
    data.address = extractPatientAddress(text);

    // 4. NOTES / DIAGNOSIS (Improved with Context Window)
    // Keywords to start capture
    const startKeywords = ['diagnosi', 'motivo', 'anamnesi', 'storia', 'problema', 'conclusioni', 'valutazione', 'quesito'];
    // Keywords to stop capture (next section headers)
    const stopKeywords = ['terapia', 'farmaco', 'posologia', 'prossimo', 'data', 'firma', 'cordiali', 'referto', 'medico'];

    // Find the first occurrence of a start keyword
    let bestIndex = -1;
    for (const kw of startKeywords) {
        const idx = cleanText.toLowerCase().indexOf(kw);
        // We want the earliest occurrence that isn't at the very start (avoid false positives if doc ID matches?)
        if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
            bestIndex = idx;
        }
    }

    if (bestIndex !== -1) {
        // Capture up to 400 chars or until a stop keyword
        const maxLen = 400;
        let snippet = cleanText.substring(bestIndex, bestIndex + maxLen);

        // Try to trim the start (remove "Diagnosi:")
        const colonIdx = snippet.indexOf(':');
        if (colonIdx !== -1 && colonIdx < 20) {
            snippet = snippet.substring(colonIdx + 1);
        }

        // Try to cut off at stop keywords
        let cutIndex = snippet.length;
        for (const stopKw of stopKeywords) {
            const idx = snippet.toLowerCase().indexOf(stopKw);
            if (idx !== -1 && idx < cutIndex) {
                cutIndex = idx;
            }
        }

        data.notes = snippet.substring(0, cutIndex).trim();

        // Cleanup if it starts with "1." or similar list markers but keeps going
        if (data.notes.length > 5) {
            // It's a valid extract
        } else {
            data.notes = undefined; // Too short to be useful
        }

        const nextLineClinicalValue = extractClinicalValueAfterLabelLine(text);
        if (nextLineClinicalValue && /^diagnosi\b.*\bscelta\b/i.test(data.notes || '')) {
            data.notes = nextLineClinicalValue;
        }
    }

    return data;
}
