/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalOcrHostSource } from './local-ocr-host-source.ts';

const BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0]);
const state = (overrides: Record<string, unknown> = {}) => ({ sessionActive: true, current: true, revoked: false, selectionEpoch: 7, stateEpoch: 1, expiresAt: 2_000, observedAt: 1_000, ...overrides });
const input = (overrides: Record<string, unknown> = {}) => ({ mode: 'ephemeral_image', content: { mimeType: 'image/png', bytes: BYTES }, ...overrides });
const host = (snapshot: () => unknown = () => state()) => ({ snapshot });
const code = (value: unknown) => (value as { code?: unknown }).code;

test('admits one copied ephemeral image and denies replay without publishing identity', () => {
    const boundary = createLocalOcrHostSource(host());
    const admitted = boundary.admit(input());
    assert.equal(admitted.status, 'admitted');
    assert.equal(admitted.status === 'admitted' && admitted.source.kind, 'ephemeral_pre_persist_image');
    assert.notEqual(admitted.status === 'admitted' && admitted.source.bytes, BYTES);
    const original = BYTES[0]; BYTES[0] = 0;
    assert.equal(admitted.status === 'admitted' && admitted.source.bytes[0], original); BYTES[0] = original;
    assert.equal(code(boundary.admit(input())), 'replayed');
    assert.deepEqual(Object.keys(boundary), ['admit']);
});

test('denies persisted material and every caller identity or control field', () => {
    assert.equal(code(createLocalOcrHostSource(host()).admit({ mode: 'persisted_attachment', content: 'ENC:YWJj:ZGVm' })), 'persisted_attachment_denied');
    for (const field of ['attachmentId', 'sourceRef', 'revision', 'freshness', 'session', 'selectionEpoch', 'provider', 'venue', 'authority', 'apply']) {
        assert.equal(code(createLocalOcrHostSource(host()).admit({ ...input(), [field]: 'forged' })), 'input_invalid');
    }
});

test('rejects hostile caller records and bytes without reflection', () => {
    let reads = 0; const accessor = {};
    Object.defineProperty(accessor, 'mode', { enumerable: true, get: () => { reads += 1; return 'ephemeral_image'; } });
    const revoked = Proxy.revocable(new Uint8Array(BYTES), {}); revoked.revoke();
    for (const value of [accessor, Object.create(input()), input({ extra: true }), { then: () => undefined },
        input({ content: { mimeType: 'image/png', bytes: revoked.proxy } }), input({ content: { mimeType: 'image/png', bytes: new Uint8Array() } }),
        input({ content: { mimeType: 'image/png', bytes: new Uint8Array(5 * 1024 * 1024 + 1) } }), input({ content: 'data:image/png;base64,iVBORw0KGgo=' })]) {
        assert.equal(code(createLocalOcrHostSource(host()).admit(value)), 'input_invalid');
    }
    assert.equal(reads, 0);
});

test('requires one exact synchronous data-only snapshot capability', () => {
    let reads = 0; const accessor = {};
    Object.defineProperty(accessor, 'snapshot', { enumerable: true, get: () => { reads += 1; return () => state(); } });
    const functionProxy = new Proxy(() => state(), {});
    const objectProxy = new Proxy(host(), {});
    for (const value of [accessor, objectProxy, Object.create(host()), { snapshot: () => state(), extra: true }, { readState: () => state(), now: () => 1_000 },
        host(async () => state()), host(functionProxy)]) {
        assert.throws(() => createLocalOcrHostSource(value), /host_invalid/);
    }
    assert.equal(code(createLocalOcrHostSource(host(() => ({ then: () => undefined }))).admit(input())), 'host_invalid');
    assert.equal(reads, 0);
});

test('rejects hostile snapshot records without executing accessors or proxy traps', () => {
    let accessorReads = 0; let proxyTraps = 0;
    const accessor = state();
    Object.defineProperty(accessor, 'observedAt', { enumerable: true, get: () => { accessorReads += 1; return 1_000; } });
    const proxy = new Proxy(state(), { ownKeys: () => { proxyTraps += 1; return []; } });
    for (const value of [accessor, proxy, Object.create(state())]) {
        assert.equal(code(createLocalOcrHostSource(host(() => value)).admit(input())), 'host_invalid');
    }
    assert.equal(accessorReads, 0); assert.equal(proxyTraps, 0);
});

