/**
 * OCR Service - Document Intelligence Layer
 * 
 * Uses DeepSeek-OCR (via Ollama) for first-pass document understanding.
 * Part of the "Virtual Secretariat" in MediFlow's Clinical AI Team.
 */

import { AIService, ChatMessageContent } from './ai-service';

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
    aiService?: AIService
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

    try {
        const result = await ai.chat(messages, undefined, 4096);
        const rawResponse = result.content;

        // Parse based on mode
        if (mode === 'full') {
            return {
                rawMarkdown: rawResponse,
                confidence: 0.9
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
            notes: `OCR extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
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
 * Parse Italian date formats (DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY)
 */
function parseItalianDate(dateStr: string): Date | undefined {
    if (!dateStr) return undefined;

    const match = dateStr.match(/(\d{1,2})[\\/\\-\\.](\d{1,2})[\\/\\-\\.](\d{4})/);
    if (match) {
        const [, day, month, year] = match;
        return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    }

    // Try ISO format
    const isoDate = new Date(dateStr);
    return isNaN(isoDate.getTime()) ? undefined : isoDate;
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
