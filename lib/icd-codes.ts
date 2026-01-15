export interface ICDCode {
    code: string;
    description: string;
    system: 'ICD-9' | 'ICD-10' | 'ICD-11';
}

let cachedCodes: ICDCode[] | null = null;
let isLoading = false;

// Preload function
export async function loadICDData() {
    if (cachedCodes) return cachedCodes;
    if (isLoading) {
        // Simple wait loop if already loading
        while (isLoading) await new Promise(r => setTimeout(r, 100));
        return cachedCodes || [];
    }

    try {
        console.log("Fetching ICD Data from /icd-data.json...");
        isLoading = true;
        // Cache busting to ensure we get the file
        const res = await fetch(`/icd-data.json?t=${new Date().getTime()}`);
        if (!res.ok) {
            console.error("Failed to fetch ICD data:", res.status, res.statusText);
            throw new Error("Failed to load ICD data");
        }
        const raw: { c: string, d: string }[] = await res.json();

        cachedCodes = raw.map(item => ({
            code: item.c,
            description: item.d,
            system: 'ICD-9'
        }));
        console.log(`ICD Data loaded: ${cachedCodes.length} codes`);

        // Add common ICD-10 if needed later, for now we only have 9
        // We could merge the old static list if we want specific ICD-10s
    } catch (err) {
        console.error("ICD Load Error", err);
        cachedCodes = [];
    } finally {
        isLoading = false;
    }
    return cachedCodes || [];
}

export async function searchICD(query: string): Promise<ICDCode[]> {
    const codes = await loadICDData();
    if (!query) return [];

    const q = query.toLowerCase();
    // Optimize: if huge, maybe limit? 13k is fine for filter on modern JS engines
    // Cap results at 50
    return codes
        .filter(item => item.code.toLowerCase().startsWith(q) || item.description.toLowerCase().includes(q))
        .slice(0, 50);
}
