import { observeArchiveGeneration } from './security/client-auth-api';
import test from 'node:test';
import assert from 'node:assert/strict';
import { requestTherapyStatusCommand } from './therapy-status-command-client.ts';
import { parseTherapyStatusReceipt, THERAPY_STATUS_PROTOCOL, type TherapyStatusCommand } from './therapy-status-command-contract.ts';
const command: TherapyStatusCommand = { commandId: 'f8e0b652-b6bf-4975-9dbb-d9ac22b7680c', protocol: THERAPY_STATUS_PROTOCOL, archiveGeneration: '7a40bc6c-be0d-448a-b85f-691d71d6d2b7', patientId: 'synthetic-patient', therapyId: 'synthetic-therapy', expectedVersion: 4 };
const applied = { ...command, actorRef: 'synthetic-actor', target: 'completed' as const, outcome: 'applied' as const, reason: null, committedAt: 1783000000, resultVersion: 5, resultEndDate: 1783000000, auditEventId: '45a80849-c863-4b76-a56d-07f56bb06c5c' };
test('receipt parser rejects partial/forged booleans, target drift and non-host results', () => {
    assert.deepEqual(parseTherapyStatusReceipt(applied), applied);
    for (const patch of [{ outcome: true }, { resultVersion: 99 }, { resultEndDate: 0 }, { target: 'active' }, { reason: 'other' }, { auditEventId: null }, { committedAt: -0 }, { extra: true }]) assert.equal(parseTherapyStatusReceipt({ ...applied, ...patch }), null);
    const closed = { ...applied, target: null, outcome: 'closed', resultVersion: null, resultEndDate: null, auditEventId: null };
    assert.deepEqual(parseTherapyStatusReceipt(closed), closed); assert.equal(parseTherapyStatusReceipt({ ...closed, target: 'active' }), null);
});
test('client makes one request, rejects malformed response and never retries', async t => {
    observeArchiveGeneration(command.archiveGeneration);
    const calls: {input: unknown;init: RequestInit | undefined}[] = [];
    t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => { calls.push({input,init}); return Response.json({ outcome: 'terminal', historical: false, receipt: { ...applied, outcome: true } }); });
    await assert.rejects(requestTherapyStatusCommand('execute', { ...command, target: 'completed' }, new AbortController().signal));
    assert.equal(calls.length, 1); assert.equal(calls[0]!.init!.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0]!.init!.body as string), { ...command, target: 'completed' });
});
