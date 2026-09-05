/**
 * Legacy Document Synthesis compatibility module.
 * Non e un ingresso production della lane 0.8.5: la UI usa la composition
 * Fabric autenticata e review-only su estrazione AnyDoc host-owned.
 */

import { AIService } from '../../ai-service';
import type {
    DocumentInsight,
} from '../../db';
import { db } from '../../db';
import { v4 as uuid } from 'uuid';
import { buildDocumentSynthesisExtractionPrompt, isEnvelopeUsable } from '../../ai-task-contracts';
import {
    parseStructuredAnalysisResponse,
    type DocumentStructuredAnalysis,
} from './document-synthesis-parser';
import {
    buildDocumentExcerpt,
    buildStoredDocumentExcerpt,
} from './document-excerpt';
/* @Codex */
import { normalizeDocumentInput } from './document-input-normalization';
/* @Codex */
import { routeDocumentClassForSynthesis, type DocumentSynthesisRoutingOptions } from './document-synthesis-routing';
/* @Codex */
import {
    buildDocumentParseEvidenceArtifact,
    projectDocumentEvidencePack,
    type DocumentParseEvidenceArtifact,
} from './document-parse-evidence-artifact';
import {
    AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY,
    assertAiDocumentSynthesisEnabledValue,
} from '../../ai-document-synthesis-kill-switch';
/* @Codex */
import {
    buildDeterministicDocumentSynthesisAnalysis,
    decideDocumentRouterControlFlow,
    DOCUMENT_ROUTER_CONTROL_FLOW_SETTING_KEY,
    parseDocumentRouterControlFlowMode,
} from './document-router-control-flow';
import {
    admitDocumentSynthesisFabric,
    DOCUMENT_SYNTHESIS_FABRIC_METADATA,
    DocumentSynthesisFabricDeniedError,
    getDocumentSynthesisFabricMetadata,
} from './document-synthesis-fabric';

/* @Codex */
const MAX_SYNTHESIS_CHARS = 12000;

/* @Codex */
export interface SynthesizeDocumentOptions extends DocumentSynthesisRoutingOptions {
    attachmentId?: string;
    // @Codex
    sourceBytes?: ArrayBuffer | Uint8Array;
}

