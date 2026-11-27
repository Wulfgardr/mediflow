export const DOSSIER_BATCH_LIMIT = 500;
export const DOSSIER_BATCH_DIGEST = /^[0-9a-f]{64}$/u;

export type DossierBatchIdentity = Readonly<{
    firstName: string; lastName: string; taxCode: string; birthDate: string;
}>;

export type DossierBatchRow = Readonly<{
    sourceName: string;
    sourceDigest: string;
    identity: DossierBatchIdentity;
}>;

export function isDossierBatchRow(value: unknown): value is DossierBatchRow {
    if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'identity,sourceDigest,sourceName') return false;
    const { identity, sourceDigest, sourceName } = value as DossierBatchRow;
    return typeof sourceName === 'string' && sourceName.length > 0 && sourceName.length <= 1024
        && typeof sourceDigest === 'string' && DOSSIER_BATCH_DIGEST.test(sourceDigest)
        && Boolean(identity && typeof identity === 'object' && Object.keys(identity).sort().join(',') === 'birthDate,firstName,lastName,taxCode'
            && Object.values(identity).every(field => typeof field === 'string' && field.length <= 256));
}

async function digest(value: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    try {
        const result = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
    } finally { bytes.fill(0); }
}

export function dossierBatchRowDigest({ sourceName, sourceDigest, identity }: DossierBatchRow): Promise<string> {
    return digest(['dossier-patient-v1', sourceName, sourceDigest, identity.firstName, identity.lastName, identity.taxCode, identity.birthDate]);
}

export function dossierBatchDigest(rows: readonly string[]): Promise<string> {
    return digest(['dossier-batch-v1', rows]);
}
