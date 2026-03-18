/* @Codex */
export type DocumentQualityLevel = 'green' | 'yellow' | 'red';

/* @Codex */
export interface DocumentDiagnosisSuggestion {
    code: string;
    description: string;
    system: 'ICD-9' | 'ICD-10' | 'ICD-11';
    evidence?: string;
    confidence?: 'high' | 'medium' | 'low';
}

/* @Codex */
export type DocumentStructuredAnalysis = {
    summary: string;
    quality?: {
        level: DocumentQualityLevel;
        reason?: string;
    };
    medications: string[];
    diagnoses: DocumentDiagnosisSuggestion[];
};

type RawStructuredAnalysis = {
    summary_markdown?: unknown;
    quality?: {
        level?: unknown;
        reason?: unknown;
    };
    medications?: unknown;
    diagnoses?: unknown;
};

function extractJsonBlock(response: string): string | null {
    const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return fenced[1].trim();

    const firstBrace = response.indexOf('{');
    const lastBrace = response.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return null;
    }

    return response.slice(firstBrace, lastBrace + 1).trim();
}

function cleanSummary(summary: string): string {
    return summary
        .replace(/<unused94>[\s\S]*?(<unused95>|$)/g, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^Plan:\s*/gim, '')
        .trim();
}

function normalizeQualityLevel(value: unknown): DocumentQualityLevel {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'green' || normalized === 'yellow' || normalized === 'red') {
        return normalized;
    }
    return 'yellow';
}

export function normalizeDiagnosisSystem(value: unknown): DocumentDiagnosisSuggestion['system'] | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toUpperCase().replace(/\s+/g, '');
    if (normalized === 'ICD-9' || normalized === 'ICD9') return 'ICD-9';
    if (normalized === 'ICD-10' || normalized === 'ICD10') return 'ICD-10';
    if (normalized === 'ICD-11' || normalized === 'ICD11') return 'ICD-11';
    return null;
}

function normalizeDiagnosisSuggestion(value: unknown): DocumentDiagnosisSuggestion | null {
    if (!value || typeof value !== 'object') return null;

    const record = value as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code.trim().toUpperCase() : '';
    const description = typeof record.description === 'string' ? record.description.trim() : '';
    const system = normalizeDiagnosisSystem(record.system);

    if (!code || !description || !system) return null;

    const confidence = typeof record.confidence === 'string'
        ? record.confidence.trim().toLowerCase()
        : '';

    return {
        code,
        description,
        system,
        evidence: typeof record.evidence === 'string' ? record.evidence.trim() : undefined,
        confidence: confidence === 'high' || confidence === 'medium' || confidence === 'low'
            ? confidence
            : undefined,
    };
}

function normalizeMedicationSuggestion(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length < 3) return null;
    return normalized.slice(0, 180);
}

function buildFallbackSummary(rawText: string): string {
    const normalized = rawText
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 6)
        .join('\n');

    return normalized
        ? `**Riassunto clinico:**\n${normalized.slice(0, 700)}`
        : 'Documento scannerizzato. Riassunto non disponibile.';
}

export function parseStructuredAnalysisResponse(response: string, rawMarkdown: string): DocumentStructuredAnalysis {
    const rawJson = extractJsonBlock(response);
    if (!rawJson) {
        return {
            summary: cleanSummary(response) || buildFallbackSummary(rawMarkdown),
            quality: {
                level: 'yellow',
                reason: 'Risposta non strutturata dal modello clinico',
            },
            medications: [],
            diagnoses: [],
        };
    }

    try {
        const parsed = JSON.parse(rawJson) as RawStructuredAnalysis;
        const medications = Array.isArray(parsed.medications)
            ? Array.from(
                new Set(
                    parsed.medications
                        .map(normalizeMedicationSuggestion)
                        .filter((item): item is string => Boolean(item)),
                ),
            )
            : [];
        const diagnoses = Array.isArray(parsed.diagnoses)
            ? parsed.diagnoses
                .map(normalizeDiagnosisSuggestion)
                .filter((item): item is DocumentDiagnosisSuggestion => Boolean(item))
            : [];

        const summary = typeof parsed.summary_markdown === 'string'
            ? cleanSummary(parsed.summary_markdown)
            : '';

        return {
            summary: summary || buildFallbackSummary(rawMarkdown),
            quality: parsed.quality
                ? {
                    level: normalizeQualityLevel(parsed.quality.level),
                    reason: typeof parsed.quality.reason === 'string' ? parsed.quality.reason.trim() : undefined,
                }
                : {
                    level: diagnoses.length > 0 || medications.length > 0 ? 'green' : 'yellow',
                    reason: diagnoses.length > 0 || medications.length > 0
                        ? 'Dati clinici strutturati estratti'
                        : 'Analisi completata con dati parziali',
                },
            medications,
            diagnoses,
        };
    } catch {
        return {
            summary: cleanSummary(response) || buildFallbackSummary(rawMarkdown),
            quality: {
                level: 'yellow',
                reason: 'JSON del modello non valido',
            },
            medications: [],
            diagnoses: [],
        };
    }
}
