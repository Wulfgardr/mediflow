/**
 * Document Synthesis Service
 * OCR-first pipeline: DeepSeek OCR -> Qwen clinical analysis -> prudent ICD autofill
 */

import { AIService } from './ai-service';
import type {
    Diagnosis,
    DocumentDiagnosisSuggestion,
    DocumentInsight,
} from './db';
import { db } from './db';
import { v4 as uuid } from 'uuid';
import {
    normalizeDiagnosisSystem,
    parseStructuredAnalysisResponse,
    type DocumentStructuredAnalysis,
} from './document-synthesis-parser';

const ANALYSIS_PROMPT = `Sei un assistente clinico locale. Ricevi testo OCR grezzo di un documento medico italiano.

Restituisci SOLO JSON valido, senza testo extra, con questa forma:
{
  "summary_markdown": "riassunto clinico conciso in markdown",
  "quality": {
    "level": "green|yellow|red",
    "reason": "motivo sintetico della valutazione"
  },
  "medications": [
    "farmaco o principio attivo esplicitamente presente nel documento, con posologia se esplicita"
  ],
  "diagnoses": [
    {
      "code": "codice ICD esplicito nel documento",
      "description": "descrizione clinica associata",
      "system": "ICD-9|ICD-10|ICD-11",
      "evidence": "breve citazione/parafrasi locale del passaggio rilevante",
      "confidence": "high|medium|low"
    }
  ]
}

Regole:
- Usa "green" se il contenuto OCR e chiaro e coerente, "yellow" se ambiguo o parziale, "red" se insufficiente o molto rumoroso.
- In "medications" includi SOLO terapie o principi attivi esplicitamente presenti nel testo OCR.
- Non inventare posologie o farmaci mancanti.
- Ogni elemento in "medications" deve rappresentare una terapia distinta.
- In "diagnoses" includi SOLO patologie con codice ICD esplicitamente presente nel testo OCR.
- Non inventare o inferire codici ICD mancanti.
- Se il documento non contiene terapie esplicite, usa "medications": [].
- Se il documento non contiene codici ICD, usa "diagnoses": [].
- "summary_markdown" deve essere breve, clinico, senza dati identificativi superflui.
- Massimo 5 diagnosi.
- Massimo 8 terapie.

DOCUMENTO OCR:
`;

/* @Codex */
const MAX_SYNTHESIS_CHARS = 8000;

/* @Codex */
function smartSliceText(text: string, maxChars: number): string {
    if (!text) return "";
    if (text.length <= maxChars) return text;

    const keywords = [
        'diagnosi', 'terapia', 'farmac', 'prescr', 'anamnesi', 'esami', 'referto',
        'dimission', 'valutazione', 'conclusioni', 'patologia', 'icd', 'codice'
    ];

    const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
    const scored = lines.map((line, index) => {
        const lower = line.toLowerCase();
        let score = lower.length;
        for (const keyword of keywords) {
            if (lower.includes(keyword)) score += 500;
        }
        if (/\b(icd[\s:-]*\d{0,2}|\d[A-Z0-9\.]{2,})\b/i.test(lower)) score += 400;
        if (/\d{1,3}[,\.]\d+/.test(lower)) score += 200;
        return { line, score, index };
    });

    scored.sort((a, b) => b.score - a.score || a.index - b.index);

    const picked: string[] = [];
    let total = 0;
    for (const item of scored) {
        if (total + item.line.length + 1 > maxChars) continue;
        picked.push(item.line);
        total += item.line.length + 1;
        if (total >= maxChars) break;
    }

    if (total < maxChars * 0.35) {
        const head = text.slice(0, Math.floor(maxChars * 0.55));
        const tail = text.slice(-Math.floor(maxChars * 0.2));
        return `${head}\n...\n${tail}`;
    }

    return picked.join('\n');
}

/* @Codex */
function parseExistingInsights(raw: unknown): DocumentInsight[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as DocumentInsight[];
    if (typeof raw !== 'string') return [];

    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed as DocumentInsight[] : [];
    } catch {
        return [];
    }
}

