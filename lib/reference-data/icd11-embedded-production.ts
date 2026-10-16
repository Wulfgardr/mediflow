import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { resolveDataPath } from '../data-dir';
import { createWhoCatalogStore, type WhoCatalogStore } from './icd11-embedded-store';
import { parseWhoTabulation, WHO_CATALOG_MAX_BYTES, WhoCatalogError } from './icd11-embedded-parser';

let store: WhoCatalogStore | undefined;
let bundleInvalid = false;
export const whoCatalogEnabled = () => process.env.MEDIFLOW_ICD_EMBEDDED_DISABLED !== '1';
export function getWhoCatalogStore(): WhoCatalogStore {
    if (store) return store;
    if (process.env.NEXT_PHASE === 'phase-production-build') return createWhoCatalogStore(':memory:');
    store = createWhoCatalogStore(resolveDataPath('icd11-catalog.sqlite'));
    bundleInvalid = bootstrapWhoCatalogBundle(store, path.join(process.cwd(), 'assets', 'reference-data', 'icd11'), whoCatalogEnabled()) === 'unverified';
    store.status();
    return store;
}
export function getWhoCatalogStatus() {
    const status = getWhoCatalogStore().status();
    return { ...status, enabled: whoCatalogEnabled(), state: bundleInvalid && status.state === 'absent' ? 'unverified' as const : status.state };
}

export function bootstrapWhoCatalogBundle(store: WhoCatalogStore, root: string, enabled: boolean): 'absent' | 'verified' | 'unverified' {
    const zip = path.join(root, 'catalog.zip'), manifestPath = path.join(root, 'manifest.json');
    if (!fs.existsSync(zip) && !fs.existsSync(manifestPath)) return 'absent';
    try {
        if (fs.statSync(zip).size > WHO_CATALOG_MAX_BYTES || fs.statSync(manifestPath).size > 4096) throw new WhoCatalogError('Asset WHO oltre il limite');
        const bytes = fs.readFileSync(zip), manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        parseWhoTabulation(bytes, manifest);
        const current = store.status();
        if (current.state === 'absent' && enabled) {
            const preview = store.stage(bytes, current.revision, () => undefined, 'bundle', manifest);
            store.activate(preview.previewId, current.revision, () => undefined, 'bundle');
        }
        return 'verified';
    } catch { return 'unverified'; }
}
