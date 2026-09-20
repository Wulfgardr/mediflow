/* @Codex — browser-safe. No host, account secret or caller corpus in these DTOs. */
import type { SynthesisCatalog, SynthesisRequest, SynthesisResult, SynthesisSource, ExecutionCode } from '../chatgpt-execution/execution-contract';
export const PRODUCT_NAMESPACE = '/api/settings/ai/chatgpt/synthesis/' as const;
export const PRODUCT_OPERATION = 'synthetic_synthesis' as const;
export const PRODUCT_DATA_CLASS = 'synthetic_fixture' as const;
export const PRODUCT_MUTATIONS = ['prepare', 'consent', 'login/start', 'login/complete', 'login/cancel', 'read', 'models', 'generate', 'cancel', 'logout'] as const;
export type ProductMutation = typeof PRODUCT_MUTATIONS[number];
export type ProductOperation = ProductMutation | 'status';
export type ProductCode = ExecutionCode | 'consent_required' | 'consent_stale' | 'invalid_state' | 'login_pending'
    | 'login_failed' | 'login_expired' | 'logout_unconfirmed' | 'unauthorized' | 'forbidden' | 'method_not_allowed' | 'preparation_unavailable';
export class ProductError extends Error {
    constructor(readonly code: ProductCode) { super(code); this.name = 'ProductError'; }
}
export type ProductState = 'preparing' | 'held' | 'needs_consent' | 'consented' | 'starting' | 'awaiting_login' | 'verifying'
    | 'connected' | 'ready' | 'generating' | 'completed' | 'canceled' | 'error';
