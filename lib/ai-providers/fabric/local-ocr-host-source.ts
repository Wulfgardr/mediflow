/* @Codex */
import 'server-only';

import { types } from 'node:util';

type HostState = Readonly<{ sessionActive: boolean; current: boolean; revoked: boolean; selectionEpoch: number; expiresAt: number }>;
type Host = Readonly<{ readState: () => unknown; now: () => unknown }>;
type Image = Readonly<{ mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: Uint8Array }>;
export type LocalOcrHostSourceOutcome =
    | Readonly<{ status: 'admitted'; source: Readonly<{ kind: 'ephemeral_pre_persist_image'; mimeType: Image['mimeType']; bytes: Uint8Array }> }>
    | Readonly<{ status: 'denied'; code: 'input_invalid' | 'persisted_attachment_denied' | 'host_invalid' | 'host_inactive' | 'currentness_lost' | 'revoked' | 'expired' | 'replayed' | 'reentered' }>;

const HOST_KEYS = ['readState', 'now'] as const;
const STATE_KEYS = ['sessionActive', 'current', 'revoked', 'selectionEpoch', 'expiresAt'] as const;
const IMAGE_KEYS = ['mimeType', 'bytes'] as const;
const INPUT_KEYS = ['mode', 'content'] as const;
const MAX_BYTES = 5 * 1024 * 1024;
const activeHosts = new WeakMap<object, { reentered: boolean }>();

export class LocalOcrHostSourceError extends Error {
    constructor(readonly code: 'host_invalid') { super(`Local OCR host source rejected: ${code}`); this.name = 'LocalOcrHostSourceError'; }
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).length === keys.length && keys.every((key) => {
        const descriptor = descriptors[key]; return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
    });
}

function snapshotHost(value: unknown): Host {
    if (!exactRecord(value, HOST_KEYS)) throw new LocalOcrHostSourceError('host_invalid');
    const readState = value.readState; const now = value.now;
    if (typeof readState !== 'function' || typeof now !== 'function' || types.isProxy(readState) || types.isProxy(now)
        || types.isAsyncFunction(readState) || types.isAsyncFunction(now)) throw new LocalOcrHostSourceError('host_invalid');
    return Object.freeze({ readState: readState as () => unknown, now: now as () => unknown });
}

function readState(host: Host): HostState | null {
    let value: unknown;
    try { value = host.readState(); } catch { return null; }
    if (!exactRecord(value, STATE_KEYS)) return null;
    const state = value as Record<string, unknown>;
    if (typeof state.sessionActive !== 'boolean' || typeof state.current !== 'boolean' || typeof state.revoked !== 'boolean'
        || typeof state.selectionEpoch !== 'number' || !Number.isSafeInteger(state.selectionEpoch) || state.selectionEpoch < 1
        || typeof state.expiresAt !== 'number' || !Number.isSafeInteger(state.expiresAt) || state.expiresAt < 0) return null;
    return Object.freeze(state as HostState);
}

function parseImage(value: unknown): Image | null {
    if (!exactRecord(value, IMAGE_KEYS)) return null;
    const image = value as Record<string, unknown>;
    if ((image.mimeType !== 'image/jpeg' && image.mimeType !== 'image/png' && image.mimeType !== 'image/webp')
        || !(image.bytes instanceof Uint8Array) || Buffer.isBuffer(image.bytes) || types.isProxy(image.bytes)
        || Object.getPrototypeOf(image.bytes) !== Uint8Array.prototype || image.bytes.byteLength < 1 || image.bytes.byteLength > MAX_BYTES) return null;
    return Object.freeze({ mimeType: image.mimeType, bytes: new Uint8Array(image.bytes) });
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

export function createLocalOcrHostSource(value: unknown) {
    const host = snapshotHost(value); let consumed = false;
    return Object.freeze({
        admit(input: unknown): LocalOcrHostSourceOutcome {
            if (!exactRecord(input, INPUT_KEYS)) return deny('input_invalid');
            const request = input as Record<string, unknown>;
            if (request.mode === 'persisted_attachment') return deny('persisted_attachment_denied');
            if (request.mode !== 'ephemeral_image') return deny('input_invalid');
            const image = parseImage(request.content); if (!image) return deny('input_invalid');
            if (consumed) return deny('replayed');
            const existing = activeHosts.get(host);
            if (existing) { existing.reentered = true; return deny('reentered'); }
            const operation = { reentered: false }; activeHosts.set(host, operation);
            try {
                const first = readState(host); const now = host.now();
                if (!first) return deny('host_invalid');
                const firstDenial = stateDenial(first, now); if (firstDenial || operation.reentered) return firstDenial ?? deny('reentered');
                const second = readState(host);
                if (!second) return deny('host_invalid');
                const secondDenial = stateDenial(second, now);
                if (secondDenial || operation.reentered) return secondDenial ?? deny('reentered');
                if (first.selectionEpoch !== second.selectionEpoch) return deny('currentness_lost');
                consumed = true;
                return Object.freeze({ status: 'admitted', source: Object.freeze({ kind: 'ephemeral_pre_persist_image', mimeType: image.mimeType, bytes: image.bytes }) });
            } catch { return deny('host_invalid'); } finally { activeHosts.delete(host); }
        },
    });
}
