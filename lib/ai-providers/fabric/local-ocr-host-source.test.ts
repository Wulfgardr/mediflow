/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalOcrHostSource } from './local-ocr-host-source.ts';

const BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0]);
const state = (overrides: Record<string, unknown> = {}) => ({ sessionActive: true, current: true, revoked: false, selectionEpoch: 7, stateEpoch: 1, expiresAt: 2_000, ...overrides });
const input = (overrides: Record<string, unknown> = {}) => ({ mode: 'ephemeral_image', content: { mimeType: 'image/png', bytes: BYTES }, ...overrides });
const host = (readState: () => unknown = () => state(), now: () => unknown = () => 1_000) => ({ readState, now });
const code = (value: unknown) => (value as { code?: unknown }).code;

test('admits one copied, ephemeral plaintext image only while host state stays current', () => {
    const shared = state();
    const boundary = createLocalOcrHostSource(host(() => shared));
    const admitted = boundary.admit(input());
    assert.equal(admitted.status, 'admitted');
    assert.equal(admitted.status === 'admitted' && admitted.source.kind, 'ephemeral_pre_persist_image');
    assert.equal(admitted.status === 'admitted' && admitted.source.mimeType, 'image/png');
    assert.notEqual(admitted.status === 'admitted' && admitted.source.bytes, BYTES);
    assert.equal(admitted.status === 'admitted' && 'locator' in admitted.source, false);
    assert.equal(Object.isFrozen(shared), false);
    const originalByte = BYTES[0]; BYTES[0] = 0;
    assert.equal(admitted.status === 'admitted' && admitted.source.bytes[0], originalByte);
    BYTES[0] = originalByte;
    assert.equal(code(boundary.admit(input())), 'replayed');
    assert.deepEqual(Object.keys(boundary), ['admit']);
});

test('denies persisted encrypted material and all caller identity or control fields', () => {
    const boundary = createLocalOcrHostSource(host());
    assert.equal(code(boundary.admit({ mode: 'persisted_attachment', content: 'ENC:YWJj:ZGVm' })), 'persisted_attachment_denied');
    for (const field of ['attachmentId', 'sourceRef', 'revision', 'freshness', 'session', 'selectionEpoch', 'provider', 'venue', 'authority', 'apply']) {
        assert.equal(code(createLocalOcrHostSource(host()).admit({ ...input(), [field]: 'forged' })), 'input_invalid');
    }
});

test('rejects hostile, empty, oversized, data-url, and unsupported caller content without accessors', () => {
    let reads = 0; const accessor = {};
    Object.defineProperty(accessor, 'mode', { enumerable: true, get: () => { reads += 1; return 'ephemeral_image'; } });
    const revokedBytes = Proxy.revocable(new Uint8Array(BYTES), {}); revokedBytes.revoke();
    const hostile = [accessor, Object.create(input()), { mode: 'ephemeral_image' }, input({ extra: true }),
        input({ content: { mimeType: 'image/gif', bytes: BYTES } }), input({ content: { mimeType: 'image/png', bytes: new Uint8Array() } }),
        input({ content: { mimeType: 'image/png', bytes: new Uint8Array(5 * 1024 * 1024 + 1) } }),
        input({ content: 'data:image/png;base64,iVBORw0KGgo=' }), input({ content: { mimeType: 'image/png', bytes: revokedBytes.proxy } }), { then: () => undefined }];
    for (const value of hostile) assert.equal(code(createLocalOcrHostSource(host()).admit(value)), 'input_invalid');
    assert.equal(reads, 0);
});

test('fails closed for currentness drift, revocation, expiry, thenables, and reentry', () => {
    let reads = 0;
    assert.equal(code(createLocalOcrHostSource(host(() => state({ selectionEpoch: ++reads, stateEpoch: reads }))).admit(input())), 'currentness_lost');
    assert.equal(code(createLocalOcrHostSource(host(() => state({ revoked: true }))).admit(input())), 'revoked');
    assert.equal(code(createLocalOcrHostSource(host(() => state({ expiresAt: 999 }))).admit(input())), 'expired');
    assert.equal(code(createLocalOcrHostSource(host(() => ({ then: () => undefined }))).admit(input())), 'host_invalid');
    const reentry: { boundary?: ReturnType<typeof createLocalOcrHostSource> } = {};
    reentry.boundary = createLocalOcrHostSource(host(() => { reentry.boundary?.admit(input()); return state(); }));
    assert.equal(code(reentry.boundary.admit(input())), 'reentered');
});

