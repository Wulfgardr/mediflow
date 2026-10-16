import { and, eq } from 'drizzle-orm';
import { dbServer } from './db-server';
import { settings } from './schema';
import { getAifaCatalogStatus } from './aifa-catalog-server';
import { acquireAifaCatalogOperation, AifaUpdateError } from './aifa-catalog-lock';
import { aifaSourceMetadata } from './aifa-catalog';
import { AIFA_NETWORK_SETTING_KEY, AIFA_REMOTE_SETTING_KEY, AIFA_SOURCE_CHECK_INTERVAL_MS,
    compareAifaSource, readAifaSource, type AifaRemoteState } from './aifa-catalog-source';

function readStoredRemote(): AifaRemoteState {
    const raw = dbServer.select().from(settings).where(eq(settings.key, AIFA_REMOTE_SETTING_KEY)).get()?.value;
    try {
        const value = JSON.parse(raw ?? 'null');
        if (!value || !['available', 'unchanged', 'unavailable'].includes(value.outcome)
            || !Number.isFinite(Date.parse(value.checkedAt))) throw new Error('invalid');
        const metadata = aifaSourceMetadata(new Headers({ ...(value.etag ? { etag: value.etag } : {}),
            ...(value.lastModified ? { 'last-modified': value.lastModified } : {}),
            ...(value.contentLength !== undefined ? { 'content-length': String(value.contentLength) } : {}) }));
        return { ...metadata,
            checkedAt: value.checkedAt, outcome: value.outcome !== 'unavailable' && !metadata.etag && !metadata.lastModified ? 'unavailable' : value.outcome, reason: value.reason };
    } catch { return { checkedAt: null, outcome: 'unavailable' }; }
}

export function aifaNetworkPreference(): boolean {
    return dbServer.select().from(settings).where(eq(settings.key, AIFA_NETWORK_SETTING_KEY)).get()?.value === 'enabled';
}

export function assertAifaNetworkAllowed(): void {
    if (!aifaNetworkPreference() || (process.env.MEDIFLOW_NETWORK_DISABLED !== undefined && process.env.MEDIFLOW_NETWORK_DISABLED !== '0')) {
        throw new AifaUpdateError('Accesso Internet AIFA disattivato. Puoi caricare un CSV locale.', 403);
    }
}

export async function getAifaSourceStatus() {
    const catalog = await getAifaCatalogStatus();
    const preference = aifaNetworkPreference();
    let allowed = false;
    try { assertAifaNetworkAllowed(); allowed = true; } catch { /* Fail closed. */ }
    const stored = readStoredRemote();
    const remote: AifaRemoteState = allowed ? compareAifaSource(stored, catalog.manifest, catalog.count)
        : { ...stored, outcome: 'unavailable', reason: 'network_disabled' };
    return { catalog, remote, networkAllowed: allowed, networkPreference: preference };
}

export async function checkAifaSource(signal: AbortSignal, assertCurrent: () => void, transport: typeof fetch = fetch) {
    assertCurrent();
    try { assertAifaNetworkAllowed(); } catch { return getAifaSourceStatus(); }
    let release: () => void;
    try { release = acquireAifaCatalogOperation(); }
    catch { const status = await getAifaSourceStatus(); return { ...status, remote: { ...status.remote, outcome: 'unavailable' as const, reason: 'busy' as const } }; }
    try {
        const previous = readStoredRemote();
        const checkedAt = new Date().toISOString();
        const claimValue = JSON.stringify({ ...previous, checkedAt, outcome: 'unavailable', reason: 'checking' });
        const claimed = dbServer.transaction(tx => {
            assertCurrent();
            const stored = readStoredRemote();
            if (stored.checkedAt && Date.now() - Date.parse(stored.checkedAt) < AIFA_SOURCE_CHECK_INTERVAL_MS) return false;
            tx.insert(settings).values({ key: AIFA_REMOTE_SETTING_KEY, value: claimValue })
                .onConflictDoUpdate({ target: settings.key, set: { value: claimValue } }).run();
            return true;
        }, { behavior: 'immediate' });
        if (!claimed) return getAifaSourceStatus();
        let remote: AifaRemoteState;
        try {
            assertAifaNetworkAllowed();
            const metadata = await readAifaSource(previous, signal, transport);
            assertCurrent();
            assertAifaNetworkAllowed();
            const catalog = await getAifaCatalogStatus();
            remote = compareAifaSource({ ...metadata, checkedAt, outcome: 'unchanged' }, catalog.manifest, catalog.count);
        } catch {
            remote = { ...previous, checkedAt, outcome: 'unavailable', reason: 'source_unavailable' };
        }
        assertCurrent();
        dbServer.transaction(tx => {
            assertCurrent();
            tx.update(settings).set({ value: JSON.stringify(remote) })
                .where(and(eq(settings.key, AIFA_REMOTE_SETTING_KEY), eq(settings.value, claimValue))).run();
        }, { behavior: 'immediate' });
        return getAifaSourceStatus();
    } finally { release(); }
}
