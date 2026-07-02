/* @Codex */
'use client';

import {
    buildPatientInsightExtractionPrompt,
    parsePatientInsightExtractionResponse,
    renderPatientInsightMarkdown,
    toPatientInsightRenderContract,
} from '@/lib/ai-task-contracts';
import { db } from '@/lib/db';
import { DEFAULT_OCR_MODEL, ensureTextModelDefaultsUpgraded, resolveTextModel } from '@/lib/ai-models';
/* @Codex */
import {
    sanitizeInsightMarkdown,
    splitInsightDiagnostics,
    finalizePatientInsight,
} from '@/lib/patient-insight';
import {
    AI_PATIENT_INSIGHT_KILL_SWITCH_KEY,
    AiPatientInsightDisabledError,
    assertAiPatientInsightEnabledValue,
} from '@/lib/ai-patient-insight-kill-switch';

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

/* @Codex */
export type PatientSummaryRefreshResult =
    | { status: 'updated'; modelInfo: SummaryModelInfo }
    | { status: 'skipped'; reason: 'missing-patient-id' | 'disabled' | 'already-running' };

const inflight = new Map<string, Promise<SummaryModelInfo | null>>();
// Coalescing di burst (es. upload multiplo): se arriva una richiesta mentre una
// generazione e in corso, si segna un rerun in coda che parte una sola volta al
// termine, cosi lo stato finale del burst viene comunque catturato senza N run.
const pendingRerun = new Set<string>();

/* @Codex */
export function isSummaryGenerationInFlight(patientId: string): boolean {
    return inflight.has(patientId);
}

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

function hasInsightContractContent(content: ReturnType<typeof parsePatientInsightExtractionResponse>): boolean {
    return content.value.data.currentState.length > 0
        || content.value.data.alerts.length > 0
        || content.value.data.nextSteps.length > 0
        || content.value.data.gaps.length > 0;
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
        // Una generazione e gia in corso: segna un rerun in coda (cattura lo stato
        // finale del burst) e restituisci il risultato della run corrente.
        pendingRerun.add(patientId);
        return inflight.get(patientId) ?? null;
    }

    const task = (async () => {
        const { AIService } = await import('@/lib/ai-service');
        const { buildPatientInsightContext } = await import('@/lib/ai-context');

        const patientInsightKillSwitch = await db.settings.get(AI_PATIENT_INSIGHT_KILL_SWITCH_KEY);
        assertAiPatientInsightEnabledValue(patientInsightKillSwitch?.value);

        const ai = await AIService.create('clinical');
        const info = ai.getModelInfo();
        options.onStage?.('connect', info);

        const patient = await db.patients.get(patientId);
        if (!patient?.version) {
            throw new Error('Missing patient version for summary regeneration.');
        }

        const contextData = await buildPatientInsightContext(patientId);
        options.onStage?.('context', info);

        const prompt = buildPatientInsightExtractionPrompt(contextData.prompt);

        options.onStage?.('generate', info);
        const content = await ai.generate(prompt, options.signal, contextData.outputMaxTokens);
        const extracted = parsePatientInsightExtractionResponse(content);
        const draftMarkdown = hasInsightContractContent(extracted)
            ? renderPatientInsightMarkdown(toPatientInsightRenderContract(extracted.value))
            : sanitizeInsightMarkdown(content);

        const cleaned = finalizePatientInsight({
            content: draftMarkdown,
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
        if (pendingRerun.has(patientId)) {
            pendingRerun.delete(patientId);
            // Rerun trailing senza options (no onStage/signal della run originale,
            // gia conclusa) e senza bloccare il chiamante; errori ignorati perche
            // e un aggiornamento best-effort a valle del burst.
            void regeneratePatientSummary(patientId).catch(() => {});
        }
    }
}

/* @Codex */
export async function refreshPatientSummaryIfEnabled(
    patientId: string,
    options: SummaryOptions = {}
): Promise<PatientSummaryRefreshResult> {
    if (!patientId) {
        return { status: 'skipped', reason: 'missing-patient-id' };
    }

    // Osservabilita: se una generazione e gia in corso questa richiesta vi si
    // aggancia (e lascia in coda un rerun trailing), quindi non e una nuova run.
    const joinedInFlight = isSummaryGenerationInFlight(patientId);

    try {
        const modelInfo = await regeneratePatientSummary(patientId, options);
        if (!modelInfo) {
            return { status: 'skipped', reason: 'missing-patient-id' };
        }
        if (joinedInFlight) {
            return { status: 'skipped', reason: 'already-running' };
        }
        return { status: 'updated', modelInfo };
    } catch (error) {
        if (error instanceof AiPatientInsightDisabledError) {
            return { status: 'skipped', reason: 'disabled' };
        }
        throw error;
    }
}
