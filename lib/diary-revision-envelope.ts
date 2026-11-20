import { decodeBase64, encodeBase64 } from './security/attachment-file-envelope.ts';

export const DIARY_REVISION_PREFIX = 'ENCD1:';
export const LEGACY_REVISION_REQUIRED = 'ENTRY_LEGACY_REVISION_REQUIRED';
export const LEGACY_REVISION_MESSAGE = 'Per conservare il testo precedente, apri l’archivio con un client locale aggiornato e riprova.';

export type DiaryRevisionBinding = { patientId: string; entryId: string; version: number };
export type DiaryRevisionField = 'title' | 'content';
export type LegacyRevisionProtection = DiaryRevisionBinding & { key: string; wrapIv: string; wrappedKey: string };

export function diaryRevisionAad(binding: DiaryRevisionBinding, field?: DiaryRevisionField) {
    const { patientId, entryId, version } = binding;
    const domain = field ? 'mediflow.diary.revision.data.v1' : 'mediflow.diary.revision.key.v1';
    return new TextEncoder().encode(JSON.stringify([domain, patientId, entryId, version, ...(field ? [field] : [])]));
}

const base64 = /^[A-Za-z0-9+/]+={0,2}$/;
function hasSize(value: unknown, length: number): value is string {
    return typeof value === 'string' && value.length === Math.ceil(length / 3) * 4 && base64.test(value)
        && decodeBase64(value).length === length;
}

export function parseLegacyRevisionProtection(value: unknown): LegacyRevisionProtection | undefined {
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    try {
        if (Object.keys(item).length === 6 && typeof item.patientId === 'string' && typeof item.entryId === 'string'
            && typeof item.version === 'number' && Number.isSafeInteger(item.version) && item.version > 0
            && hasSize(item.key, 32) && hasSize(item.wrapIv, 12) && hasSize(item.wrappedKey, 48)) {
            return { patientId: item.patientId, entryId: item.entryId, version: item.version, key: item.key, wrapIv: item.wrapIv, wrappedKey: item.wrappedKey };
        }
    } catch { return; }
}

export function isDiaryRevisionEnvelope(value: unknown): value is string {
    if (typeof value !== 'string' || !value.startsWith(DIARY_REVISION_PREFIX)) return false;
    const [, wrapIv, wrappedKey, iv, data, extra] = value.split(':');
    try {
        return extra === undefined && hasSize(wrapIv, 12) && hasSize(wrappedKey, 48) && hasSize(iv, 12)
            && typeof data === 'string' && data.length >= 24 && data.length % 4 === 0 && base64.test(data);
    } catch { return false; }
}

export async function prepareLegacyRevisionProtection(binding: DiaryRevisionBinding, master: CryptoKey): Promise<LegacyRevisionProtection> {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    try {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const params = { name: 'AES-GCM', iv, additionalData: diaryRevisionAad(binding) };
        const wrapped = await crypto.subtle.encrypt(params, master, raw);
        const reopened = new Uint8Array(await crypto.subtle.decrypt(params, master, wrapped));
        try {
            if (reopened.length !== raw.length || !reopened.every((byte, index) => byte === raw[index])) {
                throw new Error(LEGACY_REVISION_MESSAGE);
            }
            return { ...binding, key: encodeBase64(raw), wrapIv: encodeBase64(iv),
                wrappedKey: encodeBase64(new Uint8Array(wrapped)) };
        } finally { reopened.fill(0); }
    } finally { raw.fill(0); }
}

export async function openLegacyDiaryRevision(value: string, binding: DiaryRevisionBinding, field: DiaryRevisionField, master: CryptoKey): Promise<string> {
    if (!isDiaryRevisionEnvelope(value)) throw new Error('Invalid diary revision envelope');
    const [, wrapIv, wrappedKey, iv, data] = value.split(':');
    const raw = new Uint8Array(await crypto.subtle.decrypt({
        name: 'AES-GCM', iv: decodeBase64(wrapIv), additionalData: diaryRevisionAad(binding),
    }, master, decodeBase64(wrappedKey)));
    try {
        const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
        const opened = new Uint8Array(await crypto.subtle.decrypt({
            name: 'AES-GCM', iv: decodeBase64(iv), additionalData: diaryRevisionAad(binding, field),
        }, key, decodeBase64(data)));
        try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(opened); } finally { opened.fill(0); }
    } finally { raw.fill(0); }
}