export type QualificationSnapshot = Readonly<{
    platform: string; state: 'unqualified' | 'unsupported' | 'qualified'; revision: string;
    missing: readonly string[];
}>;
export type ProductDisclosure = Readonly<{
    revision: string; operation: typeof PRODUCT_OPERATION; dataClass: typeof PRODUCT_DATA_CLASS;
    fixtureId: string; inputSha256: string; sources: readonly SynthesisSource[];
    egress: readonly ['auth.openai.com:443', 'chatgpt.com:443'];
    maximumDurationMs: 300000; proposalOnly: true; clinicalWrites: 0;
}>;
export type ConsentRequest = Readonly<{
    operation: typeof PRODUCT_OPERATION; dataClass: typeof PRODUCT_DATA_CLASS; expectedDisclosureRevision: string;
}>;
export type ProductRequest = ConsentRequest | SynthesisRequest | Readonly<Record<string, never>>;
export type Observation = 'not_observed' | 'confirmed' | 'unconfirmed';
export type ProductReceipt = Readonly<{
    localAuthorityWithdrawn: boolean; interruption: 'not_attempted' | 'attempted' | 'acknowledged';
    egressWithdrawalRequested: boolean; leaderExit: Observation; ownedGroupCessation: Observation;
    escapedDescendants: 'not_attested'; cleanup: Observation;
    remoteLogout: 'not_attempted' | 'confirmed' | 'unconfirmed';
    globalRemoteRevocation: 'not_claimed'; secureErase: 'not_claimed'; quotaRefund: 'not_claimed';
}>;
export type ProductLimits = Readonly<{ primaryUsedPercent: number | null; secondaryUsedPercent: number | null }>;
export type ProductPreparation = Readonly<{
    state: 'not_prepared' | 'preparing' | 'ready' | 'in_use' | 'closing' | 'closed' | 'blocked';
    expiresAt: number | null;
}>;
export type ProductSnapshot = Readonly<{
    schema: 'mediflow.chatgpt-product.v1'; state: ProductState; notice: ProductCode | null;
    preparation: ProductPreparation;
    contextRevision: string; qualification: QualificationSnapshot; disclosure: ProductDisclosure;
    authenticatedProcess: 'none' | 'dedicated_execution'; accountControlAdmitsExecution: false;
    plan: 'plus' | 'pro' | null; consentExpiresAt: number | null; loginExpiresAt: number | null;
    catalog: SynthesisCatalog | null; limits: ProductLimits | null; result: SynthesisResult | null;
    receipt: ProductReceipt; clinicalAdmission: 'held'; manualGenerationOnly: true;
}>;
export type ProductLoginChallenge = Readonly<{ verificationUrl: string; userCode: string }>;
export type ProductResponse = Readonly<{ snapshot: ProductSnapshot; login?: ProductLoginChallenge }>;
export type ProductHttpError = Readonly<{ error: ProductCode; clinicalAdmission: 'held' }>;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
export function parseProductRequest(operation: ProductOperation, raw: unknown): ProductRequest {
    if (operation !== 'status' && !(PRODUCT_MUTATIONS as readonly string[]).includes(operation)) throw new ProductError('invalid_request');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ProductError('invalid_request');
    const value = raw as Record<string, unknown>;
    const keys = Object.keys(value);
    if (operation === 'consent') {
        if (keys.length !== 3 || !['operation', 'dataClass', 'expectedDisclosureRevision'].every(key => Object.hasOwn(value, key)) || value.operation !== PRODUCT_OPERATION || value.dataClass !== PRODUCT_DATA_CLASS || !uuid(value.expectedDisclosureRevision)) throw new ProductError('invalid_request');
        return Object.freeze({ operation: PRODUCT_OPERATION, dataClass: PRODUCT_DATA_CLASS, expectedDisclosureRevision: value.expectedDisclosureRevision });
    }
    if (operation === 'generate') {
        if (keys.length !== 2 || !['modelOptionId', 'expectedCatalogRevision'].every(key => Object.hasOwn(value, key)) || !uuid(value.modelOptionId) || !uuid(value.expectedCatalogRevision)) throw new ProductError('invalid_request');
        return Object.freeze({ modelOptionId: value.modelOptionId, expectedCatalogRevision: value.expectedCatalogRevision });
    }
    if (keys.length) throw new ProductError('invalid_request');
    return Object.freeze({});
}
export function emptyReceipt(): ProductReceipt {
    return Object.freeze({ localAuthorityWithdrawn: false, interruption: 'not_attempted', egressWithdrawalRequested: false,
        leaderExit: 'not_observed', ownedGroupCessation: 'not_observed', escapedDescendants: 'not_attested', cleanup: 'not_observed',
        remoteLogout: 'not_attempted', globalRemoteRevocation: 'not_claimed', secureErase: 'not_claimed', quotaRefund: 'not_claimed' });
}

/** Separate ordinary disclosure. Never placed in the account/DEMO snapshot. */
export type OrdinaryContentDisclosure = Readonly<{
    schema: 'mediflow.chatgpt-ordinary-disclosure.v1'; revision: string;
    operation: 'patient_insight' | 'smart_import' | 'document_synthesis' | 'treatment_reasoning';
    profileVersion: 'mediflow.ordinary-redacted-profile.v1';
    contextRevision: string; attemptRevision: string; qualificationRevision: string;
    sourceSha256: string; payloadSha256: string; payloadBytes: number;
    egress: readonly ['auth.openai.com:443', 'chatgpt.com:443'];
    proposalOnly: true; clinicalWrites: 0;
}>;
export type OrdinaryConsentRequest = Readonly<{ operation: OrdinaryContentDisclosure['operation']; expectedDisclosureRevision: string }>;
export function parseOrdinaryConsentRequest(raw: unknown): OrdinaryConsentRequest {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ProductError('invalid_request');
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(descriptors).length !== 2) throw new ProductError('invalid_request');
    const operation = descriptors.operation, revision = descriptors.expectedDisclosureRevision;
    if (!operation || !revision || !('value' in operation) || !('value' in revision) || !uuid(revision.value)
        || !['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'].includes(operation.value)) throw new ProductError('invalid_request');
    return Object.freeze({ operation: operation.value, expectedDisclosureRevision: revision.value });
}
