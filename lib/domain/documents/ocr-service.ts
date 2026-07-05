/**
 * OCR Service - Document Intelligence Layer
 * 
 * Uses DeepSeek-OCR (via Ollama) for first-pass document understanding.
 * Part of the "Virtual Secretariat" in MediFlow's Clinical AI Team.
 */

import { AIService, ChatMessageContent } from '../../ai-service';
import { parseItalianDate } from '../../italian-date';

// Structured extraction result
export interface ExtractedDocumentData {
    // Patient Demographics
    firstName?: string;
    lastName?: string;
    taxCode?: string;  // Codice Fiscale
    birthDate?: Date;
    address?: string;
    phone?: string;

    // Clinical Data
    diagnosis?: string;
    notes?: string;
    medications?: string[];
    labResults?: { name: string; value: string; unit?: string; reference?: string }[];

    // Document Metadata
    documentType?: 'referto' | 'analisi' | 'ricetta' | 'lettera' | 'altro';
    documentDate?: Date;
    author?: string;
    facility?: string;

    // Raw extraction
    rawMarkdown: string;
    confidence: number; // 0-1 extraction confidence
    fallbackEngine?: 'apple_vision';
}

/* @Codex */
export interface ExtractDocumentWithAIOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
}

/* @Codex */
const DEFAULT_OCR_GENERATION_TIMEOUT_MS = 120_000;

/* @Codex */
export function resolveOcrGenerationTimeoutMs(timeoutMs?: number, envValue = process.env.MEDIFLOW_OCR_GENERATION_TIMEOUT_MS ?? process.env.MEDIFLOW_OCR_TIMEOUT_MS): number {
    const candidate = timeoutMs ?? (envValue ? Number(envValue) : DEFAULT_OCR_GENERATION_TIMEOUT_MS);
    return Number.isFinite(candidate) && candidate > 0
        ? Math.max(1, Math.round(candidate))
        : DEFAULT_OCR_GENERATION_TIMEOUT_MS;
}

