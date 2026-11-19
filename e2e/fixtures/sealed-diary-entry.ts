import type { Page } from '@playwright/test';
import encryptedFields from '../../lib/backup-encrypted-fields.json';

export async function diaryEntrySealer(page: Page) {
    return page.evaluateHandle(async fields => {
        const stored = JSON.parse(sessionStorage.getItem('mediflow_session_key') ?? 'null') as
            JsonWebKey | { jwk: JsonWebKey } | null;
        if (!stored) throw new Error('Synthetic diary sealing requires an unlocked PIN session in this tab');
        const jwk = 'jwk' in stored ? stored.jwk : stored;
        const key = await crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM' }, false, ['encrypt']);
        const base64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
        return async (plain: Record<string, unknown>) => {
            const sealed = { ...plain };
            for (const field of fields) {
                const value = sealed[field];
                if (value === undefined || value === null) continue;
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
                sealed[field] = `ENC:${base64(iv)}:${base64(data)}`;
            }
            return sealed;
        };
    }, encryptedFields.entries);
}

export async function sealDiaryEntry<T extends Record<string, unknown>>(page: Page, entry: T): Promise<T> {
    const sealer = await diaryEntrySealer(page);
    try {
        return await sealer.evaluate((seal, value) => seal(value), entry) as T;
    } finally {
        await sealer.dispose();
    }
}
