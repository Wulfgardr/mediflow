import { createDecipheriv } from 'node:crypto';
import { FILE_DATA_DOMAIN, parseFileEnvelope } from './security/attachment-file-envelope';

export function erasePatientDocumentFileKey(value: unknown): void {
    if (value && typeof value === 'object' && 'fileKey' in value && Array.isArray(value.fileKey)) value.fileKey.fill(0);
}
/** Consumes the mutable wire key, including malformed inputs. Never returns key material. */
export function verifyPatientDocumentFile(value: unknown, original: Uint8Array): void {
    let key: Buffer | undefined, plaintext: Buffer | undefined, tail: Buffer | undefined;
    try {
        if (!value || typeof value !== 'object' || !('fileKey' in value) || !('data' in value)
            || !Array.isArray(value.fileKey) || value.fileKey.length !== 32
            || !value.fileKey.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) throw new Error();
        key = Buffer.from(value.fileKey);
        const envelope = parseFileEnvelope(value.data);
        const decipher = createDecipheriv('aes-256-gcm', key, envelope.iv);
        decipher.setAAD(Buffer.from(FILE_DATA_DOMAIN));
        decipher.setAuthTag(envelope.data.subarray(-16));
        plaintext = decipher.update(envelope.data.subarray(0, -16));
        tail = decipher.final();
        if (tail.length !== 0 || plaintext.length !== original.length || !plaintext.equals(original)) throw new Error();
    } catch { throw new Error('Native patient document denied'); }
    finally { key?.fill(0); plaintext?.fill(0); tail?.fill(0); erasePatientDocumentFileKey(value); }
}
