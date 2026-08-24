/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    advanceLocalOcrHostSourceOwner,
    createLocalOcrHostSource,
    createLocalOcrHostSourceOwner,
    disposeLocalOcrHostSourceOwner,
} from './local-ocr-host-source.ts';

const BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0]);
const state = (overrides: Record<string, unknown> = {}) => ({ sessionActive: true, current: true, revoked: false, selectionEpoch: 7, stateEpoch: 1, expiresAt: 2_000, observedAt: 1_000, ...overrides });
const next = (overrides: Record<string, unknown> = {}) => state({ stateEpoch: 2, observedAt: 1_001, ...overrides });
const input = (overrides: Record<string, unknown> = {}) => ({ mode: 'ephemeral_image', content: { mimeType: 'image/png', bytes: BYTES }, ...overrides });
const code = (value: unknown) => (value as { code?: unknown }).code;

test('mints an opaque owner, admits an immutable image copy once, and denies replay', () => {
    const owner = createLocalOcrHostSourceOwner(state());
    const boundary = createLocalOcrHostSource(owner);
    const admitted = boundary.admit(input());
    assert.equal(admitted.status, 'admitted');
    assert.equal(admitted.status === 'admitted' && admitted.source.kind, 'ephemeral_pre_persist_image');
    assert.equal(admitted.status === 'admitted' && admitted.source.encoding, 'base64');
    assert.equal(admitted.status === 'admitted' && 'bytes' in admitted.source, false);
    const original = BYTES[0]; BYTES[0] = 0;
    assert.equal(admitted.status === 'admitted' && admitted.source.contentBase64, Buffer.from(new Uint8Array([original, ...BYTES.slice(1)])).toString('base64'));
    BYTES[0] = original;
    assert.equal(code(boundary.admit(input())), 'replayed');
    assert.deepEqual(Object.keys(boundary), ['admit', 'dispose']);
});

test('rejects forged, wrapped, proxied, or legacy caller-supplied host authority before reflection', () => {
    const owner = createLocalOcrHostSourceOwner(state());
    let traps = 0;
    const proxy = new Proxy(owner, { get: () => { traps += 1; throw new Error('trap'); } });
    for (const value of [{}, Object.create(owner), proxy, { snapshot: () => state() }]) {
        assert.throws(() => createLocalOcrHostSource(value), /host_invalid/);
    }
    assert.equal(traps, 0);
});

test('accepts only exact data state and monotonically advances the internal owner state', () => {
    const owner = createLocalOcrHostSourceOwner(state());
    assert.equal(advanceLocalOcrHostSourceOwner(owner, next()), true);
    assert.equal(advanceLocalOcrHostSourceOwner(owner, next({ stateEpoch: 2 })), false);
    assert.equal(advanceLocalOcrHostSourceOwner(owner, next({ stateEpoch: 1 })), false);
    assert.equal(advanceLocalOcrHostSourceOwner(owner, next({ selectionEpoch: 6 })), false);
    assert.equal(advanceLocalOcrHostSourceOwner(owner, next({ observedAt: 999 })), false);
    for (const invalid of [Object.create(state()), { ...next(), extra: true }, new Proxy(next(), {})]) {
        assert.equal(advanceLocalOcrHostSourceOwner(owner, invalid), false);
    }
});

test('latches revocation, expiry, inactivity and currentness loss from the module-owned state', () => {
    for (const update of [next({ revoked: true }), next({ current: false }), next({ sessionActive: false }), next({ observedAt: 2_000 })]) {
        const owner = createLocalOcrHostSourceOwner(state()); const boundary = createLocalOcrHostSource(owner);
        assert.equal(advanceLocalOcrHostSourceOwner(owner, update), true);
        assert.notEqual(boundary.admit(input()).status, 'admitted');
    }
});

test('denies caller fields, hostile records, non-image data and persisted material', () => {
    for (const value of [
        { mode: 'persisted_attachment', content: 'ENC:YWJj:ZGVm' },
        ...['attachmentId', 'sourceRef', 'revision', 'freshness', 'session', 'selectionEpoch', 'provider', 'venue', 'authority', 'apply'].map((field) => ({ ...input(), [field]: 'forged' })),
        Object.create(input()), input({ extra: true }), { then: () => undefined },
        input({ content: { mimeType: 'image/png', bytes: new Uint8Array() } }),
        input({ content: { mimeType: 'image/png', bytes: new Uint8Array(5 * 1024 * 1024 + 1) } }),
        input({ content: 'data:image/png;base64,iVBORw0KGgo=' }),
    ]) assert.notEqual(createLocalOcrHostSource(createLocalOcrHostSourceOwner(state())).admit(value).status, 'admitted');
});

test('prevents a transition during the synchronous critical section and latches the boundary', () => {
    const owner = createLocalOcrHostSourceOwner(state()); const boundary = createLocalOcrHostSource(owner);
    const original = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'byteLength');
    Object.defineProperty(Uint8Array.prototype, 'byteLength', { configurable: true, get: () => { advanceLocalOcrHostSourceOwner(owner, next()); return 33; } });
    try { assert.equal(code(boundary.admit(input())), 'reentered'); } finally {
        if (original) Object.defineProperty(Uint8Array.prototype, 'byteLength', original); else delete (Uint8Array.prototype as unknown as Record<string, unknown>).byteLength;
    }
    assert.equal(code(boundary.admit(input())), 'replayed');
    assert.equal(createLocalOcrHostSource(owner).admit(input()).status, 'admitted');
});

test('disposal releases the owner slot and terminally denies the disposed boundary or owner', () => {
    const owner = createLocalOcrHostSourceOwner(state()); const first = createLocalOcrHostSource(owner);
    assert.throws(() => createLocalOcrHostSource(owner), /host_in_use/);
    first.dispose(); assert.equal(code(first.admit(input())), 'disposed');
    assert.equal(createLocalOcrHostSource(owner).admit(input()).status, 'admitted');
    const terminal = createLocalOcrHostSourceOwner(state()); const boundary = createLocalOcrHostSource(terminal);
    disposeLocalOcrHostSourceOwner(terminal);
    assert.equal(code(boundary.admit(input())), 'disposed');
    assert.equal(advanceLocalOcrHostSourceOwner(terminal, next()), false);
    assert.throws(() => createLocalOcrHostSource(terminal), /host_invalid/);
});

test('keeps screening limited to minimal PNG, JPEG and WebP signatures', () => {
    const jpeg = new Uint8Array([255, 216, 80, 75, 3, 4, 255, 217]);
    const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
    for (const content of [{ mimeType: 'image/jpeg', bytes: jpeg }, { mimeType: 'image/webp', bytes: webp }]) {
        assert.equal(createLocalOcrHostSource(createLocalOcrHostSourceOwner(state())).admit({ mode: 'ephemeral_image', content }).status, 'admitted');
    }
    for (const content of [{ mimeType: 'image/png', bytes: BYTES.slice(0, 8) }, { mimeType: 'image/jpeg', bytes: jpeg.slice(0, 2) }, { mimeType: 'image/webp', bytes: webp.slice(0, 8) }]) {
        assert.equal(code(createLocalOcrHostSource(createLocalOcrHostSourceOwner(state())).admit({ mode: 'ephemeral_image', content })), 'input_invalid');
    }
});
