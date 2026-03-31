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
import { buildDocumentSynthesisExtractionPrompt } from './ai-task-contracts';
import {
    normalizeDiagnosisSystem,
    parseStructuredAnalysisResponse,
    type DocumentStructuredAnalysis,
} from './document-synthesis-parser';
import {
    buildDocumentExcerpt,
    buildStoredDocumentExcerpt,
} from './document-excerpt';

/* @Codex */
const MAX_SYNTHESIS_CHARS = 8000;

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
    const sliced = buildDocumentExcerpt(rawMarkdown, MAX_SYNTHESIS_CHARS);
    const content = await ai.generate(buildDocumentSynthesisExtractionPrompt(sliced), undefined, 1024);
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
        rawMarkdown: buildStoredDocumentExcerpt(rawMarkdown),
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
