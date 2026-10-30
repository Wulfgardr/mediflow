export const FILE_KEY_DOMAIN = 'mediflow.attachment.file-key.v2';
export const FILE_DATA_DOMAIN = 'mediflow.attachment.data.v2';
const encoder = new TextEncoder();
export const isCiphertext = (value: string): boolean => value.startsWith('ENC:') || value.startsWith('ENC2:');
export function encodeBase64(bytes: Uint8Array): string {
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
}
export function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
    const bytes = Uint8Array.from(atob(text), c => c.charCodeAt(0));
    if (encodeBase64(bytes) !== text) throw new Error('Invalid file envelope');
    return bytes;
}
export function parseFileEnvelope(value: unknown) {
    if (typeof value !== 'string' || value.length > 20 * 1024 * 1024) throw new Error('Invalid file envelope');
    const [version, wrapIv, wrappedKey, iv, data, ...rest] = value.split(':');
    if (version !== 'ENC2' || rest.length || !wrapIv || !wrappedKey || !iv || !data) throw new Error('Invalid file envelope');
    const result = { wrapIv: decodeBase64(wrapIv), wrappedKey: decodeBase64(wrappedKey), iv: decodeBase64(iv), data: decodeBase64(data) };
    if (result.wrapIv.length !== 12 || result.wrappedKey.length !== 48 || result.iv.length !== 12 || result.data.length < 17) throw new Error('Invalid file envelope');
    return result;
}
export function isFileEnvelope(value: unknown): value is string {
    try { parseFileEnvelope(value); return true; } catch { return false; }
}
/** Dedicated producer for patient-document stage. Existing field writers keep ENC. */
export async function sealPatientDocumentFile(bytes: Uint8Array<ArrayBuffer>, masterKey: CryptoKey): Promise<{ data: string; fileKey: number[] }> {
    const key = crypto.getRandomValues(new Uint8Array(32));
    try {
        const wrapIv = crypto.getRandomValues(new Uint8Array(12)), iv = crypto.getRandomValues(new Uint8Array(12));
        const fileKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
        const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv, additionalData: encoder.encode(FILE_KEY_DOMAIN) }, masterKey, key);
        const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(FILE_DATA_DOMAIN) }, fileKey, bytes);
        return { data: `ENC2:${encodeBase64(wrapIv)}:${encodeBase64(new Uint8Array(wrapped))}:${encodeBase64(iv)}:${encodeBase64(new Uint8Array(data))}`, fileKey: Array.from(key) };
    } finally { key.fill(0); }
}
export async function openPatientDocumentFile(value: string, masterKey: CryptoKey): Promise<string> {
    const envelope = parseFileEnvelope(value);
    const raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: envelope.wrapIv, additionalData: encoder.encode(FILE_KEY_DOMAIN) }, masterKey, envelope.wrappedKey));
    try {
        if (raw.length !== 32) throw new Error('Invalid file envelope');
        const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
        const bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: envelope.iv, additionalData: encoder.encode(FILE_DATA_DOMAIN) }, key, envelope.data));
        try { return `data:application/pdf;base64,${encodeBase64(bytes)}`; } finally { bytes.fill(0); }
    } finally { raw.fill(0); }
}
