import { assertRecoveryDatabaseHeader, decryptRecoveryBackup, LEGACY_RECOVERY_MAGIC, MAX_RECOVERY_BACKUP_BYTES } from './recovery-backup';

const MAGIC = new TextEncoder().encode('MDFREC02');
const WRAPPING_CONTEXT = new TextEncoder().encode('mediflow.recovery-backup.key.v2');
const WRAPPING_IV_END = 20;
const WRAPPED_KEY_END = 68;
const HEADER_BYTES = 76;
const TAG_BYTES = 16;
export const RECOVERY_BLOCK_BYTES = 1024 * 1024;
export const MAX_STREAMED_RECOVERY_DATABASE_BYTES = 32 * 1024 * RECOVERY_BLOCK_BYTES;

type Bytes = Uint8Array<ArrayBuffer>;
type ConsumeChunk = (bytes: Bytes) => Promise<void> | void;

function invalid(): never { throw new Error('RECOVERY_BACKUP_INVALID'); }
function matches(bytes: Uint8Array, prefix: Bytes): boolean {
    return prefix.every((byte, index) => bytes[index] === byte);
}

function blockCount(size: number): number {
    if (!Number.isSafeInteger(size) || size < 100 || size > MAX_STREAMED_RECOVERY_DATABASE_BYTES) invalid();
    return Math.ceil(size / RECOVERY_BLOCK_BYTES);
}

async function readBytes<T>(stream: ReadableStream<Uint8Array>,
    run: (take: (count: number) => Promise<Bytes>, end: () => Promise<void>) => Promise<T>): Promise<T> {
    const reader = stream.getReader();
    let pending: Uint8Array = new Uint8Array();
    let offset = 0;
    try {
        return await run(async count => {
            const output = new Uint8Array(count);
            let written = 0;
            while (written < count) {
                if (offset === pending.byteLength) {
                    const next = await reader.read();
                    if (next.done) invalid();
                    pending = next.value;
                    offset = 0;
                }
                const available = Math.min(count - written, pending.byteLength - offset);
                output.set(pending.subarray(offset, offset + available), written);
                written += available;
                offset += available;
            }
            return output;
        }, async () => {
            if (offset !== pending.byteLength || !(await reader.read()).done) invalid();
        });
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

function blockAuthentication(header: Bytes) {
    const iv = new Uint8Array(12);
    const counter = new DataView(iv.buffer);
    const aad = new Uint8Array(header.length + TAG_BYTES + 1);
    aad.set(header);
    return {
        parameters(index: number, final: boolean): AesGcmParams {
            counter.setUint32(8, index);
            aad[aad.length - 1] = Number(final);
            return { name: 'AES-GCM', iv, additionalData: aad, tagLength: TAG_BYTES * 8 };
        },
        bind(ciphertext: Bytes) { aad.set(ciphertext.subarray(-TAG_BYTES), header.length); },
    };
}

export async function encryptRecoveryBackupStream(input: ReadableStream<Uint8Array>, size: number,
    masterKey: CryptoKey, write: ConsumeChunk): Promise<void> {
    await readBytes(input, async (take, end) => {
        const blocks = blockCount(size);
        const header = new Uint8Array(HEADER_BYTES);
        header.set(MAGIC);
        const iv = crypto.getRandomValues(header.subarray(MAGIC.byteLength, WRAPPING_IV_END));
        new DataView(header.buffer).setBigUint64(WRAPPED_KEY_END, BigInt(size));
        const rawKey = crypto.getRandomValues(new Uint8Array(32));
        let key: CryptoKey;
        try {
            header.set(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: WRAPPING_CONTEXT },
                masterKey, rawKey)), WRAPPING_IV_END);
            key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
        } finally { rawKey.fill(0); }
        const authentication = blockAuthentication(header);
        await write(header);
        for (let index = 0; index < blocks; index++) {
            const plaintext = await take(Math.min(RECOVERY_BLOCK_BYTES, size - index * RECOVERY_BLOCK_BYTES));
            let ciphertext: Bytes;
            try {
                if (index === 0) assertRecoveryDatabaseHeader(plaintext);
                ciphertext = new Uint8Array(await crypto.subtle.encrypt(authentication.parameters(index, false), key, plaintext));
            } finally { plaintext.fill(0); }
            authentication.bind(ciphertext);
            await write(ciphertext);
        }
        await end();
        await write(new Uint8Array(await crypto.subtle.encrypt(authentication.parameters(blocks, true), key, new Uint8Array())));
    });
}

async function readCurrentBackup(artifact: Blob, masterKey: CryptoKey, write?: ConsumeChunk): Promise<void> {
    await readBytes(artifact.stream(), async (take, end) => {
        const header = await take(HEADER_BYTES);
        if (!matches(header, MAGIC)) invalid();
        const size = Number(new DataView(header.buffer).getBigUint64(WRAPPED_KEY_END));
        const blocks = blockCount(size);
        if (artifact.size !== HEADER_BYTES + size + (blocks + 1) * TAG_BYTES) invalid();
        const raw = new Uint8Array(await crypto.subtle.decrypt({
            name: 'AES-GCM', iv: header.subarray(MAGIC.byteLength, WRAPPING_IV_END), additionalData: WRAPPING_CONTEXT,
        }, masterKey, header.subarray(WRAPPING_IV_END, WRAPPED_KEY_END)));
        let key: CryptoKey;
        try { key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']); }
        finally { raw.fill(0); }
        const authentication = blockAuthentication(header);
        for (let index = 0; index < blocks; index++) {
            const ciphertext = await take(Math.min(RECOVERY_BLOCK_BYTES, size - index * RECOVERY_BLOCK_BYTES) + TAG_BYTES);
            const plaintext = new Uint8Array(await crypto.subtle.decrypt(authentication.parameters(index, false), key, ciphertext));
            try {
                if (index === 0) assertRecoveryDatabaseHeader(plaintext);
                authentication.bind(ciphertext);
                await write?.(plaintext);
            } finally { plaintext.fill(0); }
        }
        await crypto.subtle.decrypt(authentication.parameters(blocks, true), key, await take(TAG_BYTES));
        await end();
    });
}

export async function readRecoveryBackup(artifact: Blob | Uint8Array, masterKey: CryptoKey, write?: ConsumeChunk): Promise<void> {
    if (artifact instanceof Blob) {
        const prefix = new Uint8Array(await artifact.slice(0, MAGIC.byteLength).arrayBuffer());
        if (matches(prefix, MAGIC)) return readCurrentBackup(artifact, masterKey, write);
        if (artifact.size > MAX_RECOVERY_BACKUP_BYTES || !matches(prefix, LEGACY_RECOVERY_MAGIC)) invalid();
    }
    const bytes = artifact instanceof Blob ? new Uint8Array(await artifact.arrayBuffer()) : artifact;
    const plaintext = await decryptRecoveryBackup(bytes, masterKey) as Bytes;
    try { await write?.(plaintext); } finally { plaintext.fill(0); }
}