/* @Codex */
export interface SynthesizeDocumentResult {
    insight: DocumentInsight;
    parseEvidenceArtifact: DocumentParseEvidenceArtifact;
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
async function recordDocumentRouterShadowDecision(input: {
    classification: string;
    confidence: string;
    wouldSkip: boolean;
}): Promise<void> {
    try {
        const response = await fetch('/api/ai/document-router-audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...input, mode: 'shadow' }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
        // L'audit shadow non deve modificare la pipeline clinica gia esistente.
        console.warn('[DocumentSynthesis] document router shadow audit unavailable', error);
    }
}

/* @Codex */
type DocumentRouterShadowRecorder = typeof recordDocumentRouterShadowDecision;

/* @Codex */
export function dispatchDocumentRouterShadowDecision(
    input: Parameters<DocumentRouterShadowRecorder>[0],
    recorder: DocumentRouterShadowRecorder = recordDocumentRouterShadowDecision,
): void {
    // Telemetria best-effort: una richiesta lenta o pendente non entra mai nel
    // percorso critico della sintesi.
    void recorder(input).catch((error) => {
        console.warn('[DocumentSynthesis] document router shadow audit unavailable', error);
    });
}

/* @Codex */
export async function selectDocumentSynthesisAnalysis(input: {
    rawMarkdown: string;
    normalizedText: string;
    routed: ReturnType<typeof routeDocumentClassForSynthesis>;
    routerMode: ReturnType<typeof parseDocumentRouterControlFlowMode>;
    routerDecision: ReturnType<typeof decideDocumentRouterControlFlow>;
    analyze?: typeof analyzeDocumentContent;
    recordShadow?: DocumentRouterShadowRecorder;
}): Promise<DocumentStructuredAnalysis> {
    if (input.routerMode === 'shadow') {
        dispatchDocumentRouterShadowDecision({
            classification: input.routed.classification,
            confidence: input.routed.confidence,
            wouldSkip: input.routerDecision.wouldSkip,
        }, input.recordShadow);
    }

    return input.routerDecision.useDeterministicSynthesis
        ? buildDeterministicDocumentSynthesisAnalysis(input.normalizedText, input.routed)
        : (input.analyze ?? analyzeDocumentContent)(input.rawMarkdown);
}

/* @Codex */
/**
 * Analyze OCR text without persisting anything.
 */
export async function analyzeDocumentContent(rawMarkdown: string): Promise<DocumentStructuredAnalysis> {
    const documentSynthesisKillSwitch = await db.settings.get(AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY);
    assertAiDocumentSynthesisEnabledValue(documentSynthesisKillSwitch?.value);

    // Ruolo 'reasoning': di default risolve allo stesso modello di 'clinical'
    // (resolveTextModel con fallback), ma permette di instradare la sintesi
    // documentale su un modello dedicato senza toccare patient_insight.
    const ai = await AIService.create('reasoning');
    const normalized = normalizeDocumentInput(rawMarkdown);
    const sliced = buildDocumentExcerpt(normalized.normalizedText, MAX_SYNTHESIS_CHARS);
    const modelInfo = ai.getModelInfo();
    let health: Awaited<ReturnType<typeof ai.getHealth>> | null = null;
    try {
        health = await ai.getHealth();
    } catch {
        health = null;
    }
    const admission = admitDocumentSynthesisFabric({ modelInfo, health });
    if (!admission.admitted) throw new DocumentSynthesisFabricDeniedError(admission.denial);
    const content = await ai.generate(buildDocumentSynthesisExtractionPrompt(sliced), undefined, 1400);
    const analysis = parseStructuredAnalysisResponse(content, normalized.normalizedText);
    // @Codex
    if (!isEnvelopeUsable(analysis)) {
        throw new Error("L'AI ha generato una risposta non valida per l'analisi del documento.");
    }
    Object.defineProperty(analysis, DOCUMENT_SYNTHESIS_FABRIC_METADATA, {
        value: admission.metadata,
        enumerable: false,
    });
    return analysis;
}

/**
 * Synthesize a document and persist review material without writing diagnoses.
 */
export async function synthesizeDocument(
    rawMarkdown: string,
    fileName: string,
    patientId: string,
    options: SynthesizeDocumentOptions = {},
): Promise<SynthesizeDocumentResult> {
    const documentSynthesisKillSwitch = await db.settings.get(AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY);
    assertAiDocumentSynthesisEnabledValue(documentSynthesisKillSwitch?.value);

    const normalized = normalizeDocumentInput(rawMarkdown);
    const routed = routeDocumentClassForSynthesis(rawMarkdown, fileName, { pdfMetadata: options.pdfMetadata });
    const routerControlFlow = await db.settings.get(DOCUMENT_ROUTER_CONTROL_FLOW_SETTING_KEY);
    const routerMode = parseDocumentRouterControlFlowMode(routerControlFlow?.value);
    const routerDecision = decideDocumentRouterControlFlow({
        documentSynthesisKillSwitchValue: documentSynthesisKillSwitch?.value,
        mode: routerMode,
        routed,
        normalizedText: normalized.normalizedText,
    });

    const analysis = await selectDocumentSynthesisAnalysis({
        rawMarkdown,
        normalizedText: normalized.normalizedText,
        routed,
        routerMode,
        routerDecision,
    });

    const patient = await db.patients.get(patientId);
    if (!patient) {
        throw new Error('Paziente non trovato');
    }
    if (typeof patient.version !== 'number') {
        throw new Error('Missing patient version for document synthesis.');
    }
    // @Codex
    if (!routerDecision.useDeterministicSynthesis && !isEnvelopeUsable(analysis)) {
        throw new Error("L'AI ha generato una risposta non valida per la sintesi del documento.");
    }

    const existingInsights = parseExistingInsights(patient.documentInsights);

    const insight: DocumentInsight = {
        id: uuid(),
        attachmentId: options.attachmentId,
        date: new Date(),
        fileName,
        rawMarkdown: buildStoredDocumentExcerpt(normalized.normalizedText),
        summary: analysis.summary,
        quality: analysis.quality,
        extractedData: analysis.diagnoses.length > 0 || analysis.medications.length > 0
            ? {
                ...(analysis.diagnoses.length > 0 ? { diagnoses: analysis.diagnoses } : {}),
                ...(analysis.medications.length > 0 ? { medications: analysis.medications } : {}),
            }
            : undefined,
        routedClass: {
            classification: routed.classification,
            confidence: routed.confidence,
            ...(routerDecision.useDeterministicSynthesis
                ? { synthesis: { kind: 'deterministic' as const, rationale: routed.rationale } }
                : {}),
        },
        ...(routed.documentDate ? { documentDate: routed.documentDate } : {}),
    };

    const parseEvidenceArtifact = buildDocumentParseEvidenceArtifact({
        documentInsightId: insight.id,
        attachmentId: options.attachmentId,
        fileName: insight.fileName,
        documentDate: insight.date.toISOString(),
        qualityLevel: insight.quality?.level,
        qualityReason: insight.quality?.reason,
        summary: insight.summary,
        rawMarkdown: insight.rawMarkdown,
        diagnoses: analysis.diagnoses,
        medications: analysis.medications,
    });
    insight.evidencePack = projectDocumentEvidencePack(parseEvidenceArtifact);

    existingInsights.unshift(insight);
    const nextInsights = existingInsights.slice(0, 3);

    await db.patients.update(patientId, {
        documentInsights: nextInsights,
        version: patient.version,
        updatedAt: new Date()
    });

    const result = {
        insight,
        parseEvidenceArtifact,
    };
    const metadata = getDocumentSynthesisFabricMetadata(analysis);
    if (metadata) {
        Object.defineProperty(result, DOCUMENT_SYNTHESIS_FABRIC_METADATA, {
            value: metadata,
            enumerable: false,
        });
    }
    return result;
}

/**
 * Get document insights for a patient.
 */
export async function getDocumentInsights(patientId: string): Promise<DocumentInsight[]> {
    const patient = await db.patients.get(patientId);
    return parseExistingInsights(patient?.documentInsights);
}
