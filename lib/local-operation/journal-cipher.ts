import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { LocalOperationError } from './contract.ts';

const aad = Buffer.from('mediflow.local-operation.journal.v1');

/** Uses the unlocked archive's host-owned key; this component never creates or stores a key. */
export function createLocalOperationJournalCipher(currentKey: () => Uint8Array | null) {
    function key() {
        const value = currentKey();
        if (!(value instanceof Uint8Array) || value.byteLength !== 32) throw new LocalOperationError('denied');
        return Buffer.from(value);
    }
    return Object.freeze({
        seal(plaintext: string) {
            const iv = randomBytes(12), material = key();
            try {
                const cipher = createCipheriv('aes-256-gcm', material, iv); cipher.setAAD(aad);
                const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
                return `CU1:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')}`;
            } finally { material.fill(0); }
        },
        open(envelope: string) {
            if (!/^CU1:[A-Za-z0-9+/]+={0,2}$/.test(envelope)) throw new LocalOperationError('corrupt');
            const bytes = Buffer.from(envelope.slice(4), 'base64'), material = key();
            try {
                if (bytes.length < 29 || bytes.toString('base64') !== envelope.slice(4)) throw new Error();
                const decipher = createDecipheriv('aes-256-gcm', material, bytes.subarray(0, 12));
                decipher.setAAD(aad); decipher.setAuthTag(bytes.subarray(12, 28));
                return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
            } catch { throw new LocalOperationError('corrupt'); }
            finally { material.fill(0); }
        },
    });
}
