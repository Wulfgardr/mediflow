import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';

const encryptedFields = createRequire(import.meta.url)('../../lib/backup-encrypted-fields.json') as { entries: string[] };

export async function sealDiaryEntry<T extends Record<string, unknown>>(page: Page, entry: T): Promise<T> {
    return page.evaluate(async ({ entry: plain, fields }) => {
        const stored = JSON.parse(sessionStorage.getItem('mediflow_session_key') ?? 'null') as
            JsonWebKey | { jwk: JsonWebKey } | null;
        if (!stored) throw new Error('Synthetic diary sealing requires an unlocked PIN session in this tab');
        const jwk = 'jwk' in stored ? stored.jwk : stored;
        const key = await crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM' }, false, ['encrypt']);
        const base64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
        const sealed: Record<string, unknown> = { ...plain };
        for (const field of fields) {
            const value = sealed[field];
            if (value === undefined || value === null) continue;
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
            sealed[field] = `ENC:${base64(iv)}:${base64(data)}`;
        }
        return sealed;
    }, { entry, fields: encryptedFields.entries }) as Promise<T>;
}
