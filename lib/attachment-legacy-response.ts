import 'server-only';
import { types } from 'node:util';

/* @Codex */
const LEGACY_ATTACHMENT_CURRENTNESS_KEYS = new Set([
    'documentSourceRef',
    'documentRevision',
    'documentFreshnessEpoch',
]);

/* @Codex */
type LegacyAttachmentCurrentnessKey =
    | 'documentSourceRef'
    | 'documentRevision'
    | 'documentFreshnessEpoch';

/* @Codex */
export function createLegacyAttachmentResponseSnapshot<T extends object>(
    row: T,
): Readonly<Omit<T, LegacyAttachmentCurrentnessKey>> | null {
    if (types.isProxy(row)) return null;

    try {
        if (Object.getPrototypeOf(row) !== Object.prototype) return null;
        if (Object.getOwnPropertySymbols(row).length > 0) return null;

        const sourceDescriptors = Object.getOwnPropertyDescriptors(row);
        const snapshotDescriptors: PropertyDescriptorMap = Object.create(null) as PropertyDescriptorMap;

        for (const [key, descriptor] of Object.entries(sourceDescriptors)) {
            if (!('value' in descriptor)) return null;
            if (!LEGACY_ATTACHMENT_CURRENTNESS_KEYS.has(key)) {
                snapshotDescriptors[key] = descriptor;
            }
        }

        return Object.freeze(Object.defineProperties({}, snapshotDescriptors)) as Readonly<Omit<T, LegacyAttachmentCurrentnessKey>>;
    } catch {
        return null;
    }
}
