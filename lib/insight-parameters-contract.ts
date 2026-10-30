export const INSIGHT_MODES = ['full_auto', 'balanced', 'complete', 'manual'] as const;
export type AIInsightMode = typeof INSIGHT_MODES[number];
export const DOCUMENT_ROUTER_MODES = ['off', 'shadow', 'active'] as const;
export type DocumentRouterControlFlowMode = typeof DOCUMENT_ROUTER_MODES[number];
export const INSIGHT_LIMITS = {
    maxDocuments: [2, 12],
    maxDocumentSummaryChars: [120, 480],
    maxDocumentContextChars: [800, 5000],
    outputMaxTokens: [256, 1200],
} as const;
export function isInsightMode(value: unknown): value is AIInsightMode {
    return INSIGHT_MODES.some(mode => mode === value);
}
export function isDocumentRouterMode(value: unknown): value is DocumentRouterControlFlowMode {
    return DOCUMENT_ROUTER_MODES.some(mode => mode === value);
}
