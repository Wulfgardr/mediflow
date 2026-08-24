/* @Codex */
import 'server-only';

import { types } from 'node:util';

type HostSnapshot = Readonly<{
    sessionActive: boolean; current: boolean; revoked: boolean; selectionEpoch: number;
    stateEpoch: number; expiresAt: number; observedAt: number;
}>;
type Image = Readonly<{ mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: Uint8Array }>;
type DenialCode = 'input_invalid' | 'persisted_attachment_denied' | 'host_invalid' | 'host_in_use'
    | 'host_inactive' | 'currentness_lost' | 'revoked' | 'expired' | 'replayed' | 'reentered';
export type LocalOcrHostSourceOutcome =
    | Readonly<{ status: 'admitted'; source: Readonly<{ kind: 'ephemeral_pre_persist_image'; mimeType: Image['mimeType']; bytes: Uint8Array }> }>
    | Readonly<{ status: 'denied'; code: DenialCode }>;

const HOST_KEYS = ['snapshot'] as const;
const STATE_KEYS = ['sessionActive', 'current', 'revoked', 'selectionEpoch', 'stateEpoch', 'expiresAt', 'observedAt'] as const;
const IMAGE_KEYS = ['mimeType', 'bytes'] as const;
const INPUT_KEYS = ['mode', 'content'] as const;
const MAX_BYTES = 5 * 1024 * 1024;
const activeBoundaries = new WeakMap<() => unknown, object>();
const activeOperations = new WeakMap<() => unknown, { reentered: boolean }>();
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export class LocalOcrHostSourceError extends Error {
    constructor(readonly code: 'host_invalid' | 'host_in_use') {
        super(`Local OCR host source rejected: ${code}`); this.name = 'LocalOcrHostSourceError';
    }
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).length === keys.length && keys.every((key) => {
        const descriptor = descriptors[key];
        return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
    });
}

function hostCapability(value: unknown): () => unknown {
    if (!exactRecord(value, HOST_KEYS)) throw new LocalOcrHostSourceError('host_invalid');
    const snapshot = value.snapshot;
    if (typeof snapshot !== 'function' || types.isProxy(snapshot) || types.isAsyncFunction(snapshot)
        || Object.getPrototypeOf(snapshot) !== Function.prototype
        || Object.getOwnPropertyDescriptor(snapshot, 'then') !== undefined) throw new LocalOcrHostSourceError('host_invalid');
    return snapshot as () => unknown;
}

function readSnapshot(snapshot: () => unknown): HostSnapshot | null {
    let value: unknown;
    try { value = snapshot(); } catch { return null; }
    if (!exactRecord(value, STATE_KEYS)) return null;
    const state = value as Record<string, unknown>;
    for (const key of ['selectionEpoch', 'stateEpoch', 'expiresAt', 'observedAt'] as const) {
        if (typeof state[key] !== 'number' || !Number.isSafeInteger(state[key]) || state[key] < (key.endsWith('Epoch') ? 1 : 0)) return null;
    }
    if (typeof state.sessionActive !== 'boolean' || typeof state.current !== 'boolean' || typeof state.revoked !== 'boolean') return null;
    return Object.freeze({
        sessionActive: state.sessionActive, current: state.current, revoked: state.revoked,
        selectionEpoch: state.selectionEpoch as number, stateEpoch: state.stateEpoch as number,
        expiresAt: state.expiresAt as number, observedAt: state.observedAt as number,
    });
}

function hasMinimalMagic(mimeType: Image['mimeType'], bytes: Uint8Array): boolean {
    if (mimeType === 'image/png') return bytes.byteLength >= 33
        && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
        && bytes[8] === 0 && bytes[9] === 0 && bytes[10] === 0 && bytes[11] === 13
        && bytes[12] === 73 && bytes[13] === 72 && bytes[14] === 68 && bytes[15] === 82;
    if (mimeType === 'image/jpeg') return bytes.byteLength >= 4 && bytes[0] === 255 && bytes[1] === 216
        && bytes.at(-2) === 255 && bytes.at(-1) === 217;
    return bytes.byteLength >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70
        && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80;
}

function parseImage(value: unknown): Image | null {
    if (!exactRecord(value, IMAGE_KEYS)) return null;
    const image = value as Record<string, unknown>; const mimeType = image.mimeType;
    if ((mimeType !== 'image/jpeg' && mimeType !== 'image/png' && mimeType !== 'image/webp')
        || types.isProxy(image.bytes) || !(image.bytes instanceof Uint8Array) || Buffer.isBuffer(image.bytes)
        || Object.getPrototypeOf(image.bytes) !== Uint8Array.prototype || image.bytes.byteLength < 1 || image.bytes.byteLength > MAX_BYTES) return null;
    const bytes = new Uint8Array(image.bytes);
    return hasMinimalMagic(mimeType, bytes) ? Object.freeze({ mimeType, bytes }) : null;
}

const deny = (code: DenialCode): LocalOcrHostSourceOutcome => Object.freeze({ status: 'denied', code });

function stateDenial(state: HostSnapshot): LocalOcrHostSourceOutcome | null {
    if (state.revoked) return deny('revoked');
    if (!state.sessionActive) return deny('host_inactive');
    if (!state.current) return deny('currentness_lost');
    return state.expiresAt <= state.observedAt ? deny('expired') : null;
}

function sameCurrentness(first: HostSnapshot, second: HostSnapshot): boolean {
    return first.sessionActive === second.sessionActive && first.current === second.current && first.revoked === second.revoked
        && first.selectionEpoch === second.selectionEpoch && first.stateEpoch === second.stateEpoch && first.expiresAt === second.expiresAt;
}

export function createLocalOcrHostSource(value: unknown) {
    const snapshot = hostCapability(value);
    if (activeBoundaries.has(snapshot)) throw new LocalOcrHostSourceError('host_in_use');
    activeBoundaries.set(snapshot, {}); let consumed = false;
    return Object.freeze({
        admit(input: unknown): LocalOcrHostSourceOutcome {
            const active = activeOperations.get(snapshot);
            if (active) { active.reentered = true; return deny('reentered'); }
            if (consumed) return deny('replayed');
            consumed = true; const operation = { reentered: false }; activeOperations.set(snapshot, operation);
            try {
                if (!exactRecord(input, INPUT_KEYS)) return deny('input_invalid');
                const request = input as Record<string, unknown>;
                if (request.mode === 'persisted_attachment') return deny('persisted_attachment_denied');
                if (request.mode !== 'ephemeral_image') return deny('input_invalid');
                const first = readSnapshot(snapshot); if (!first) return deny('host_invalid');
                const firstDenial = stateDenial(first); if (firstDenial || operation.reentered) return firstDenial ?? deny('reentered');
                const image = parseImage(request.content); if (!image) return deny('input_invalid');
                const second = readSnapshot(snapshot); if (!second) return deny('host_invalid');
                const secondDenial = stateDenial(second); if (secondDenial || operation.reentered) return secondDenial ?? deny('reentered');
                if (second.observedAt < first.observedAt || !sameCurrentness(first, second)) return deny('currentness_lost');
                return Object.freeze({ status: 'admitted', source: Object.freeze({ kind: 'ephemeral_pre_persist_image', mimeType: image.mimeType, bytes: image.bytes }) });
            } catch { return deny('host_invalid'); } finally {
                activeOperations.delete(snapshot); activeBoundaries.delete(snapshot);
            }
        },
    });
}
