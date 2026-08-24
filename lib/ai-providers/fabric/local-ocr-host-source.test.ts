/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalOcrHostSource } from './local-ocr-host-source.ts';

const BYTES = new Uint8Array([137, 80, 78, 71]);
const state = (overrides: Record<string, unknown> = {}) => ({ sessionActive: true, current: true, revoked: false, selectionEpoch: 7, expiresAt: 2_000, ...overrides });
const input = (overrides: Record<string, unknown> = {}) => ({ mode: 'ephemeral_image', content: { mimeType: 'image/png', bytes: BYTES }, ...overrides });
const host = (readState: () => unknown = () => state()) => ({ readState, now: () => 1_000 });
const code = (value: unknown) => (value as { code?: unknown }).code;

test('admits one copied, ephemeral plaintext image only while host state stays current', () => {
    const boundary = createLocalOcrHostSource(host());
    const admitted = boundary.admit(input());
    assert.equal(admitted.status, 'admitted');
    assert.equal(admitted.status === 'admitted' && admitted.source.kind, 'ephemeral_pre_persist_image');
    assert.equal(admitted.status === 'admitted' && admitted.source.mimeType, 'image/png');
    assert.notEqual(admitted.status === 'admitted' && admitted.source.bytes, BYTES);
    assert.equal(admitted.status === 'admitted' && 'locator' in admitted.source, false);
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
    const hostile = [accessor, Object.create(input()), { mode: 'ephemeral_image' }, input({ extra: true }),
        input({ content: { mimeType: 'image/gif', bytes: BYTES } }), input({ content: { mimeType: 'image/png', bytes: new Uint8Array() } }),
        input({ content: { mimeType: 'image/png', bytes: new Uint8Array(5 * 1024 * 1024 + 1) } }),
        input({ content: 'data:image/png;base64,iVBORw0KGgo=' }), { then: () => undefined }];
    for (const value of hostile) assert.equal(code(createLocalOcrHostSource(host()).admit(value)), 'input_invalid');
    assert.equal(reads, 0);
});

test('fails closed for currentness drift, revocation, expiry, thenables, and reentry', () => {
    let reads = 0;
    assert.equal(code(createLocalOcrHostSource(host(() => state({ selectionEpoch: ++reads }))).admit(input())), 'currentness_lost');
    assert.equal(code(createLocalOcrHostSource(host(() => state({ revoked: true }))).admit(input())), 'revoked');
    assert.equal(code(createLocalOcrHostSource(host(() => state({ expiresAt: 999 }))).admit(input())), 'expired');
    assert.equal(code(createLocalOcrHostSource(host(() => ({ then: () => undefined }))).admit(input())), 'host_invalid');
    const reentry: { boundary?: ReturnType<typeof createLocalOcrHostSource> } = {};
    reentry.boundary = createLocalOcrHostSource(host(() => { reentry.boundary?.admit(input()); return state(); }));
    assert.equal(code(reentry.boundary.admit(input())), 'reentered');
});

test('rejects hostile host configuration and does not retain a restart locator or fixed entropy', () => {
    const accessor = {};
    Object.defineProperty(accessor, 'readState', { enumerable: true, get: () => () => state() });
    for (const value of [accessor, Object.create(host()), { readState: () => state() }, host(async () => state()), new Proxy(host(), {})]) {
        assert.throws(() => createLocalOcrHostSource(value), /host_invalid/);
    }
    const first = createLocalOcrHostSource(host()); first.admit(input());
    const restarted = createLocalOcrHostSource(host());
    assert.equal(code(restarted.admit({ mode: 'persisted_attachment', content: 'ENC:YWJj:ZGVm' })), 'persisted_attachment_denied');
});
