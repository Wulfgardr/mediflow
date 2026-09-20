/* @Codex — synthetic NER transport only; genuine native issuer and original content parsers. */
'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const f = require('./native-ordinary.test-support.cjs');
let closes = 0, extracts = 0, closeFailure = false;
f.replace('lib/gliner-redaction-runner.ts', {
    createGlinerRedactionRunner: () => ({
        async extract(text) { extracts++; return [...text.matchAll(/Bea Riva/gu)].map(m => ({ start: m.index, end: m.index + m[0].length, type: 'person', text: m[0], confidence: 1 })); },
        async close() { closes++; if (closeFailure) throw new Error('synthetic cleanup transport failure'); },
    }),
    readGlinerRuntimeObservation: () => null,
});
const fixture = require('../chatgpt-execution/ordinary-content.test-support.ts');
const prepared = require('../chatgpt-execution/ordinary-preparation.ts');
const consent = require('../chatgpt-product/product-consent.ts');
const common = require('./ordinary-session-authority.ts');
const lifecycle = require('./native-inference-lifecycle.ts');
let jobs = [];
const binding = { contextRevision: 'synthetic-context', attemptRevision: 'synthetic-attempt', qualificationRevision: 'synthetic-NOT-QUALIFIED', remainingMs: 300000 };
beforeEach(() => { f.reset(); jobs = []; closes = extracts = 0; closeFailure = false; });
afterEach(async () => { closeFailure = false; await Promise.all(jobs.map(job => job.close().catch(() => {}))); f.reset(); });
async function preparation(index = 0) {
    const job = prepared.createOrdinaryPreparation(fixture.profiles()[index], fixture.configuration);
    jobs.push(job); return job.ready;
}
for (const [index, functionId] of ['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'].entries()) {
    test(`${functionId}: genuine native consent binds exact frozen UTF-8 and original output parser; no execution`, async () => {
        const session = f.issue(), token = await preparation(index), read = prepared.readPreparedOrdinaryProfile(token);
        assert.equal(read.functionId, functionId); assert.equal(read.payloadBytes, Buffer.byteLength(read.payload, 'utf8'));
        assert.equal(read.payloadSha256, createHash('sha256').update(read.payload, 'utf8').digest('hex'));
        assert.equal(read.payload.includes('Bea Riva'), false); assert.equal(read.redactionIdentity, null);
        const grant = await consent.createOrdinaryProductConsent(session, token, binding), disclosure = grant.disclosure();
        assert.equal(disclosure.payloadSha256, read.payloadSha256); assert.equal(disclosure.sourceSha256, read.sourceSha256);
        assert.equal(disclosure.payloadBytes, read.payloadBytes); assert.equal(disclosure.operation, functionId);
        assert.equal(disclosure.proposalOnly, true); assert.equal(disclosure.clinicalWrites, 0);
        assert.throws(() => consent.assertOrdinaryProductConsent(grant.token, token));
        assert.throws(() => grant.grant({ operation: 'wrong_function', expectedDisclosureRevision: disclosure.revision }));
        assert.throws(() => grant.grant({ operation: functionId, expectedDisclosureRevision: 'wrong_revision' }));
        grant.grant({ operation: functionId, expectedDisclosureRevision: disclosure.revision });
        assert.doesNotThrow(() => consent.assertOrdinaryProductConsent(grant.token, token));
        assert.throws(() => consent.assertOrdinaryProductConsent(Object.freeze({ ...grant.token }), token));
        assert.throws(() => grant.grant({ operation: functionId, expectedDisclosureRevision: disclosure.revision }));
        const output = JSON.stringify(fixture.outputs()[index]).replaceAll('Bea Riva', fixture.tokenFrom(read.payload));
        assert.ok(read.parseOutput(output));
        await assert.rejects(consent.createOrdinaryProductConsent(session, token, binding));
        // Second registration cannot replace the original grant or preparation.
        assert.doesNotThrow(() => consent.assertOrdinaryProductConsent(grant.token, token));
        grant.close(); assert.throws(() => consent.assertOrdinaryProductConsent(grant.token, token));
        await jobs[0].close(); assert.equal(closes, 2); assert.ok(extracts > 0);
    });
}
test('native capability retirement physically closes original content and consent; clone cannot adopt', async () => {
    const session = f.issue(), token = await preparation(), grant = await consent.createOrdinaryProductConsent(session, token, binding);
    grant.grant({ operation: 'patient_insight', expectedDisclosureRevision: grant.disclosure().revision });
    f.pair({ grantedCapabilities: ['native.ai.configure'] });
    assert.throws(() => consent.assertOrdinaryProductConsent(grant.token, token));
    await jobs[0].close(); assert.equal(closes, 2);
    f.pair(); assert.equal(lifecycle.mintResourcePort(session), null);
    assert.throws(() => prepared.readPreparedOrdinaryProfile(token));
    await assert.rejects(consent.createOrdinaryProductConsent({ ...session }, token, binding));
});
test('content and consent from another genuine native session are not interchangeable', async () => {
    const a = f.issue(), b = f.issue(), p = await preparation(), q = await preparation(1);
    const ga = await consent.createOrdinaryProductConsent(a, p, binding), gb = await consent.createOrdinaryProductConsent(b, q, binding);
    ga.grant({ operation: 'patient_insight', expectedDisclosureRevision: ga.disclosure().revision });
    gb.grant({ operation: 'smart_import', expectedDisclosureRevision: gb.disclosure().revision });
    assert.throws(() => consent.assertOrdinaryProductConsent(ga.token, q));
    f.owner.serverSessions.deleteSession(a.id);
    assert.throws(() => consent.assertOrdinaryProductConsent(ga.token, p));
    assert.doesNotThrow(() => consent.assertOrdinaryProductConsent(gb.token, q));
    gb.close();
});
test('original native expiry, not sliding session expiry, caps the shared authority lifetime', () => {
    const session = f.issue(), initial = session.expiresAt, port = common.mintResourcePort(session);
    assert.ok(port); session.expiresAt += 3600000;
    assert.equal(common.readResourceExpiresAt(port, session.expiresAt), initial);
    common.releaseResourcePort(port);
});
test('an async or non-void binding cannot leave a native use committable', () => {
    const port = lifecycle.mintResourcePort(f.issue()), use = lifecycle.beginResourceUse(port);
    assert.equal(lifecycle.withCurrentResourceBinding(use, async () => undefined), false);
    assert.equal(lifecycle.commitResourceUse(use), false);
    lifecycle.releaseResourcePort(port);
});
test('unconfirmed NER cleanup rejects; disposal is not reported successful by a timer', async () => {
    const token = await preparation(); assert.ok(token); closeFailure = true;
    await assert.rejects(jobs[0].close(), /ordinary_cleanup_unconfirmed/);
    assert.throws(() => prepared.readPreparedOrdinaryProfile(token));
});
test('a real native attempt cannot progress past a held platform; no transport or catalog starts', async () => {
    const { createOrdinaryProductAttempt } = require('../chatgpt-execution/ordinary-product-attempt.ts');
    let created = 0, platformClosed = 0;
    const platform = { snapshot: () => ({ platform: 'darwin', state: 'unqualified', revision: 'synthetic-held', missing: ['parent-qualification'] }),
        async create() { created++; throw new Error('must not create'); }, async close() { platformClosed++; } };
    const attempt = await createOrdinaryProductAttempt(f.issue(), platform);
    await assert.rejects(attempt.prepare(fixture.profiles()[0], 'synthetic-context', fixture.configuration, new AbortController().signal), /unqualified_boundary/);
    assert.equal(created, 0); assert.equal((await attempt.dispose()).cleanupConfirmed, true); assert.equal(platformClosed, 1);
    assert.throws(() => attempt.snapshot());
});
test('attempt cleanup failure remains unconfirmed and does not mint qualification', async () => {
    const { createOrdinaryProductAttempt } = require('../chatgpt-execution/ordinary-product-attempt.ts');
    const attempt = await createOrdinaryProductAttempt(f.issue(), { snapshot: () => ({ platform: 'darwin', state: 'unqualified', revision: 'synthetic-held', missing: [] }),
        async create() { throw new Error('must not create'); }, async close() { throw new Error('synthetic cleanup failure'); } });
    await assert.rejects(attempt.prepare(fixture.profiles()[0], 'synthetic-context', fixture.configuration, new AbortController().signal));
    assert.equal((await attempt.dispose()).cleanupConfirmed, false);
});
