/* @Codex */
import { constants, openSync, fstatSync, readSync, closeSync, type BigIntStats } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { parseStrictJson } from './bounded-request-body';

export class NativeConfigurationGrantError extends Error {
    constructor() { super('Native configuration grant denied'); }
}
export type NativeConfigurationPrincipal = Readonly<{ userId: string; clientId: string; role: string }>;
const deny = (): never => { throw new NativeConfigurationGrantError(); };
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(v);

// @Codex: observed file identity/version only; atime changes from reads are excluded.
const fileVersion = (stat: BigIntStats): string =>
    [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.uid, stat.mode].join(':');

/** Host-controlled file only. No request path, credential, Web owner or auto-grant. */
export function readNativeConfigurationGrant(path: string | undefined, principal: NativeConfigurationPrincipal, now = Date.now()): string {
    if (!path || !isAbsolute(path) || principal.role !== 'admin') return deny();
    let fd: number | undefined;
    try {
        fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = fstatSync(fd, { bigint: true });
        const version = fileVersion(stat);
        if (!stat.isFile() || typeof process.getuid !== 'function' || stat.uid !== BigInt(process.getuid())
            || (stat.mode & BigInt(0o777)) !== BigInt(0o600) || stat.size > BigInt(16_384)) return deny();
        const bytes = Buffer.alloc(16_385); let count = 0;
        while (count < bytes.length) {
            const read = readSync(fd, bytes, count, bytes.length - count, null);
            if (read === 0) break;
            count += read;
        }
        if (count > 16_384 || fileVersion(fstatSync(fd, { bigint: true })) !== version) return deny();
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count));
        const parsed = parseStrictJson(raw);
        if (!exact(parsed, ['schemaVersion', 'grants']) || parsed.schemaVersion !== 'mediflow.native-ai-grants.v1'
            || !Array.isArray(parsed.grants) || parsed.grants.length > 32) return deny();
        const ids = new Set<string>(); let matches = 0;
        for (const grant of parsed.grants) {
            if (!exact(grant, ['grantId', 'userId', 'clientId', 'capability', 'expiresAt'])
                || !identifier(grant.grantId) || !identifier(grant.userId) || !identifier(grant.clientId)
                || grant.capability !== 'native.ai.configure' || !Number.isSafeInteger(grant.expiresAt)
                || ids.has(grant.grantId)) return deny();
            ids.add(grant.grantId);
            if (grant.userId === principal.userId && grant.clientId === principal.clientId) {
                if ((grant.expiresAt as number) <= now || (grant.expiresAt as number) > now + 86_400_000) return deny();
                matches += 1;
            }
        }
        if (matches !== 1) return deny();
        return createHash('sha256').update(version).update('\0').update(raw).digest('hex');
    } catch { return deny(); }
    finally { if (fd !== undefined) closeSync(fd); }
}
