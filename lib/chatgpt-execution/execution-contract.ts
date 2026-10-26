export type ExecutionCode = 'unqualified_boundary' | 'session_expired' | 'not_connected' | 'unsupported_account'
    | 'busy' | 'canceled' | 'revoked' | 'quota_exhausted' | 'limits_unavailable' | 'catalog_stale'
    | 'model_unavailable' | 'model_mismatch' | 'invalid_request' | 'invalid_output' | 'tool_use_denied'
    | 'timeout' | 'process_exited' | 'protocol_error' | 'upstream_error';
export class ExecutionError extends Error {
    constructor(readonly code: ExecutionCode, readonly denial: ExecutionDenial | null = null) { super(code); this.name = 'ExecutionError'; }
}
export type SupportedChatGptPlan = 'plus' | 'pro' | 'prolite';
export function isSupportedChatGptPlan(value: unknown): value is SupportedChatGptPlan {
    return value === 'plus' || value === 'pro' || value === 'prolite';
}
export const EXECUTION_METHODS = ['initialize', 'account/login/start', 'account/login/cancel', 'account/read',
    'account/logout', 'model/list', 'account/rateLimits/read', 'config/read', 'thread/start', 'turn/start', 'turn/interrupt'] as const;
export type ExecutionMethod = typeof EXECUTION_METHODS[number];
export type ExecutionDenial = Readonly<{ source: 'limits_snapshot' | 'limits_notice' | 'rpc_error' | 'backend_error';
    method: ExecutionMethod | 'account/rateLimits/updated' | 'error' | 'turn/completed'; rpcCode: number | null;
    backendCode: 'usageLimitExceeded' | null }>;
export function parseExecutionDenial(raw: unknown): ExecutionDenial | null {
    if (raw === null || raw === undefined) return null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_response');
    const value = raw as Record<string, unknown>;
    if (Object.keys(value).length !== 4 || !['limits_snapshot', 'limits_notice', 'rpc_error', 'backend_error'].includes(String(value.source))
        || ![...EXECUTION_METHODS, 'account/rateLimits/updated', 'error', 'turn/completed'].includes(String(value.method))
        || value.rpcCode !== null && (typeof value.rpcCode !== 'number' || !Number.isSafeInteger(value.rpcCode) || value.rpcCode < -32768 || value.rpcCode > -32000)
        || value.backendCode !== null && value.backendCode !== 'usageLimitExceeded') throw new Error('invalid_response');
    return Object.freeze({ source: value.source, method: value.method, rpcCode: value.rpcCode, backendCode: value.backendCode }) as ExecutionDenial;
}

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
