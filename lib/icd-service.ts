import { ICDCode, searchICD as searchLegacyICD } from './icd-codes';

// Use our internal proxy to avoid CORS and mixed-content issues
const ICD_PROXY_URL = '/api/icd/proxy';

export interface ICDSearchResult extends ICDCode {
    isLegacy: boolean;
}

export async function searchICDHybrid(query: string): Promise<ICDSearchResult[]> {
    const results: ICDSearchResult[] = [];

    // 1. Try Local WHO API (via Proxy)
    try {
        const apiRes = await fetch(`${ICD_PROXY_URL}?q=${encodeURIComponent(query)}`);

        if (apiRes.ok) {
            const data = await apiRes.json();
            // Map API response to our format
            if (data.destinationEntities) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const apiMatches = data.destinationEntities.map((ent: any) => {
                    // 1. Strip HTML tags from title (e.g. <em class='found'>...</em>)
                    const rawTitle = ent.title ? (typeof ent.title === 'string' ? ent.title : ent.title.value) : '';
                    const cleanDescription = rawTitle.replace(/<[^>]*>?/gm, '');

                    // 2. Extract Code.
                    // Try 'theCode', 'code', 'codeRange'.
                    // If still missing, try to extract from 'linearizationReference' (e.g. .../mms/135352227) which might be the best we have for index terms.
                    let cleanCode = ent.theCode || ent.code || ent.codeRange;

                    if (!cleanCode && ent.linearizationReference) {
                        // Some responses only have a URI. We can't easily get the code without another call, 
                        // but we can at least show it's a valid entity.
                        // Or try to parse the end of the URI if it looks like a code (rare for ICD-11 URIs).
                        // For now, mark as 'N/A' but allow it.
                        cleanCode = 'N/A';
                    }

                    return {
                        code: cleanCode || 'N/A',
                        description: cleanDescription || 'Descrizione assente',
                        system: 'ICD-11',
                        isLegacy: false
                    };
                }); // Filter removed to allow 'N/A' results as per user request
                results.push(...apiMatches);
            }
        }
    } catch (e) {
        // API offline or unreachable, ignore and proceed to legacy
        console.debug("ICD Proxy unavailable", e);
    }

    // 2. Return pure ICD-11 results (Legacy ICD-9 removed as per user request)
    return results;
}

export async function checkApiStatus(): Promise<boolean> {
    try {
        const res = await fetch(ICD_PROXY_URL); // Calls the proxy without query for status check
        return res.ok;
    } catch {
        return false;
    }
}