test('rejects epoch change, regression, and ABA even when visible state returns to the same values', () => {
    for (const epochs of [[1, 2], [2, 1], [1, 3]]) {
        let reads = 0;
        const boundary = createLocalOcrHostSource(host(() => state({ stateEpoch: epochs[reads++] })));
        assert.equal(code(boundary.admit(input())), 'currentness_lost');
    }
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(code(createLocalOcrHostSource(host(() => state({ stateEpoch: invalid }))).admit(input())), 'host_invalid');
    }
});

test('compares every host currentness field, not only the epoch', () => {
    for (const [field, value, expected] of [
        ['sessionActive', false, 'host_inactive'], ['current', false, 'currentness_lost'], ['revoked', true, 'revoked'],
        ['selectionEpoch', 8, 'currentness_lost'], ['expiresAt', 3_000, 'currentness_lost'],
    ] as const) {
        let reads = 0;
        const boundary = createLocalOcrHostSource(host(() => state(reads++ === 0 ? {} : { [field]: value })));
        assert.equal(code(boundary.admit(input())), expected);
    }
});

test('locks one exact host identity at a time and rechecks the clock at final consumption', () => {
    const lease = host();
    const first = createLocalOcrHostSource(lease);
    assert.throws(() => createLocalOcrHostSource(lease), /host_in_use/);
    assert.equal(first.admit(input()).status, 'admitted');
    assert.equal(createLocalOcrHostSource(lease).admit(input()).status, 'admitted');

    let nowReads = 0;
    const expiring = createLocalOcrHostSource(host(() => state(), () => (++nowReads === 1 ? 1_000 : 3_000)));
    assert.equal(code(expiring.admit(input())), 'expired');
    assert.equal(code(createLocalOcrHostSource(host(() => state(), () => Number.NaN)).admit(input())), 'host_invalid');
});

test('requires coherent PNG, JPEG, and WebP magic bytes and rejects truncation or MIME mismatch', () => {
    const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16, 255, 217]);
    const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
    assert.equal(createLocalOcrHostSource(host()).admit({ mode: 'ephemeral_image', content: { mimeType: 'image/jpeg', bytes: jpeg } }).status, 'admitted');
    assert.equal(createLocalOcrHostSource(host()).admit({ mode: 'ephemeral_image', content: { mimeType: 'image/webp', bytes: webp } }).status, 'admitted');
    for (const content of [
        { mimeType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) },
        { mimeType: 'image/jpeg', bytes: jpeg.slice(0, 2) },
        { mimeType: 'image/webp', bytes: webp.slice(0, 8) },
        { mimeType: 'image/jpeg', bytes: BYTES },
    ]) assert.equal(code(createLocalOcrHostSource(host()).admit({ mode: 'ephemeral_image', content })), 'input_invalid');
});

test('rejects hostile host configuration and does not retain a restart locator or fixed entropy', () => {
    const accessor = {};
    Object.defineProperty(accessor, 'readState', { enumerable: true, get: () => () => state() });
    const revoked = Proxy.revocable(host(), {}); revoked.revoke();
    const throwing = new Proxy(host(), { ownKeys: () => { throw new Error('trap'); } });
    for (const value of [accessor, Object.create(host()), { readState: () => state() }, host(async () => state()), new Proxy(host(), {}), revoked.proxy, throwing]) {
        assert.throws(() => createLocalOcrHostSource(value), /host_invalid/);
    }
    const first = createLocalOcrHostSource(host()); first.admit(input());
    const restarted = createLocalOcrHostSource(host());
    assert.equal(code(restarted.admit({ mode: 'persisted_attachment', content: 'ENC:YWJj:ZGVm' })), 'persisted_attachment_denied');
});
