/* @Codex — DEMO metadata and legacy non-authority trap. Ordinary functions use the authenticated named flow. */
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
/** Legacy outline, deliberately NOT a grant API. Ordinary acquisition uses original application owners. */
export type FutureHostSourceSelection = Readonly<{
    selectionRevision: string; sourceIdsAndDigests: readonly Readonly<{ sourceId: string; sha256: string }>[];
    dataGovernanceDecisionId: string; current(): boolean;
}>;
export function admitClinicalChatGptContext(selection: FutureHostSourceSelection): never {
    // IDs/hashes/callbacks are not owners. This trap is not used by the ordinary route.
    void selection;
    throw new ProductError('unqualified_boundary');
}
