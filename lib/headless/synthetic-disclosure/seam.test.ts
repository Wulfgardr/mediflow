/* Real default policy only; invented data, no host, DB, model or file writes. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSyntheticDisclosureSession } from './seam';
import { evaluatePayload } from './evaluator';
import { payloadFor, encodePayload, payloadHash } from './contract';
import { createRedactionSession } from '../../ai-redaction-session';

test('explicit payload-bound consent cannot open the actual closed Fabric gate', async () => {
    let calls = 0;
    const session = createSyntheticDisclosureSession(async () => { calls++; });
    session.select('demo-a');
    const attempt = session.prepare('mcp_tool_result');
    assert.equal(await session.dispatch(attempt), 'consent_required');
    const disclosure = session.disclosure(attempt);
    assert.equal(disclosure.status, 'Proposed');
    assert.equal(disclosure.destination, 'in_process_synthetic_sink');
    assert.equal(session.confirm(attempt, 'wrong-hash'), false);
    assert.equal(session.confirm(attempt, disclosure.payloadSha256), true);
    assert.equal(await session.dispatch(attempt), 'denied');
    assert.equal(await session.dispatch(attempt), 'already_used');
    assert.equal(calls, 0);
});

test('lower-level redaction map stays local and never becomes evaluation output', async () => {
    const redaction = createRedactionSession();
    const original = 'Invented Ada: ada@example.invalid';
    const prepared = redaction.prepare({ text: original, entities: [], knownIdentifiers: { names: ['Ada'] } });
    assert.notEqual(prepared.redactedText, original);
    assert.equal(prepared.rehydrate(prepared.redactedText), original);
    const bytes = encodePayload('model_context', payloadFor('model_context', 'demo-a'));
    assert.deepEqual(await evaluatePayload(bytes), { status: 'denied', payloadSha256: payloadHash(bytes) });
    assert.doesNotMatch(bytes, /Ada|example\.invalid|MF_PII/u);
    redaction.close();
    assert.throws(() => prepared.rehydrate(prepared.redactedText), /closed/u);
});

test('forged/foreign handles, invalid selection and unbounded preparation cannot grant authority', async () => {
    const a = createSyntheticDisclosureSession(async () => {}), b = createSyntheticDisclosureSession(async () => {});
    assert.throws(() => a.prepare('model_context'), /unavailable/u);
    assert.throws(() => a.select('clinical-record'), /invalid/u);
    a.select('demo-a');
    const token = a.prepare('model_context');
    assert.equal(await b.dispatch(token), 'invalid');
    assert.equal(a.confirm(Object.freeze({}), a.disclosure(token).payloadSha256), false);
    for (let i = 1; i < 64; i++) a.prepare('model_context');
    assert.throws(() => a.prepare('model_context'), /unavailable/u);
    a.revoke();
    assert.throws(() => a.select('demo-b'), /closed/u);
});
