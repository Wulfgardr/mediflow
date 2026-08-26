/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDocumentSynthesisAuthenticatedAttachmentCapture } from './document-synthesis-authenticated-attachment-capture.ts';
import { createServerSessionProjectionOwnerRegistry } from '../../security/server-session-projection-owner.ts';
import { createSession, deleteSession, registerServerSessionResource } from '../../security/server-session.ts';

const USERNAME = 'capture';
const USER = { id: 'user.synthetic.capture', username: USERNAME, role: 'admin' };
const PAIR = { patientId: 'patient.synthetic.capture', ambulatoryId: 'ambulatory.synthetic.capture' };
const ROW = Object.freeze({ documentSourceRef: 'a'.repeat(64), documentRevision: 7, documentFreshnessEpoch: 11 });
const denied = { status: 'denied', captureHandle: null };

function fixture() {
    let references = 0;
    const registry = createServerSessionProjectionOwnerRegistry({ clock: () => 1_000, entropy: () => Uint8Array.from({ length: 16 }, (_, index) => (references += 1) + index), resolve: (_session, pair) => Object.freeze({ ...pair }) });
    const session = createSession(USER, 'web'); const owner = registry.acquire(session);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    let context: { session: typeof session; owner: typeof owner } | null = { session, owner };
    let rows = 0; let entropy: () => Uint8Array = () => Uint8Array.from({ length: 16 }, (_, index) => index + 1);
    const service = createDocumentSynthesisAuthenticatedAttachmentCapture({
        acquireContext: async () => context,
        lookup(selection, attachmentId) { rows += 1; return selection.patientId === PAIR.patientId && selection.ambulatoryId === PAIR.ambulatoryId && attachmentId === 'attachment.synthetic.capture' ? ROW : null; },
        registerSessionResource: registerServerSessionResource,
        entropy: () => entropy(),
    });
    return { service, session, owner, get rows() { return rows; }, set context(value: typeof context) { context = value; }, set entropy(value: () => Uint8Array) { entropy = value; } };
}

test('captures one exact selected attachment as an opaque response only', async () => {
    const state = fixture(); const result = await state.service.capture({ attachmentId: 'attachment.synthetic.capture' });
    assert.deepEqual({ ...result }, { status: 'available', captureHandle: 'dsc_0102030405060708090a0b0c0d0e0f10' });
    assert.equal(state.rows, 1);
    const serialized = JSON.stringify(result);
    for (const forbidden of ['attachment', 'patient', 'currentness', 'session', 'owner', 'revision', 'freshness']) assert.equal(serialized.includes(forbidden), false);
});

test('makes missing and wrong-patient attachment intents indistinguishable', async () => {
    const state = fixture();
    const missing = await state.service.capture({ attachmentId: 'attachment.synthetic.missing' });
    state.owner.issueSelection({ expectedEpoch: 1, patientId: 'patient.synthetic.other', ambulatoryId: PAIR.ambulatoryId });
    const wrongPatient = await state.service.capture({ attachmentId: 'attachment.synthetic.capture' });
    assert.deepEqual({ ...missing }, { ...wrongPatient }); assert.deepEqual({ ...missing }, denied);
});

test('denies unavailable sessions and selections', async () => {
    const state = fixture(); state.context = null;
    assert.deepEqual({ ...await state.service.capture({ attachmentId: 'attachment.synthetic.capture' }) }, denied);
    const unselected = fixture(); const session = createSession(USER, 'web'); const owner = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => Object.freeze({ ...pair }) }).acquire(session);
    unselected.context = { session, owner };
    assert.deepEqual({ ...await unselected.service.capture({ attachmentId: 'attachment.synthetic.capture' }) }, denied);
});

test('rejects hostile input before auth, database, or accessor observation', async () => {
    const state = fixture(); let traps = 0;
    const getter = {}; Object.defineProperty(getter, 'attachmentId', { enumerable: true, get() { traps += 1; return 'attachment.synthetic.capture'; } });
    const inherited = Object.create({ attachmentId: 'attachment.synthetic.capture' });
    const proxy = new Proxy({ attachmentId: 'attachment.synthetic.capture' }, { get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; return []; } });
    const values = [getter, inherited, proxy, { attachmentId: ' attachment.synthetic.capture ' }, { attachmentId: 'x'.repeat(257) }, { attachmentId: 'attachment.synthetic.capture', extra: true }, { attachmentId: 'attachment.synthetic.capture', [Symbol('x')]: true }, { attachmentId: 'attachment.synthetic.capture', then() {} }];
    for (const value of values) assert.deepEqual({ ...await state.service.capture(value) }, denied);
    assert.equal(traps, 0); assert.equal(state.rows, 0);
});

test('fails closed for entropy failure, malformed entropy, and collisions without publishing', async () => {
    const state = fixture(); state.entropy = () => { throw new Error('synthetic entropy failure'); };
    assert.deepEqual({ ...await state.service.capture({ attachmentId: 'attachment.synthetic.capture' }) }, denied);
    state.entropy = () => Uint8Array.of(1);
    assert.deepEqual({ ...await state.service.capture({ attachmentId: 'attachment.synthetic.capture' }) }, denied);
    state.entropy = () => Uint8Array.from({ length: 16 }, (_, index) => index + 1);
    assert.equal((await state.service.capture({ attachmentId: 'attachment.synthetic.capture' })).status, 'available');
    assert.deepEqual({ ...await state.service.capture({ attachmentId: 'attachment.synthetic.capture' }) }, denied);
});

test('session disposal and another session cannot use a prior opaque handle as an attachment intent', async () => {
    const state = fixture(); const first = await state.service.capture({ attachmentId: 'attachment.synthetic.capture' }); assert.equal(first.status, 'available');
    deleteSession(state.session.id);
    assert.deepEqual({ ...await state.service.capture({ attachmentId: 'attachment.synthetic.capture' }) }, denied);
    const other = fixture();
    assert.deepEqual({ ...await other.service.capture({ attachmentId: first.captureHandle }) }, denied);
});
