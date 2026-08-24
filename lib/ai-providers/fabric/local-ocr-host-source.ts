/* @Codex */
import 'server-only';

import { types } from 'node:util';

/**
 * The host owns a monotonic, latching stateEpoch: every lease/currentness change increments it,
 * and revoked/non-current state must not be cleared. This seam rejects any changed snapshot.
 */
type HostState = Readonly<{ sessionActive: boolean; current: boolean; revoked: boolean; selectionEpoch: number; stateEpoch: number; expiresAt: number }>;
type Host = Readonly<{ readState: () => unknown; now: () => unknown }>;
type Image = Readonly<{ mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: Uint8Array }>;
export type LocalOcrHostSourceOutcome =
    | Readonly<{ status: 'admitted'; source: Readonly<{ kind: 'ephemeral_pre_persist_image'; mimeType: Image['mimeType']; bytes: Uint8Array }> }>
    | Readonly<{ status: 'denied'; code: 'input_invalid' | 'persisted_attachment_denied' | 'host_invalid' | 'host_in_use' | 'host_inactive' | 'currentness_lost' | 'revoked' | 'expired' | 'replayed' | 'reentered' }>;

const HOST_KEYS = ['readState', 'now'] as const;
const STATE_KEYS = ['sessionActive', 'current', 'revoked', 'selectionEpoch', 'stateEpoch', 'expiresAt'] as const;
const IMAGE_KEYS = ['mimeType', 'bytes'] as const;
const INPUT_KEYS = ['mode', 'content'] as const;
const MAX_BYTES = 5 * 1024 * 1024;
// This exact object is the in-process lease identity; restart/new-process behavior is outside this seam.
const activeBoundaries = new WeakMap<object, object>();
const activeOperations = new WeakMap<object, { reentered: boolean }>();
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_MIN_BYTES = 33;

export class LocalOcrHostSourceError extends Error {
    constructor(readonly code: 'host_invalid' | 'host_in_use') { super(`Local OCR host source rejected: ${code}`); this.name = 'LocalOcrHostSourceError'; }
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).length === keys.length && keys.every((key) => {
        const descriptor = descriptors[key]; return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
    });
}

function snapshotHost(value: unknown): Readonly<{ identity: object; host: Host }> {
    if (!exactRecord(value, HOST_KEYS)) throw new LocalOcrHostSourceError('host_invalid');
    const readState = value.readState; const now = value.now;
    if (typeof readState !== 'function' || typeof now !== 'function' || types.isProxy(readState) || types.isProxy(now)
        || types.isAsyncFunction(readState) || types.isAsyncFunction(now)) throw new LocalOcrHostSourceError('host_invalid');
    return Object.freeze({ identity: value, host: Object.freeze({ readState: readState as () => unknown, now: now as () => unknown }) });
}

function readState(host: Host): HostState | null {
    let value: unknown;
    try { value = host.readState(); } catch { return null; }
    if (!exactRecord(value, STATE_KEYS)) return null;
    const state = value as Record<string, unknown>;
    if (typeof state.sessionActive !== 'boolean' || typeof state.current !== 'boolean' || typeof state.revoked !== 'boolean'
        || typeof state.selectionEpoch !== 'number' || !Number.isSafeInteger(state.selectionEpoch) || state.selectionEpoch < 1
        || typeof state.stateEpoch !== 'number' || !Number.isSafeInteger(state.stateEpoch) || state.stateEpoch < 1
        || typeof state.expiresAt !== 'number' || !Number.isSafeInteger(state.expiresAt) || state.expiresAt < 0) return null;
    return Object.freeze({
        sessionActive: state.sessionActive,
        current: state.current,
        revoked: state.revoked,
        selectionEpoch: state.selectionEpoch,
        stateEpoch: state.stateEpoch,
        expiresAt: state.expiresAt,
    });
}

function parseImage(value: unknown): Image | null {
    if (!exactRecord(value, IMAGE_KEYS)) return null;
    const image = value as Record<string, unknown>;
    if ((image.mimeType !== 'image/jpeg' && image.mimeType !== 'image/png' && image.mimeType !== 'image/webp')
        || types.isProxy(image.bytes) || !(image.bytes instanceof Uint8Array) || Buffer.isBuffer(image.bytes)
        || Object.getPrototypeOf(image.bytes) !== Uint8Array.prototype || image.bytes.byteLength < 1 || image.bytes.byteLength > MAX_BYTES
        || !hasCoherentMagic(image.mimeType, image.bytes)) return null;
    return Object.freeze({ mimeType: image.mimeType, bytes: new Uint8Array(image.bytes) });
}

