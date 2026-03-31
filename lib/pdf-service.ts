import type { DocumentDiagnosisSuggestion, DocumentQualityLevel } from './db';

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
    documentSummary?: string;
    documentQuality?: {
        level: DocumentQualityLevel;
        reason?: string;
    };
    rawText: string;
    source: 'ai' | 'regex' | 'hybrid';  // Track extraction method
    confidence: number;  // 0-1 confidence score
}

function isOcrFailureNote(value: string): boolean {
    return /^OCR extraction failed:/i.test(value.trim());
}

function looksLikeStructuredPayload(value: string): boolean {
    const trimmed = value.trim();
    return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('```');
}

/* @Codex */
export function extractUsableOcrText(data: { rawMarkdown?: unknown; notes?: unknown } | null | undefined): string {
    const rawMarkdown = typeof data?.rawMarkdown === 'string' ? data.rawMarkdown.trim() : '';
    if (rawMarkdown && !looksLikeStructuredPayload(rawMarkdown)) {
        return rawMarkdown;
    }

    const notes = typeof data?.notes === 'string' ? data.notes.trim() : '';
    if (notes && !isOcrFailureNote(notes)) {
        return notes;
    }

    return '';
}

/* @Codex */
const OCR_PAGE_LIMIT = 5;
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
function extractPatientName(text: string): { firstName?: string; lastName?: string } {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    let firstName: string | undefined;
    let lastName: string | undefined;

    for (const line of lines) {
        const nameMatch = line.match(/^nome\s*[:.]?\s*(.+)$/i);
        if (!firstName && nameMatch) {
            firstName = sanitizePersonValue(nameMatch[1]);
            continue;
        }

        const surnameMatch = line.match(/^cognome\s*[:.]?\s*(.+)$/i);
        if (!lastName && surnameMatch) {
            lastName = sanitizePersonValue(surnameMatch[1]);
            continue;
        }

        const fullNameMatch = line.match(/^(?:cognome\s+e\s+nome|nome\s+e\s+cognome|paziente|assistito|sig(?:nor[ae]?|\.?ra)?)\s*[:.]?\s*(.+)$/i);
        if (fullNameMatch) {
            const candidate = sanitizePersonValue(fullNameMatch[1]);
            if (!candidate) continue;
            const parts = candidate.split(/\s+/).filter(Boolean);
            if (parts.length >= 2) {
                lastName ||= sanitizePersonValue(parts[0]);
                firstName ||= sanitizePersonValue(parts.slice(1).join(' '));
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

/**
 * Extract text from PDF (server-side via pdfjs)
 */
export async function extractTextFromPdf(file: Blob): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/pdf-extract', {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to extract text from PDF");
    }

    const data = await response.json();
    return data.text || "";
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
async function renderPdfToImages(file: Blob, maxPages = OCR_PAGE_LIMIT): Promise<string[]> {
    const buffer = await file.arrayBuffer();
    const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf');

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
    const pagesToRender = await selectPdfPagesForOcr(pdf, maxPages);

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

    return images;
}

/* @Codex */
async function selectPdfPagesForOcr(pdf: any, maxPages: number): Promise<number[]> {
    const total = pdf.numPages || 1;
    const analysisPages = Math.min(total, Math.max(maxPages + 2, 7));
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
async function extractOcrFullTextFromImages(images: string[]): Promise<string> {
    const chunks: string[] = [];
    for (const image of images) {
        try {
            const result = await callOcr(image, 'full');
            const raw = result?.rawMarkdown || "";
            if (raw) chunks.push(raw);
        } catch (e) {
            console.warn('[PDF Service] OCR full failed for page', e);
        }
    }
    return chunks.join('\n\n');
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
        const images = await renderPdfToImages(file, OCR_PAGE_LIMIT);
        if (!images.length) return "";
        return await extractOcrFullTextFromImages(images);
    }

    const base64 = await fileToBase64(file);
    const result = await callOcr(base64, 'full');
    return result?.rawMarkdown || "";
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

    /* @Codex */
    // Try AI-OCR first (PDF: render to images, Image: direct)
    let aiResult: ExtractedPatientData | null = null;
    let ocrText = '';

    try {
        if (isPdf) {
            const images = await renderPdfToImages(file, OCR_PAGE_LIMIT);
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

                ocrText = await extractOcrFullTextFromImages(images);
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
    let pdfText = '';
    if (isPdf) {
        try {
            if (!ocrText) {
                pdfText = await extractTextFromPdf(file);
            }
        } catch (e) {
            console.warn('[PDF Service] PDF text extraction failed', e);
        }
    }

    const combinedText = ocrText || pdfText;

    // If AI gave good results, validate with regex
    if (aiResult && aiResult.confidence > 0.7) {
        // Validate taxCode format if provided
        if (aiResult.taxCode && !isValidCodiceFiscale(aiResult.taxCode)) {
            // Try regex extraction from PDF text
            const regexTax = extractCodiceFiscale(combinedText || aiResult.rawText);
            if (regexTax) aiResult.taxCode = regexTax;
        }
        return aiResult;
    }

    // Fallback: regex parsing (for PDF text)
    if (combinedText) {
        const regexResult = parsePatientData(combinedText);

        // Merge AI and regex results (prefer AI where available)
        if (aiResult) {
            return {
                firstName: aiResult.firstName || regexResult.firstName,
                lastName: aiResult.lastName || regexResult.lastName,
                taxCode: aiResult.taxCode || regexResult.taxCode,
                birthDate: aiResult.birthDate || regexResult.birthDate,
                address: aiResult.address || regexResult.address,
                phone: aiResult.phone,
                diagnosis: aiResult.diagnosis,
                medications: aiResult.medications,
                notes: aiResult.notes || regexResult.notes,
                rawText: combinedText,
                source: 'hybrid',
                confidence: Math.max(aiResult.confidence, 0.5)
            };
        }

        return { ...regexResult, source: 'regex', confidence: 0.6, rawText: combinedText };
    }

    // Last resort: return AI result even with low confidence
    if (aiResult) return aiResult;

    throw new Error('Nessun testo utile estratto localmente dal documento. Verifica OCR locale o prova un PDF/immagine piu leggibile.');
}

/**
 * Validate Italian Codice Fiscale format
 */
function isValidCodiceFiscale(cf: string): boolean {
    return /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/i.test(cf);
}

/**
 * Extract Codice Fiscale using regex
 */
function extractCodiceFiscale(text: string): string | null {
    const match = text.match(/[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/i);
    return match ? match[0].toUpperCase() : null;
}




export function parsePatientData(text: string): ExtractedPatientData {
    const data: ExtractedPatientData = { rawText: text, source: 'regex', confidence: 0.6 };

    // Clean text: remove excessive whitespace
    const cleanText = text.replace(/\s+/g, ' ');

    // 1. C.F.
    const cfRegex = /[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/i;
    const cfMatch = cleanText.match(cfRegex);
    if (cfMatch) data.taxCode = cfMatch[0].toUpperCase();

    // 2. BIRTH DATE
    // 2. BIRTH DATE
    const dateKeywords = /(?:nato|nata|nascita)\s+(?:il|a)?\s*[:\.]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/i;
    const dateMatch = cleanText.match(dateKeywords);
    if (dateMatch) {
        const [, dateStr] = dateMatch;
        const parts = dateStr.split(/[\/\-\.]/);
        if (parts.length === 3) data.birthDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    } else {
        const dateRegex = /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/;
        const fallbackDate = cleanText.match(dateRegex);
        if (fallbackDate) {
            const [, d, m, y] = fallbackDate;
            data.birthDate = new Date(`${y}-${m}-${d}`);
        }
    }

    // 3. NAME
    const extractedName = extractPatientName(text);
    data.firstName = extractedName.firstName;
    data.lastName = extractedName.lastName;

    // 4. NOTES / DIAGNOSIS (Improved with Context Window)
    // Keywords to start capture
    const startKeywords = ['diagnosi', 'motivo', 'anamnesi', 'storia', 'problema', 'conclusioni', 'valutazione', 'quesito'];
    // Keywords to stop capture (next section headers)
    const stopKeywords = ['terapia', 'prossimo', 'data', 'firma', 'cordiali', 'referto', 'medico'];

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
    }

    return data;
}
