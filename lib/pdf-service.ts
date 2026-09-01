import type { DocumentDiagnosisSuggestion, DocumentQualityLevel } from './db';
import type {
    SmartImportConfidence,
    SmartImportDiagnosisExtraction,
    SmartImportServicePrescriptionExtraction,
    SmartImportTherapyExtraction,
    TherapySuggestionState,
} from './ai-task-contracts';
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

/* @Codex */
export class DocumentTextUnavailableError extends Error {
    readonly status = 'review_required' as const;
    readonly reason = 'unsupported_local_extraction' as const;
    readonly detail:
        | 'unsupported_format'
        | 'image_or_scan'
        | 'malformed_document'
        | 'encrypted_document'
        | 'resource_limit'
        | 'incomplete_document'
        | 'io_failure'
        | 'empty_extraction';
    readonly textLayerFailure?: PdfTextLayerFailureReason;

    constructor(
        message: string,
        textLayerFailure?: PdfTextLayerFailureReason,
        detail?: DocumentTextUnavailableError['detail'],
    ) {
        super(message);
        this.name = 'DocumentTextUnavailableError';
        this.textLayerFailure = textLayerFailure;
        this.detail = detail ?? (
            textLayerFailure === 'password_protected'
                ? 'encrypted_document'
                : textLayerFailure === 'resource_limit'
                    ? 'resource_limit'
                    : textLayerFailure
                        ? 'malformed_document'
                        : 'image_or_scan'
        );
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

/* @Codex */
export async function extractTextFromPdf(file: Blob): Promise<string> {
    const layer = await extractPdfTextLayer(file);
    if (layer.state !== 'native') {
        throw new DocumentTextUnavailableError(
            'Il PDF contiene pagine senza testo nativo e richiede revisione manuale.',
            undefined,
            'image_or_scan',
        );
    }
    if (!layer.text.trim()) {
        throw new DocumentTextUnavailableError(
            'Il PDF non contiene testo nativo utile.',
            undefined,
            'empty_extraction',
        );
    }
    return layer.text;
}

/* @Codex */
export async function extractDocumentTextForSummary(file: File): Promise<string> {
    const isPdf = isPdfDocumentInput(file);
    const isImage = isImageDocumentInput(file);

    if (!isPdf && !isImage) {
        return '';
    }
    if (isImage) {
        throw new DocumentTextUnavailableError(
            'Le immagini e le scansioni richiedono revisione manuale.',
            undefined,
            'image_or_scan',
        );
    }

    try {
        const layer = await extractPdfTextLayer(file);
        if (layer.state !== 'native') {
            throw new DocumentTextUnavailableError(
                'Il PDF contiene pagine senza testo nativo: estrazione locale non supportata.',
                undefined,
                'image_or_scan',
            );
        }
        if (!layer.text.trim()) {
            throw new DocumentTextUnavailableError(
                'Il PDF non contiene testo nativo utile.',
                undefined,
                'empty_extraction',
            );
        }
        return layer.text;
    } catch (error) {
        throw inspectionFailure(error);
    }
}

/**
 * Parse patient fields deterministically from a PDF with a complete native
 * text layer. Images, scans, and mixed PDFs stop at the typed review boundary.
 */
/* @Codex */
export async function extractPatientDataSmart(file: File): Promise<ExtractedPatientData> {
    const isImage = isImageDocumentInput(file);
    const isPdf = isPdfDocumentInput(file);

    if (!isImage && !isPdf) {
        throw new DocumentTextUnavailableError(
            'Formato non supportato dall\'estrazione locale.',
            undefined,
            'unsupported_format',
        );
    }
    if (isImage) {
        throw new DocumentTextUnavailableError(
            'Le immagini e le scansioni richiedono revisione manuale.',
            undefined,
            'image_or_scan',
        );
    }

    let layer: PdfTextLayerResult;
    try {
        layer = await extractPdfTextLayer(file);
    } catch (error) {
        throw inspectionFailure(error);
    }

    if (layer.state !== 'native') {
        throw new DocumentTextUnavailableError(
            'Il PDF contiene pagine senza testo nativo: estrazione locale non supportata.',
            undefined,
            'image_or_scan',
        );
    }
    if (!layer.text.trim()) {
        throw new DocumentTextUnavailableError(
            'Il PDF non contiene testo nativo utile.',
            undefined,
            'empty_extraction',
        );
    }

    return parsePatientData(layer.text);
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
    const dateKeywords = /\b(?:nato|nata|nascita)\b(?:\s+a\s+(?:(?!\bil\b)[A-Za-zÀ-ÖØ-öø-ÿ'\u2019 -]){2,80}?\s+il|\s+il)?\s*[:\.]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/i;
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
