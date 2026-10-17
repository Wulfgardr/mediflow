import { createCipheriv, createDecipheriv, createHash, hkdfSync, pbkdf2Sync, randomBytes } from 'node:crypto';

// Independent Node implementation of the documented wire format, used only by
// this synthetic comparison. The product JS and Rust implementations stay separate.
export function deriveUnlock(passphrase, saltBase64) {
    const normalized = passphrase.normalize('NFKC');
    if ([...normalized].length < 15 || [...normalized].length > 128) throw new Error('Invalid synthetic passphrase length');
    const root = pbkdf2Sync(Buffer.from(normalized, 'utf8'), Buffer.from(saltBase64, 'base64'), 2_000_000, 32, 'sha256');
    const derive = (info) => Buffer.from(hkdfSync('sha256', root, Buffer.alloc(0), info, 32));
    return { kek: derive('mediflow.unlock.kek.v3'), verifier: derive('mediflow.unlock.verifier.v3').toString('base64') };
}

export function wrapKey(masterKey, kek, iv = randomBytes(12)) {
    const cipher = createCipheriv('aes-256-gcm', kek, iv);
    return Buffer.concat([iv, cipher.update(masterKey), cipher.final(), cipher.getAuthTag()]).toString('base64');
}

export function unwrapKey(blob, kek) {
    const bytes = Buffer.from(blob, 'base64');
    if (bytes.length !== 60) throw new Error('Unexpected master-key wrapping length');
    const cipher = createDecipheriv('aes-256-gcm', kek, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]);
}

export function openPinWrapping(blob, salt, pin) {
    const match = /^v([12]):(.*)$/u.exec(blob);
    if (blob.startsWith('v') && !match) throw new Error('Expected initial PIN wrapping');
    const iterations = match?.[1] === '2' ? 600_000 : 100_000;
    return unwrapKey(match?.[2] ?? blob, pbkdf2Sync(pin, Buffer.from(salt, 'base64'), iterations, 32, 'sha256'));
}

export function recoveryWrapping(masterKey) {
    const recoveryKey = randomBytes(20);
    const salt = randomBytes(16);
    const derive = (info) => Buffer.from(hkdfSync('sha256', recoveryKey, salt, info, 32));
    return {
        recoveryKey: recoveryKey.toString('base64'),
        wrappedMasterKey: `r1:${wrapKey(masterKey, derive('mediflow.recovery.kek.v1'))}`,
        salt: salt.toString('base64'),
        verifier: derive('mediflow.recovery.verifier.v1').toString('base64'),
    };
}

export function seal(value, masterKey, iv = randomBytes(12)) {
    const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return `ENC:${iv.toString('base64')}:${data.toString('base64')}`;
}

export function unseal(value, masterKey) {
    if (typeof value !== 'string' || !value.startsWith('ENC:')) return value;
    const parts = value.split(':');
    if (parts.length !== 3) throw new Error('Invalid sealed field');
    const iv = Buffer.from(parts[1], 'base64');
    const bytes = Buffer.from(parts[2], 'base64');
    if (iv.length !== 12 || bytes.length < 16) throw new Error('Invalid sealed field length');
    const cipher = createDecipheriv('aes-256-gcm', masterKey, iv);
    cipher.setAuthTag(bytes.subarray(-16));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(0, -16)), cipher.final()]).toString('utf8'));
}

export function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    if (value === undefined || typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-JSON comparison value');
    return JSON.stringify(value);
}

export function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
