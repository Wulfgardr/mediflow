import {
    type AifaCatalogManifest,
    type AifaCatalogManifestInput,
} from './aifa-catalog';

export type AifaCatalogClientStatus = {
    count: number;
    manifest: AifaCatalogManifest | null;
    state: 'ready' | 'unverified' | 'not-imported';
};

export type AifaImportClientResult = AifaCatalogClientStatus & {
    rejectedRecords: number;
    totalRecords: number;
};

/* @Codex */
export async function importAifaCsv(
    file: File,
    manifest: AifaCatalogManifestInput,
): Promise<AifaImportClientResult> {
    const form = new FormData();
    form.set('file', file);
    form.set('sourceUrl', manifest.sourceUrl);
    form.set('downloadedAt', manifest.downloadedAt);
    form.set('version', manifest.version);
    const response = await fetch('/api/drugs', { method: 'POST', body: form });
    const payload = await response.json().catch(() => null) as AifaImportClientResult | { error?: string } | null;
    if (!response.ok) {
        throw new Error(payload && 'error' in payload && payload.error
            ? payload.error
            : 'Importazione AIFA non riuscita');
    }
    return payload as AifaImportClientResult;
}

export async function clearDrugDatabase(): Promise<void> {
    const response = await fetch('/api/drugs', { method: 'DELETE' });
    if (!response.ok) throw new Error('Svuotamento catalogo AIFA non riuscito');
}

export async function getDrugCatalogStatus(): Promise<AifaCatalogClientStatus> {
    const response = await fetch('/api/drugs?count=1', { cache: 'no-store' });
    if (!response.ok) throw new Error('Lettura stato catalogo AIFA non riuscita');
    return response.json() as Promise<AifaCatalogClientStatus>;
}

export async function getDrugStats(): Promise<number> {
    return (await getDrugCatalogStatus()).count;
}