/* @Codex */
function normalizePatientDiagnosis(value: unknown): Diagnosis | null {
    if (!value || typeof value !== 'object') return null;

    const record = value as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code.trim().toUpperCase() : '';
    const description = typeof record.description === 'string' ? record.description.trim() : '';
    const system = normalizeDiagnosisSystem(record.system);

    if (!code || !description || !system) return null;

    const rawDate = record.date;
    const date = rawDate ? new Date(rawDate as string | number | Date) : new Date();

    return {
        code,
        description,
        system,
        date: Number.isNaN(date.getTime()) ? new Date() : date
    };
}

/* @Codex */
function parseExistingDiagnoses(raw: unknown): Diagnosis[] {
    if (!raw) return [];

    const source = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
            ? (() => {
                try {
                    const parsed = JSON.parse(raw);
                    return Array.isArray(parsed) ? parsed : [];
                } catch {
                    return [];
                }
            })()
            : [];

    return source
        .map(normalizePatientDiagnosis)
        .filter((item): item is Diagnosis => Boolean(item));
}

/* @Codex */
function mergeDiagnoses(
    existingDiagnoses: Diagnosis[],
    suggestions: DocumentDiagnosisSuggestion[]
): { diagnoses: Diagnosis[]; appliedCodes: string[] } {
    const seen = new Set(existingDiagnoses.map(item => `${item.system}:${item.code}`));
    const appliedCodes: string[] = [];
    const diagnoses = [...existingDiagnoses];

    for (const suggestion of suggestions) {
        const key = `${suggestion.system}:${suggestion.code}`;
        if (seen.has(key)) continue;

        diagnoses.push({
            code: suggestion.code,
            description: suggestion.description,
            system: suggestion.system,
            date: new Date()
        });
        seen.add(key);
        appliedCodes.push(key);
    }

    return { diagnoses, appliedCodes };
}

/* @Codex */
/**
 * Analyze OCR text without persisting anything.
 */
export async function analyzeDocumentContent(rawMarkdown: string): Promise<DocumentStructuredAnalysis> {
    const ai = await AIService.create('clinical');
    const sliced = smartSliceText(rawMarkdown, MAX_SYNTHESIS_CHARS);
    const content = await ai.generate(ANALYSIS_PROMPT + sliced, undefined, 1024);
    return parseStructuredAnalysisResponse(content, rawMarkdown);
}

/**
 * Synthesize a document, persist the insight and auto-merge explicit ICD diagnoses.
 */
export async function synthesizeDocument(
    rawMarkdown: string,
    fileName: string,
    patientId: string
): Promise<DocumentInsight> {
    const analysis = await analyzeDocumentContent(rawMarkdown);

    const patient = await db.patients.get(patientId);
    if (!patient) {
        throw new Error('Paziente non trovato');
    }
    if (typeof patient.version !== 'number') {
        throw new Error('Missing patient version for document synthesis.');
    }

    const existingInsights = parseExistingInsights(patient.documentInsights);
    const existingDiagnoses = parseExistingDiagnoses(patient.diagnoses);
    const suggestionsForAutofill = analysis.quality?.level === 'red'
        ? []
        : analysis.diagnoses.filter((item) => item.confidence !== 'low');
    const { diagnoses, appliedCodes } = mergeDiagnoses(existingDiagnoses, suggestionsForAutofill);

    const insight: DocumentInsight = {
        id: uuid(),
        date: new Date(),
        fileName,
        rawMarkdown: rawMarkdown.substring(0, 3000),
        summary: analysis.summary,
        quality: analysis.quality,
        extractedData: analysis.diagnoses.length > 0 || analysis.medications.length > 0
            ? {
                ...(analysis.diagnoses.length > 0 ? { diagnoses: analysis.diagnoses } : {}),
                ...(analysis.medications.length > 0 ? { medications: analysis.medications } : {}),
            }
            : undefined,
        autofill: appliedCodes.length > 0
            ? { appliedDiagnoses: appliedCodes }
            : undefined
    };

    existingInsights.unshift(insight);
    const nextInsights = existingInsights.slice(0, 3);

    await db.patients.update(patientId, {
        documentInsights: nextInsights,
        diagnoses: appliedCodes.length > 0 ? diagnoses : undefined,
        version: patient.version,
        updatedAt: new Date()
    });

    return insight;
}

/**
 * Get document insights for a patient.
 */
export async function getDocumentInsights(patientId: string): Promise<DocumentInsight[]> {
    const patient = await db.patients.get(patientId);
    return parseExistingInsights(patient?.documentInsights);
}
