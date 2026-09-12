/* @Codex */
export type ExecutionCode = 'unqualified_boundary' | 'session_expired' | 'not_connected' | 'unsupported_account'
    | 'busy' | 'canceled' | 'revoked' | 'quota_exhausted' | 'limits_unavailable' | 'catalog_stale'
    | 'model_unavailable' | 'model_mismatch' | 'invalid_request' | 'invalid_output' | 'tool_use_denied'
    | 'timeout' | 'process_exited' | 'protocol_error' | 'upstream_error';
export class ExecutionError extends Error {
    constructor(readonly code: ExecutionCode) { super(code); this.name = 'ExecutionError'; }
}
export const EXECUTION_METHODS = ['initialize', 'account/login/start', 'account/login/cancel', 'account/read',
    'account/logout', 'model/list', 'account/rateLimits/read', 'config/read', 'thread/start', 'turn/start', 'turn/interrupt'] as const;
export type ExecutionMethod = typeof EXECUTION_METHODS[number];
export type ExecutionDrainObservation = Readonly<{
    closing: boolean; leaderExited: boolean; ownedGroupCeased: boolean | null; ownedTreeCeased?: boolean | null;
}>;
export interface ExecutionTransport {
    request(method: ExecutionMethod, params?: unknown): Promise<unknown>;
    initialized(): void;
    /** Same-process, one-use authentic bootstrap response; NOT an authority.
     * Prepared Mac transports have already sent initialize/initialized account-free. */
    takeInitializationObservation?(): unknown;
    subscribe(notification: (method: string, params: unknown) => void, failure: (code: ExecutionCode) => void): () => void;
    close(): Promise<boolean>;
    drainObservation?(): ExecutionDrainObservation;
}
export type SynthesisSource = Readonly<{ id: string; title: string; text: string; sha256: string }>;
export type SynthesisInput = Readonly<{ fixtureId: string; sources: readonly SynthesisSource[] }>;
export type ModelEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
export type SynthesisChoice = Readonly<{ optionId: string; model: string; effort: ModelEffort }>;
export type SynthesisCatalog = Readonly<{ revision: string; choices: readonly SynthesisChoice[] }>;
export type SynthesisRequest = Readonly<{ modelOptionId: string; expectedCatalogRevision: string }>;
export type SynthesisResult = Readonly<{
    status: 'completed'; proposalOnly: true; clinicalWrites: 0; dataClass: 'synthetic_fixture';
    summary: string; explanation: string;
    citations: readonly Readonly<{ sourceId: string; quote: string; sourceSha256: string }>[];
    sources: readonly SynthesisSource[];
    provenance: Readonly<{ provider: 'openai'; channel: 'codex_app_server'; authentication: 'chatgpt_subscription';
        model: string; effort: ModelEffort; requestedServiceTier: 'priority'; observedServiceTier: string | null;
        fallback: 'none'; fixtureId: string; inputSha256: string; outputSha256: string }>;
}>;
