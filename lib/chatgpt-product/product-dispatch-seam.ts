/* @Codex — no shared TR/preferences/dispatch mutation. Browser-safe metadata. */
import type { SynthesisRequest } from '../chatgpt-execution/execution-contract';
import { ProductError, type ProductSnapshot } from './product-contract';
export const CHATGPT_PRODUCT_ENTRY = Object.freeze({
    href: '/settings/ai/chatgpt', label: 'OpenAI · sintesi DEMO', experience: 'synthetic_synthesis',
    sharedClinicalPicker: 'excluded', clinicalAdmission: 'held', persistence: 'none',
} as const);
/** Read model/effort only from the exact execution-process catalog. Not admission. */
export function selectProductOption(snapshot: ProductSnapshot, optionId: string): SynthesisRequest {
    if (snapshot.state !== 'ready' || snapshot.qualification.state !== 'qualified' || !snapshot.catalog
        || !snapshot.catalog.choices.some(choice => choice.optionId === optionId)) throw new ProductError('catalog_stale');
    return Object.freeze({ modelOptionId: optionId, expectedCatalogRevision: snapshot.catalog.revision });
}
/** Future HOST-only contract outline. Not serializable UI input or a data loader. */
export type FutureHostSourceSelection = Readonly<{
    selectionRevision: string; sourceIdsAndDigests: readonly Readonly<{ sourceId: string; sha256: string }>[];
    dataGovernanceDecisionId: string; current(): boolean;
}>;
export function admitClinicalChatGptContext(selection: FutureHostSourceSelection): never {
    // The future contract is deliberately not invoked or treated as admission.
    void selection;
    throw new ProductError('unqualified_boundary');
}
