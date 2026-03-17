/* @Codex */
'use client';

import { db } from '@/lib/db';
import { DEFAULT_OCR_MODEL, ensureTextModelDefaultsUpgraded, resolveTextModel } from '@/lib/ai-models';
/* @Codex */
import {
    sanitizeInsightMarkdown,
    splitInsightDiagnostics,
    finalizePatientInsight,
} from '@/lib/patient-insight';

export type SummaryStage = 'connect' | 'context' | 'generate' | 'save';

export interface SummaryModelInfo {
    provider: string;
    model: string;
    baseUrl: string;
}

interface SummaryOptions {
    signal?: AbortSignal;
    onStage?: (stage: SummaryStage, info?: SummaryModelInfo) => void;
}

const SUMMARY_PROMPT = `Sei un assistente medico locale.

OBIETTIVO:
- produrre un insight clinico breve, asciutto e orientato all'azione
- evidenziare solo cio che aiuta la gestione pratica del paziente oggi
- proporre prossimi passi prudenti, verificabili e non inventati

FORMATO OBBLIGATORIO IN MARKDOWN:
**Quadro attuale:** max 2 frasi brevi, ognuna chiusa con [Sx] o [DATI-INCOMPLETI].

**Attenzioni:**
- massimo 2 bullet, ciascuno chiuso con [Sx] o [DATI-INCOMPLETI]

**Prossimi passi:**
- massimo 3 bullet operativi, ciascuno chiuso con [Sx] o [DATI-INCOMPLETI]

**Gap da chiarire:**
- massimo 2 bullet solo se davvero utili, ciascuno chiuso con [Sx] o [DATI-INCOMPLETI]

REGOLE IMPORTANTI:
- massimo 140 parole totali
- niente introduzioni o conclusioni
- niente ripetizioni o narrativa superflua
- non inventare diagnosi, esami, terapie o fonti
- usa solo i riferimenti [Sx] presenti nel contesto
- se non emerge un'azione chiara, scrivi "monitoraggio clinico" nei prossimi passi
- privilegia problemi attivi, diagnosi codificate, terapie in corso, controlli pendenti, osservazioni recenti e documenti recenti

DATI PAZIENTE:
`;

const inflight = new Map<string, Promise<SummaryModelInfo | null>>();

const SECTION_TITLES = [
    'Quadro attuale',
    'Attenzioni',
    'Prossimi passi',
    'Gap da chiarire',
    'Riassunto clinico',
    'Punti di attenzione',
    'Prossima mossa',
];

export interface ParsedPatientInsight {
    summary: string;
    alerts: string[];
    nextSteps: string[];
    gaps: string[];
    fallbackMarkdown: string;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSection(markdown: string, titles: string[]): string {
    const startPattern = titles.map(escapeRegExp).join('|');
    const stopPattern = SECTION_TITLES.map(escapeRegExp).join('|');
    const regex = new RegExp(
        `(?:^|\\n)\\*\\*(?:${startPattern})\\*\\*:?\\s*([\\s\\S]*?)(?=(?:\\n\\*\\*(?:${stopPattern})\\*\\*:?|$))`,
        'i'
    );
    const match = markdown.match(regex);
    return match?.[1]?.trim() || '';
}

function parseList(section: string): string[] {
    return section
        .split('\n')
        .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s*/, '').trim())
        .filter(Boolean);
}

export function parsePatientInsight(content: string): ParsedPatientInsight {
    const diagnostics = splitInsightDiagnostics(content);
    const fallbackMarkdown = diagnostics.mainMarkdown || sanitizeInsightMarkdown(content);
    const summarySection = extractSection(fallbackMarkdown, ['Quadro attuale', 'Riassunto clinico']);
    const nextStepsSection = extractSection(fallbackMarkdown, ['Prossimi passi', 'Prossima mossa']);
    const alertsSection = extractSection(fallbackMarkdown, ['Attenzioni', 'Punti di attenzione']);
    const gapsSection = extractSection(fallbackMarkdown, ['Gap da chiarire']);

    return {
        summary: summarySection.replace(/\n+/g, ' ').trim(),
        alerts: parseList(alertsSection),
        nextSteps: parseList(nextStepsSection),
        gaps: parseList(gapsSection),
        fallbackMarkdown,
    };
}

/* @Codex */
export { sanitizeInsightMarkdown } from '@/lib/patient-insight';

/* @Codex */
export async function getAiModelLabels() {
    await ensureTextModelDefaultsUpgraded();
    const modelClinical = await db.settings.get('aiModel_clinical');
    const legacyModel = await db.settings.get('aiModel');
    const modelOcr = await db.settings.get('aiModel_ocr');

    return {
        clinical: resolveTextModel(modelClinical?.value, legacyModel?.value),
        ocr: modelOcr?.value || DEFAULT_OCR_MODEL
    };
}

/* @Codex */
export async function regeneratePatientSummary(
    patientId: string,
    options: SummaryOptions = {}
): Promise<SummaryModelInfo | null> {
    if (!patientId) return null;

    if (inflight.has(patientId)) {
        return inflight.get(patientId) ?? null;
    }

    const task = (async () => {
        const { AIService } = await import('@/lib/ai-service');
        const { buildPatientInsightContext } = await import('@/lib/ai-context');

        const ai = await AIService.create('clinical');
        const info = ai.getModelInfo();
        options.onStage?.('connect', info);

        const patient = await db.patients.get(patientId);
        if (!patient?.version) {
            throw new Error('Missing patient version for summary regeneration.');
        }

        const contextData = await buildPatientInsightContext(patientId);
        options.onStage?.('context', info);

        const prompt = SUMMARY_PROMPT + contextData.prompt;

        options.onStage?.('generate', info);
        const content = await ai.generate(prompt, options.signal, 512);

        const cleaned = finalizePatientInsight({
            content,
            sourceRefs: contextData.sourceRefs,
            limitations: contextData.limitations,
            patientName: contextData.patientName,
        });
        if (!cleaned) {
            throw new Error("L'AI ha generato una risposta vuota o non valida.");
        }

        options.onStage?.('save', info);
        await db.patients.update(patientId, {
            aiSummary: cleaned,
            version: patient.version,
            updatedAt: new Date()
        });

        return info;
    })();

    inflight.set(patientId, task);
    try {
        return await task;
    } finally {
        inflight.delete(patientId);
    }
}