/* @Codex */
function createAbortReason(message: string): Error {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

/* @Codex */
function createOcrAbortSignal(options?: ExtractDocumentWithAIOptions): { signal: AbortSignal; cleanup: () => void } {
    const timeoutMs = resolveOcrGenerationTimeoutMs(options?.timeoutMs);
    const controller = new AbortController();
    const abortFromCaller = () => {
        controller.abort(options?.signal?.reason ?? createAbortReason('OCR generation aborted by caller.'));
    };
    const timeoutId = setTimeout(() => {
        controller.abort(createAbortReason(`OCR generation timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    if (options?.signal?.aborted) {
        abortFromCaller();
    } else {
        options?.signal?.addEventListener('abort', abortFromCaller, { once: true });
    }

    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timeoutId);
            options?.signal?.removeEventListener('abort', abortFromCaller);
        },
    };
}

/* @Codex */
function getOcrGenerationErrorMessage(error: unknown, signal: AbortSignal): string {
    const reason = signal.reason;
    if (reason instanceof Error && reason.message) return reason.message;
    if (error instanceof Error && error.name === 'AbortError') return 'OCR generation aborted.';
    if (error instanceof Error) return error.message;
    return 'Unknown error';
}

/* @Codex */
export function isLowSignalOcrText(value: string | null | undefined): boolean {
    const compact = (value || '').replace(/\s+/g, ' ').trim();
    if (!compact) return true;
    if (/^OCR extraction failed:/i.test(compact)) return true;
    if (/^(nessuna informazione rilevante|nessun dato rilevante|analisi non disponibile|documento non leggibile)\b/i.test(compact)) {
        return true;
    }

    const alphaChars = compact.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g)?.length || 0;
    if (compact.length >= 24 && alphaChars < 12) return true;
    if (/^(?:\d+\.){10,}\d*$/u.test(compact.replace(/\s+/g, ''))) return true;

    const tokens = compact.split(/\s+/).filter(Boolean);
    const uniqueTokens = new Set(tokens.map((token) => token.toLowerCase()));
    if (tokens.length >= 12 && uniqueTokens.size <= 2) return true;

    return false;
}

// Prompts for different extraction modes
const OCR_PROMPTS = {
    // Full document → Markdown conversion
    toMarkdown: `<|grounding|>Convert the document to markdown. Preserve all text, tables, and structure.`,

    // Patient data extraction with Italian medical context
    patientExtraction: `Analyze this Italian medical document and extract patient information.
Return a JSON object with these fields (use null for missing data):
{
  "paziente": { "nome": "", "cognome": "", "codice_fiscale": "", "data_nascita": "", "indirizzo": "", "telefono": "" },
  "clinica": { "diagnosi": "", "note": "", "farmaci": [], "esami": [] },
  "documento": { "tipo": "", "data": "", "autore": "", "struttura": "" }
}
Extract ONLY what is clearly written. Do not invent data.`,

    // Lab results table extraction
    labResults: `Extract lab results from this document. Return JSON array:
[{"nome": "Emoglobina", "valore": "14.2", "unita": "g/dL", "riferimento": "12-16"}]`
};

/**
 * Extract structured data from a document image using AI-OCR
 */
export async function extractDocumentWithAI(
    imageBase64: string,
    mode: 'full' | 'patient' | 'labs' = 'patient',
    aiService?: AIService,
    options?: ExtractDocumentWithAIOptions,
): Promise<ExtractedDocumentData> {

    const ai = aiService ?? await AIService.create('ocr');

    // Build multimodal message
    const prompt = mode === 'full'
        ? OCR_PROMPTS.toMarkdown
        : mode === 'labs'
            ? OCR_PROMPTS.labResults
            : OCR_PROMPTS.patientExtraction;

    const content: ChatMessageContent[] = [
        {
            type: 'image_url',
            image_url: { url: imageBase64.startsWith('data:') ? imageBase64 : `data:image/png;base64,${imageBase64}` }
        },
        { type: 'text', text: prompt }
    ];

    const messages = [{ role: 'user', content }];

    const abortSignal = createOcrAbortSignal(options);

    try {
        const result = await ai.chat(messages, abortSignal.signal, 4096);
        const rawResponse = result.content;

        // Parse based on mode
        if (mode === 'full') {
            return {
                rawMarkdown: rawResponse,
                confidence: isLowSignalOcrText(rawResponse) ? 0.15 : 0.9
            };
        }

        // Try to parse JSON response
        const parsed = parseAIResponse(rawResponse, mode);
        return parsed;

    } catch (error) {
        console.error('[OCR Service] Extraction failed:', error);
        return {
            rawMarkdown: '',
            confidence: 0,
            notes: `OCR extraction failed: ${getOcrGenerationErrorMessage(error, abortSignal.signal)}`
        };
    } finally {
        abortSignal.cleanup();
    }
}

/**
 * Parse AI response into structured data
 */
function parseAIResponse(response: string, mode: string): ExtractedDocumentData {
    // Try to extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) ||
        response.match(/\{[\s\S]*\}/) ||
        response.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
        return {
            rawMarkdown: response,
            confidence: 0.3,
            notes: response.slice(0, 500)
        };
    }

    try {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const data = JSON.parse(jsonStr);

        if (mode === 'labs' && Array.isArray(data)) {
            return {
                rawMarkdown: response,
                confidence: 0.85,
                labResults: data.map((item: { nome?: string; valore?: string; unita?: string; riferimento?: string }) => ({
                    name: item.nome || '',
                    value: item.valore || '',
                    unit: item.unita,
                    reference: item.riferimento
                }))
            };
        }

        // Patient extraction format
        const paziente = data.paziente || {};
        const clinica = data.clinica || {};
        const documento = data.documento || {};

        return {
            firstName: paziente.nome || undefined,
            lastName: paziente.cognome || undefined,
            taxCode: paziente.codice_fiscale || undefined,
            birthDate: paziente.data_nascita ? parseItalianDate(paziente.data_nascita) : undefined,
            address: paziente.indirizzo || undefined,
            phone: paziente.telefono || undefined,
            diagnosis: clinica.diagnosi || undefined,
            notes: clinica.note || undefined,
            medications: clinica.farmaci?.length ? clinica.farmaci : undefined,
            documentType: mapDocumentType(documento.tipo),
            documentDate: documento.data ? parseItalianDate(documento.data) : undefined,
            author: documento.autore || undefined,
            facility: documento.struttura || undefined,
            rawMarkdown: response,
            confidence: 0.8
        };

    } catch (e) {
        console.warn('[OCR] JSON parse failed, using raw text', e);
        return {
            rawMarkdown: response,
            confidence: 0.4,
            notes: response.slice(0, 500)
        };
    }
}

/**
 * Map Italian document type to enum
 */
function mapDocumentType(tipo: string): ExtractedDocumentData['documentType'] {
    if (!tipo) return 'altro';
    const t = tipo.toLowerCase();
    if (t.includes('referto') || t.includes('visita')) return 'referto';
    if (t.includes('analis') || t.includes('esam') || t.includes('labor')) return 'analisi';
    if (t.includes('ricetta') || t.includes('prescrizione')) return 'ricetta';
    if (t.includes('lettera') || t.includes('dimission')) return 'lettera';
    return 'altro';
}

/**
 * Check if OCR model is available
 */
export async function isOcrModelAvailable(): Promise<boolean> {
    try {
        console.log('[OCR Check] Creating AI service for OCR...');
        const ai = await AIService.create('ocr');
        console.log('[OCR Check] Getting health...');
        const health = await ai.getHealth();

        console.log('[OCR Check] Health status:', health.status, 'Models:', health.models);

        if (health.status !== 'ok') return false;

        // Check if the OCR model (or similar) is in the list
        const ocrModelPatterns = ['deepseek-ocr', 'deepseek', 'minicpm', 'llava'];
        const found = health.models.some(m =>
            ocrModelPatterns.some(pattern => m.toLowerCase().includes(pattern))
        );
        console.log('[OCR Check] Pattern match result:', found);
        return found;
    } catch (err) {
        console.error('[OCR Check] Error:', err);
        return false;
    }
}
