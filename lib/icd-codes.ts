export interface ICDCode {
    code: string;
    description: string;
    system: string;
}

// Legacy local loader removed in favor of ICD-11 Proxy
export async function loadICDData() {
    return [];
}

export async function searchICD(query: string): Promise<ICDCode[]> {
    return [];
}