test('compares two atomic snapshots and denies drift, ABA, regression, revocation and expiry', () => {
    for (const pair of [
        [state(), state({ stateEpoch: 2 })], [state({ stateEpoch: 2 }), state({ stateEpoch: 1 })],
        [state(), state({ selectionEpoch: 8 })], [state(), state({ observedAt: 999 })],
        [state(), state({ current: false })], [state(), state({ revoked: true })],
    ]) {
        let reads = 0; assert.notEqual(createLocalOcrHostSource(host(() => pair[reads++])).admit(input()).status, 'admitted');
    }
    assert.equal(code(createLocalOcrHostSource(host(() => state({ sessionActive: false }))).admit(input())), 'host_inactive');
    assert.equal(code(createLocalOcrHostSource(host(() => state({ revoked: true }))).admit(input())), 'revoked');
    assert.equal(code(createLocalOcrHostSource(host(() => state({ observedAt: 2_000 }))).admit(input())), 'expired');
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(code(createLocalOcrHostSource(host(() => state({ stateEpoch: invalid }))).admit(input())), 'host_invalid');
    }
});

test('locks exact snapshot function identity and releases it after every denial', () => {
    const snapshot = () => state(); const first = createLocalOcrHostSource(host(snapshot));
    assert.throws(() => createLocalOcrHostSource(host(snapshot)), /host_in_use/);
    assert.equal(code(first.admit(input({ extra: true }))), 'input_invalid');
    assert.equal(createLocalOcrHostSource(host(snapshot)).admit(input()).status, 'admitted');
});

test('releases after exceptions and denies reentry without residue', () => {
    let throws = true; const unstable = () => { if (throws) throw new Error('synthetic'); return state(); };
    assert.equal(code(createLocalOcrHostSource(host(unstable)).admit(input())), 'host_invalid');
    throws = false; assert.equal(createLocalOcrHostSource(host(unstable)).admit(input()).status, 'admitted');
    let reenter = true; const holder: { boundary?: ReturnType<typeof createLocalOcrHostSource> } = {};
    const snapshot = () => { if (reenter) { reenter = false; holder.boundary?.admit(input()); } return state(); };
    const boundary = createLocalOcrHostSource(host(snapshot)); holder.boundary = boundary;
    assert.equal(code(boundary.admit(input())), 'reentered');
    assert.equal(code(boundary.admit(input())), 'replayed');
    assert.equal(createLocalOcrHostSource(host(snapshot)).admit(input()).status, 'admitted');
});

test('atomic observedAt makes final-clock mutation a normal stale snapshot denial', () => {
    let epoch = 1; let reads = 0;
    const snapshot = () => { reads += 1; const result = state({ stateEpoch: epoch, observedAt: 1_000 + reads }); if (reads === 1) epoch += 1; return result; };
    assert.equal(code(createLocalOcrHostSource(host(snapshot)).admit(input())), 'currentness_lost');
    assert.equal(reads, 2);
});

test('keeps screening limited to minimal PNG, JPEG and WebP signatures', () => {
    const jpeg = new Uint8Array([255, 216, 80, 75, 3, 4, 255, 217]);
    const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
    assert.equal(createLocalOcrHostSource(host()).admit({ mode: 'ephemeral_image', content: { mimeType: 'image/jpeg', bytes: jpeg } }).status, 'admitted');
    assert.equal(createLocalOcrHostSource(host()).admit({ mode: 'ephemeral_image', content: { mimeType: 'image/webp', bytes: webp } }).status, 'admitted');
    for (const content of [{ mimeType: 'image/png', bytes: BYTES.slice(0, 8) }, { mimeType: 'image/jpeg', bytes: jpeg.slice(0, 2) },
        { mimeType: 'image/webp', bytes: webp.slice(0, 8) }, { mimeType: 'image/jpeg', bytes: BYTES }]) {
        assert.equal(code(createLocalOcrHostSource(host()).admit({ mode: 'ephemeral_image', content })), 'input_invalid');
    }
});