function hasCoherentMagic(mimeType: Image['mimeType'], bytes: Uint8Array): boolean {
    if (mimeType === 'image/png') return bytes.byteLength >= PNG_MIN_BYTES && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
        && bytes[8] === 0 && bytes[9] === 0 && bytes[10] === 0 && bytes[11] === 13
        && bytes[12] === 73 && bytes[13] === 72 && bytes[14] === 68 && bytes[15] === 82;
    if (mimeType === 'image/jpeg') return bytes.byteLength >= 4 && bytes[0] === 255 && bytes[1] === 216
        && bytes[bytes.byteLength - 2] === 255 && bytes[bytes.byteLength - 1] === 217;
    return bytes.byteLength >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70
        && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80;
}

function deny(code: Extract<LocalOcrHostSourceOutcome, { status: 'denied' }>['code']): LocalOcrHostSourceOutcome {
    return Object.freeze({ status: 'denied', code });
}

function stateDenial(state: HostState, now: unknown): LocalOcrHostSourceOutcome | null {
    if (typeof now !== 'number' || !Number.isSafeInteger(now) || now < 0) return deny('host_invalid');
    if (state.revoked) return deny('revoked');
    if (!state.sessionActive) return deny('host_inactive');
    if (!state.current) return deny('currentness_lost');
    return state.expiresAt <= now ? deny('expired') : null;
}

function readNow(host: Host): number | null {
    try {
        const now = host.now();
        return typeof now === 'number' && Number.isSafeInteger(now) && now >= 0 ? now : null;
    } catch { return null; }
}

function sameState(first: HostState, second: HostState): boolean {
    return first.sessionActive === second.sessionActive && first.current === second.current && first.revoked === second.revoked
        && first.selectionEpoch === second.selectionEpoch && first.stateEpoch === second.stateEpoch && first.expiresAt === second.expiresAt;
}

export function createLocalOcrHostSource(value: unknown) {
    const snapshot = snapshotHost(value);
    if (activeBoundaries.has(snapshot.identity)) throw new LocalOcrHostSourceError('host_in_use');
    const boundary = {};
    activeBoundaries.set(snapshot.identity, boundary);
    let consumed = false;
    const release = () => activeBoundaries.delete(snapshot.identity);
    return Object.freeze({
        admit(input: unknown): LocalOcrHostSourceOutcome {
            if (consumed) return deny('replayed');
            if (!exactRecord(input, INPUT_KEYS)) return deny('input_invalid');
            const request = input as Record<string, unknown>;
            if (request.mode === 'persisted_attachment') return deny('persisted_attachment_denied');
            if (request.mode !== 'ephemeral_image') return deny('input_invalid');
            const image = parseImage(request.content); if (!image) return deny('input_invalid');
            const existing = activeOperations.get(snapshot.identity);
            if (existing) { existing.reentered = true; return deny('reentered'); }
            const operation = { reentered: false }; activeOperations.set(snapshot.identity, operation);
            try {
                const first = readState(snapshot.host); const firstNow = readNow(snapshot.host);
                if (!first || firstNow === null) return deny('host_invalid');
                const firstDenial = stateDenial(first, firstNow); if (firstDenial || operation.reentered) return firstDenial ?? deny('reentered');
                const second = readState(snapshot.host); const finalNow = readNow(snapshot.host);
                if (!second || finalNow === null) return deny('host_invalid');
                const secondDenial = stateDenial(second, finalNow);
                if (secondDenial || operation.reentered) return secondDenial ?? deny('reentered');
                if (finalNow < firstNow || second.stateEpoch < first.stateEpoch || !sameState(first, second)) return deny('currentness_lost');
                consumed = true;
                release();
                return Object.freeze({ status: 'admitted', source: Object.freeze({ kind: 'ephemeral_pre_persist_image', mimeType: image.mimeType, bytes: image.bytes }) });
            } catch { release(); return deny('host_invalid'); } finally { activeOperations.delete(snapshot.identity); }
        },
    });
}
