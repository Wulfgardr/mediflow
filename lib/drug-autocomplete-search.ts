import type { AifaDrug } from '@/lib/db';
import { isApiTableAuthUnavailableStatus, notifyApiAuthUnavailable } from '@/lib/api-table-response';

const RESULT_LIMIT = 30;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type DrugAutocompleteCatalogState = 'ready' | 'unverified' | 'not-imported';
export type DrugAutocompleteResult = {
    items: AifaDrug[];
    catalogState: DrugAutocompleteCatalogState;
};

/* @Codex WUL-488 */
export async function fetchDrugAutocomplete(
    query: string,
    signal: AbortSignal,
    fetchImpl: FetchLike = fetch,
): Promise<DrugAutocompleteResult> {
    const response = await fetchImpl(`/api/drugs?q=${encodeURIComponent(query.trim())}&limit=${RESULT_LIMIT}`, { signal });
    if (!response.ok) {
        if (isApiTableAuthUnavailableStatus(response.status)) notifyApiAuthUnavailable(response.status);
        throw new Error(`Drug search failed with status ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error('Drug search returned an invalid payload');
    const header = response.headers.get('x-mediflow-aifa-catalog');
    const catalogState: DrugAutocompleteCatalogState = header === 'ready' || header === 'unverified'
        ? header
        : 'not-imported';
    return { items: (payload as AifaDrug[]).slice(0, RESULT_LIMIT), catalogState };
}

/* @Codex WUL-488 */
export function createDrugAutocompleteSearch(fetchImpl: FetchLike = fetch) {
    let revision = 0;
    let activeController: AbortController | null = null;

    return {
        async run(query: string): Promise<DrugAutocompleteResult | null> {
            const currentRevision = ++revision;
            activeController?.abort();
            const controller = new AbortController();
            activeController = controller;

            try {
                const results = await fetchDrugAutocomplete(query, controller.signal, fetchImpl);
                return currentRevision === revision ? results : null;
            } catch (error) {
                if (controller.signal.aborted || currentRevision !== revision) return null;
                throw error;
            }
        },
        abort() {
            revision += 1;
            activeController?.abort();
            activeController = null;
        },
    };
}

/* @Codex WUL-488 */
export function commitDrugAutocompleteQueryChange(
    search: Pick<ReturnType<typeof createDrugAutocompleteSearch>, 'abort'>,
    commit: (value: string) => void,
    value: string,
    afterAbort?: () => void,
) {
    search.abort();
    afterAbort?.();
    commit(value);
}
