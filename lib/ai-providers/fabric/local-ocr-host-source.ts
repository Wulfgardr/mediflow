/* @Codex */
import 'server-only';

import { types } from 'node:util';

type HostState = Readonly<{ sessionActive: boolean; current: boolean; revoked: boolean; selectionEpoch: number; stateEpoch: number; expiresAt: number; observedAt: number }>;
type Image = Readonly<{ mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; contentBase64: string }>;
type DenialCode = 'input_invalid' | 'persisted_attachment_denied' | 'host_invalid' | 'host_in_use' | 'host_inactive' | 'currentness_lost' | 'revoked' | 'expired' | 'replayed' | 'reentered' | 'disposed';
export type LocalOcrHostSourceOutcome =
    | Readonly<{ status: 'admitted'; source: Readonly<{ kind: 'ephemeral_pre_persist_image'; mimeType: Image['mimeType']; encoding: 'base64'; contentBase64: string }> }>
    | Readonly<{ status: 'denied'; code: DenialCode }>;

type OwnerRecord = { state: HostState; active: boolean; operating: boolean; reentered: boolean; disposed: boolean };
const STATE_KEYS = ['sessionActive', 'current', 'revoked', 'selectionEpoch', 'stateEpoch', 'expiresAt', 'observedAt'] as const;
const IMAGE_KEYS = ['mimeType', 'bytes'] as const;
const INPUT_KEYS = ['mode', 'content'] as const;
const MAX_BYTES = 5 * 1024 * 1024;
const owners = new WeakMap<object, OwnerRecord>();
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

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

function parseState(value: unknown): HostState | null {
    if (!exactRecord(value, STATE_KEYS)) return null;
    const state = value as Record<string, unknown>;
    for (const key of ['selectionEpoch', 'stateEpoch', 'expiresAt', 'observedAt'] as const) {
        if (typeof state[key] !== 'number' || !Number.isSafeInteger(state[key]) || state[key] < (key.endsWith('Epoch') ? 1 : 0)) return null;
    }
    if (typeof state.sessionActive !== 'boolean' || typeof state.current !== 'boolean' || typeof state.revoked !== 'boolean') return null;
    return Object.freeze({ sessionActive: state.sessionActive, current: state.current, revoked: state.revoked, selectionEpoch: state.selectionEpoch as number, stateEpoch: state.stateEpoch as number, expiresAt: state.expiresAt as number, observedAt: state.observedAt as number });
}

function ownerRecord(value: unknown): OwnerRecord | null {
    if (!value || typeof value !== 'object' || types.isProxy(value)) return null;
    return owners.get(value as object) ?? null;
}

function terminal(state: HostState): boolean { return state.revoked || !state.sessionActive || !state.current || state.expiresAt <= state.observedAt; }

function canAdvance(previous: HostState, next: HostState): boolean {
    return !terminal(previous) && next.stateEpoch > previous.stateEpoch && next.selectionEpoch >= previous.selectionEpoch
        && next.observedAt >= previous.observedAt && (next.expiresAt >= previous.expiresAt || terminal(next));
}

export function createLocalOcrHostSourceOwner(initial: unknown): object {
    const state = parseState(initial);
    if (!state) throw new LocalOcrHostSourceError('host_invalid');
    const owner = Object.freeze(Object.create(null)); owners.set(owner, { state, active: false, operating: false, reentered: false, disposed: false });
    return owner;
}

export function advanceLocalOcrHostSourceOwner(owner: unknown, nextValue: unknown): boolean {
    const record = ownerRecord(owner); const next = parseState(nextValue);
    if (!record || !next || record.disposed) return false;
    if (record.operating) { record.reentered = true; return false; }
    if (!canAdvance(record.state, next)) return false;
    record.state = next; return true;
}

export function disposeLocalOcrHostSourceOwner(owner: unknown): boolean {
    const record = ownerRecord(owner); if (!record || record.disposed) return false;
    if (record.operating) record.reentered = true;
    record.disposed = true; record.active = false; return true;
}

function hasMinimalMagic(mimeType: Image['mimeType'], bytes: Uint8Array): boolean {
    if (mimeType === 'image/png') return bytes.byteLength >= 33 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte) && bytes[8] === 0 && bytes[9] === 0 && bytes[10] === 0 && bytes[11] === 13 && bytes[12] === 73 && bytes[13] === 72 && bytes[14] === 68 && bytes[15] === 82;
    if (mimeType === 'image/jpeg') return bytes.byteLength >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
    return bytes.byteLength >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80;
}

function parseImage(value: unknown): Image | null {
    if (!exactRecord(value, IMAGE_KEYS)) return null;
    const image = value as Record<string, unknown>; const mimeType = image.mimeType;
    if ((mimeType !== 'image/jpeg' && mimeType !== 'image/png' && mimeType !== 'image/webp') || types.isProxy(image.bytes) || !(image.bytes instanceof Uint8Array) || Buffer.isBuffer(image.bytes) || Object.getPrototypeOf(image.bytes) !== Uint8Array.prototype || image.bytes.byteLength < 1 || image.bytes.byteLength > MAX_BYTES) return null;
    const bytes = new Uint8Array(image.bytes);
    return hasMinimalMagic(mimeType, bytes) ? Object.freeze({ mimeType, contentBase64: Buffer.from(bytes).toString('base64') }) : null;
}

const deny = (code: DenialCode): LocalOcrHostSourceOutcome => Object.freeze({ status: 'denied', code });
function stateDenial(state: HostState): LocalOcrHostSourceOutcome | null {
    if (state.revoked) return deny('revoked'); if (!state.sessionActive) return deny('host_inactive'); if (!state.current) return deny('currentness_lost'); return state.expiresAt <= state.observedAt ? deny('expired') : null;
}

export function createLocalOcrHostSource(owner: unknown) {
    const record = ownerRecord(owner);
    if (!record || record.disposed) throw new LocalOcrHostSourceError('host_invalid');
    if (record.active) throw new LocalOcrHostSourceError('host_in_use');
    record.active = true; let consumed = false; let disposed = false;
    const release = () => { record.active = false; };
    return Object.freeze({
        admit(input: unknown): LocalOcrHostSourceOutcome {
            if (disposed || record.disposed) return deny('disposed');
            if (consumed) return deny('replayed');
            if (record.operating) { record.reentered = true; return deny('reentered'); }
            consumed = true; record.operating = true;
            try {
                if (!exactRecord(input, INPUT_KEYS)) return deny('input_invalid');
                const request = input as Record<string, unknown>;
                if (request.mode === 'persisted_attachment') return deny('persisted_attachment_denied');
                if (request.mode !== 'ephemeral_image') return deny('input_invalid');
                const currentDenial = stateDenial(record.state); if (currentDenial) return currentDenial;
                const image = parseImage(request.content); if (!image) return deny(record.reentered ? 'reentered' : 'input_invalid');
                if (record.reentered) return deny('reentered');
                return Object.freeze({ status: 'admitted', source: Object.freeze({ kind: 'ephemeral_pre_persist_image', mimeType: image.mimeType, encoding: 'base64', contentBase64: image.contentBase64 }) });
            } catch { return deny(record.reentered ? 'reentered' : 'host_invalid'); } finally { record.operating = false; record.reentered = false; release(); }
        },
        dispose(): void { if (!disposed) { if (record.operating) record.reentered = true; disposed = true; release(); } },
    });
}
