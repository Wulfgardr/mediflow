/* @Codex */
import { buildDocumentFallbackSummary } from '../../ai-task-contracts';
/* @Codex */
import { assertAiDocumentSynthesisEnabledValue } from '../../ai-document-synthesis-kill-switch';
/* @Codex */
import type { DocumentStructuredAnalysis } from './document-synthesis-parser';
/* @Codex */
import {
    isDeterministicSynthesisRoute,
    type DocumentClassRouterResult,
} from './document-class-router';

export const DOCUMENT_ROUTER_CONTROL_FLOW_SETTING_KEY = 'documentRouterControlFlow';

export type DocumentRouterControlFlowMode = 'off' | 'shadow' | 'active';

export const DEFAULT_DOCUMENT_ROUTER_CONTROL_FLOW_MODE: DocumentRouterControlFlowMode = 'shadow';

export function parseDocumentRouterControlFlowMode(value: unknown): DocumentRouterControlFlowMode {
    return value === 'off' || value === 'shadow' || value === 'active'
        ? value
        : DEFAULT_DOCUMENT_ROUTER_CONTROL_FLOW_MODE;
}

export interface DocumentRouterControlFlowDecision {
    mode: DocumentRouterControlFlowMode;
    wouldSkip: boolean;
    useDeterministicSynthesis: boolean;
}

export function decideDocumentRouterControlFlow(input: {
    documentSynthesisKillSwitchValue: unknown;
    mode: DocumentRouterControlFlowMode;
    routed: Pick<DocumentClassRouterResult, 'classification' | 'confidence'>;
}): DocumentRouterControlFlowDecision {
    assertAiDocumentSynthesisEnabledValue(input.documentSynthesisKillSwitchValue);
    const wouldSkip = isDeterministicSynthesisRoute(input.routed);

    return {
        mode: input.mode,
        wouldSkip,
        useDeterministicSynthesis: input.mode === 'active' && wouldSkip,
    };
}

export function buildDeterministicDocumentSynthesisAnalysis(
    rawMarkdown: string,
    routed: Pick<DocumentClassRouterResult, 'classification' | 'rationale'>,
): DocumentStructuredAnalysis {
    return {
        summary: buildDocumentFallbackSummary(rawMarkdown),
        quality: {
            level: 'yellow',
            reason: `Sintesi deterministica per ${routed.classification}: ${routed.rationale}`,
        },
        medications: [],
        diagnoses: [],
        problemStatements: [],
        therapyCandidates: [],
        servicePrescriptions: [],
    };
}
