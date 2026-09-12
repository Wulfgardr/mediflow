/* @Codex: real unchanged 0.8.7 physical owner. No auth doubles. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PatientCreateContextRegistry, PATIENT_CREATE_CONTEXT_LIMITS, readPatientCreateLane, PATIENT_CREATE_HEADERS } from './patient-create-context.ts';
import type * as Owner from '@mediflow/web-auth-lifecycle-owner';
const load = createRequire(import.meta.url);
const ownerPath = load.resolve(process.env.MEDIFLOW_TEST_OWNER_PATH ?? '@mediflow/web-auth-lifecycle-owner');
const owner = load(ownerPath) as typeof Owner;
function issue(suffix: string, userId = 'synthetic-context-user'): Owner.WebSessionProjection {
    const control = owner.bootstrapControl(); assert(control);
    const attempt = owner.begin('login', { controlId: control.controlId, ifMatch: control.etag, idempotencyKey: `synthetic-create-${suffix}` });
    assert(attempt); const issued = owner.issue(attempt, { id: userId, username: userId, role: 'admin' }); assert(issued);
    const resolved = owner.resolve(issued.sessionId, control.controlId); assert.equal(resolved.status, 'active');
    if (resolved.status !== 'active') throw new Error('Synthetic owner fixture failed');
    return resolved.projection;
}
const target = { id: 'synthetic-A', name: 'Ambulatorio sintetico A' };

test('physical package root is exact 0.8.7, not a shim', () => {
    assert.equal(JSON.parse(readFileSync(join(dirname(ownerPath), 'package.json'), 'utf8')).version, '0.8.7');
    assert.equal(createHash('sha256').update(readFileSync(ownerPath)).digest('hex'), '1abc52ee8abe9fd25b28046f1f00ecc2f09d699ba220c61e6222730c22ca44c5');
});
test('preview emits only inert bounded metadata; reusable only under the original generation', t => {
    const session = issue('metadata'); t.after(() => owner.retire(session, 'dispose'));
    const contexts = new PatientCreateContextRegistry(owner); const preview = contexts.capture(session, target); assert(preview);
    assert.deepEqual(Object.keys(preview).sort(), ['ambulatoryId', 'ambulatoryName', 'expiresAt', 'nonce', 'version']);
    assert.match(preview.nonce, /^[a-f0-9]{64}$/u); assert.equal(JSON.stringify(preview).includes(session.id), false);
    let calls = 0;
    for (let i = 0; i < 3; i += 1) assert.equal(contexts.withCurrentBinding(session, preview, id => { assert.equal(id, target.id); calls += 1; }), true);
    assert.equal(calls, 3);
});
test('same user, different active generation cannot reuse the preview', t => {
    const first = issue('first'); const second = issue('second');
    t.after(() => { owner.retire(first, 'dispose'); owner.retire(second, 'dispose'); });
    const contexts = new PatientCreateContextRegistry(owner); const preview = contexts.capture(first, target); assert(preview);
    let called = false;
    assert.equal(contexts.withCurrentBinding(second, preview, () => { called = true; }), false);
    assert.equal(called, false);
});
test('physical owner disposal invalidates preview and frees consumer capacity', () => {
    const session = issue('dispose'); const contexts = new PatientCreateContextRegistry(owner);
    const preview = contexts.capture(session, target); assert(preview);
    assert.equal(owner.retire(session, 'dispose').outcome, 'completed');
    assert.equal(contexts.withCurrentBinding(session, preview, () => { assert.fail('Retired generation callback'); }), false);
    assert.equal(contexts.capture(session, target), null);
});
test('TTL is inclusive at expiry, not silently renewed, and pruning releases the real owner registration', t => {
    const session = issue('ttl'); t.after(() => owner.retire(session, 'dispose'));
    let time = Date.now(); const contexts = new PatientCreateContextRegistry(owner, () => time);
    const preview = contexts.capture(session, target); assert(preview);
    time = preview.expiresAt - 1; assert.equal(contexts.withCurrentBinding(session, preview, () => {}), true);
    time += 1; assert.equal(contexts.withCurrentBinding(session, preview, () => { assert.fail('Expired callback'); }), false);
    const next = contexts.capture(session, target); assert(next); assert.notEqual(next.nonce, preview.nonce);
});
test('per-generation and process capacities deny without evicting a live preview; disposal frees capacity', t => {
    const contexts = new PatientCreateContextRegistry(owner); const sessions: Owner.WebSessionProjection[] = [];
    t.after(() => { for (const session of sessions) owner.retire(session, 'dispose'); });
    let firstPreview: ReturnType<typeof contexts.capture> = null;
    for (let i = 0; i < PATIENT_CREATE_CONTEXT_LIMITS.capacity / PATIENT_CREATE_CONTEXT_LIMITS.perGeneration; i += 1) {
        const session = issue(`cap-${i}`, `synthetic-cap-${i}`); sessions.push(session);
        for (let j = 0; j < PATIENT_CREATE_CONTEXT_LIMITS.perGeneration; j += 1) {
            const preview = contexts.capture(session, target); assert(preview); firstPreview ??= preview;
        }
        assert.equal(contexts.capture(session, target), null);
    }
    const next = issue('capacity-next'); sessions.push(next); assert.equal(contexts.capture(next, target), null);
    assert(firstPreview); assert.equal(contexts.withCurrentBinding(sessions[0], firstPreview, () => {}), true);
    owner.retire(sessions[0], 'dispose'); assert(contexts.capture(next, target));
});
test('mismatched/unknown/invalid preconditions never invoke operation or change target', t => {
    const session = issue('invalid'); t.after(() => owner.retire(session, 'dispose'));
    const contexts = new PatientCreateContextRegistry(owner); const preview = contexts.capture(session, target); assert(preview);
    for (const bad of [{ ...preview, nonce: '' }, { ...preview, nonce: 'f'.repeat(64) }, { ...preview, ambulatoryId: 'synthetic-B' }]) {
        assert.equal(contexts.withCurrentBinding(session, bad, () => assert.fail('Invalid precondition callback')), false);
    }
});
for (const mode of [undefined, '', 'legacy', 'fixed-preview-v2', 'fixed-preview-v1']) {
    test(`fenced headers cannot fall back when partial/invalid (${JSON.stringify(mode)})`, () => {
        const h = new Headers(); if (mode !== undefined) h.set(PATIENT_CREATE_HEADERS.mode, mode);
        h.set(PATIENT_CREATE_HEADERS.target, 'synthetic-A');
        assert.equal(readPatientCreateLane(h).kind, 'invalid');
    });
}
test('only no headers means legacy; valid triple means fenced; duplicate or orphan headers deny', () => {
    assert.equal(readPatientCreateLane(new Headers()).kind, 'legacy');
    const h = new Headers({ [PATIENT_CREATE_HEADERS.mode]: 'fixed-preview-v1',
        [PATIENT_CREATE_HEADERS.context]: 'a'.repeat(64), [PATIENT_CREATE_HEADERS.target]: target.id });
    assert.deepEqual(readPatientCreateLane(h), { kind: 'fenced', precondition: { nonce: 'a'.repeat(64), ambulatoryId: target.id } });
    h.append(PATIENT_CREATE_HEADERS.context, 'a'.repeat(64)); assert.equal(readPatientCreateLane(h).kind, 'invalid');
    h.delete(PATIENT_CREATE_HEADERS.context); h.delete(PATIENT_CREATE_HEADERS.mode); assert.equal(readPatientCreateLane(h).kind, 'invalid');
});
