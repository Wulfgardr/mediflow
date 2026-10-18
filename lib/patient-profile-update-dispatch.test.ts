import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import type { PatientProfileUpdateEnvelope } from './patient-profile-update-contract';

const load = createRequire(import.meta.url);
const writer = load('./patient-update-operation.ts') as typeof import('./patient-update-operation');
const { createPatientProfileUpdateExecution, dispatchPatientProfileUpdate } = load('./patient-profile-update-dispatch.ts') as typeof import('./patient-profile-update-dispatch');

function hostInput() {
    return {
        patientId: 'synthetic-dispatch-patient', expectedVersion: 7,
        values: { notes: 'ENC:synthetic:notes', birthDate: new Date(0), version: 8, updatedAt: new Date(1000) },
        setPrimaryAmbulatory: false,
        audit: { archiveGeneration: 'synthetic-generation', actorType: 'system' as const, actorRef: 'local-api',
            sourceSurface: 'api' as const, requestId: 'caller-correlation-only', flags: ['auth:local-token'] },
    };
}
const denied = { status: 409, value: { code: 'VERSION_CONFLICT' } } as const;

test('host envelope has explicit normalized payload, service author, admission and non-attested confirmation', () => {
    const input = hostInput();
    const execution = createPatientProfileUpdateExecution(input);
    const command = execution.command;
    assert.equal(command.operationId, 'patient-profile.update.v1');
    assert.equal(command.contractVersion, 1);
    assert.equal(command.executor, 'legacy-node');
    assert.equal(command.purpose, 'patient-profile-update');
    assert.deepEqual(command.author, { kind: 'system', ref: 'local-api', surface: 'api' });
    assert.deepEqual(command.authorization, { kind: 'existing-host-admission', commitGuard: 'archive-audit' });
    assert.equal(command.confirmation, 'legacy-not-attested');
    assert.equal(command.correlationId, 'caller-correlation-only');
    assert.notEqual(command.executionId, command.idempotencyKey);
    assert.notEqual(command.correlationId, command.idempotencyKey);
    assert.deepEqual(command.payload, { notes: 'ENC:synthetic:notes', birthDate: '1970-01-01T00:00:00.000Z' });
    assert.equal(command.normalizedAt, '1970-01-01T00:00:01.000Z');
    for (const part of [execution, command, command.payload, command.author, command.authorization, command.scope, command.target]) assert.ok(Object.isFrozen(part));
    input.values.notes = 'changed'; input.values.birthDate.setTime(999); input.audit.actorRef = 'changed';
    assert.equal(command.payload.notes, 'ENC:synthetic:notes');
    assert.equal(command.payload.birthDate, '1970-01-01T00:00:00.000Z');
    assert.equal(command.author.ref, 'local-api');
    assert.notEqual(createPatientProfileUpdateExecution(hostInput()).command.idempotencyKey, command.idempotencyKey);
});

test('concurrent duplicate dispatch shares the exact Promise and result with only one writer call', async t => {
    const call = t.mock.method(writer, 'updatePatientOperation', () => denied);
    const execution = createPatientProfileUpdateExecution(hostInput());
    const first = dispatchPatientProfileUpdate(execution, execution.command);
    const second = dispatchPatientProfileUpdate(execution, structuredClone(execution.command));
    assert.equal(first, second);
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, b); assert.equal(a.kind, 'refused');
    if (a.kind !== 'refused') throw new Error('Expected refused outcome');
    assert.equal(a.result, denied);
    assert.equal(a.executionId, execution.command.executionId);
    assert.equal(a.idempotencyKey, execution.command.idempotencyKey);
    assert.equal(a.purpose, 'patient-profile-update');
    assert.equal(call.mock.callCount(), 1);
    assert.equal(dispatchPatientProfileUpdate(execution, execution.command), first);
});

test('synchronous reentry from inside the writer sees the registered Promise before any second effect', async t => {
    const execution = createPatientProfileUpdateExecution(hostInput());
    let reentered: ReturnType<typeof dispatchPatientProfileUpdate> | undefined;
    let inside = false;
    const call = t.mock.method(writer, 'updatePatientOperation', () => {
        if (!inside) { inside = true; reentered = dispatchPatientProfileUpdate(execution, execution.command); }
        return denied;
    });
    const first = dispatchPatientProfileUpdate(execution, execution.command);
    assert.equal(reentered, first);
    assert.equal(call.mock.callCount(), 1);
    const outcome = await first; assert.equal(outcome.kind, 'refused');
    if (outcome.kind === 'refused') assert.equal(outcome.result, denied);
});

test('wrong key, command, executor, author, admission or confirmation cannot dispatch or rearm the context', async t => {
    const call = t.mock.method(writer, 'updatePatientOperation', () => denied);
    const execution = createPatientProfileUpdateExecution(hostInput());
    const command = execution.command;
    const variants = [
        { ...command, idempotencyKey: 'caller-key' },
        { ...command, payload: { notes: 'another-command' } },
        { ...command, executor: 'rust' },
        { ...command, purpose: 'claimed-purpose' },
        { ...command, author: { ...command.author, ref: 'claimed-doctor' } },
        { ...command, authorization: { kind: 'claimed-approval' } },
        { ...command, confirmation: 'human-confirmed' },
        { ...command, target: { ...command.target, patientId: 'another-patient' } },
        { ...command, operationId: 'patient-profile.read.v1' },
    ];
    for (const candidate of variants) await assert.rejects(dispatchPatientProfileUpdate(execution, candidate as PatientProfileUpdateEnvelope), /command mismatch/);
    await assert.rejects(dispatchPatientProfileUpdate({ command } as typeof execution, command), /execution unavailable/);
    assert.equal(call.mock.callCount(), 0);
    await dispatchPatientProfileUpdate(execution, command);
    for (const candidate of variants) await assert.rejects(dispatchPatientProfileUpdate(execution, candidate as PatientProfileUpdateEnvelope), /command mismatch/);
    assert.equal(call.mock.callCount(), 1);
});

test('an exception after dispatch start remains the same terminal uncertain outcome without retry or fallback', async t => {
    const failure = new Error('Synthetic uncertain outcome after executor start');
    let starts = 0;
    t.mock.method(writer, 'updatePatientOperation', () => { starts++; throw failure; });
    const execution = createPatientProfileUpdateExecution(hostInput());
    const first = dispatchPatientProfileUpdate(execution, execution.command);
    const outcome = await first; assert.equal(outcome.kind, 'uncertain');
    assert.equal(outcome.executionId, execution.command.executionId);
    assert.equal(outcome.idempotencyKey, execution.command.idempotencyKey);
    assert.equal(outcome.purpose, 'patient-profile-update');
    if (outcome.kind !== 'uncertain') throw new Error('Expected uncertain outcome');
    assert.equal(outcome.error, failure);
    const again = dispatchPatientProfileUpdate(execution, execution.command);
    assert.equal(again, first); assert.equal(await again, outcome);
    assert.equal(starts, 1);
});

test('legacy executor consumes command target, payload and host guard before returning a cached denial', async t => {
    const input = hostInput();
    const guard = () => null;
    let received: Parameters<typeof writer.updatePatientOperation>[0] | undefined;
    t.mock.method(writer, 'updatePatientOperation', (value: Parameters<typeof writer.updatePatientOperation>[0]) => { received = value; return { status: 401, value: { error: 'Unauthorized' } }; });
    const execution = createPatientProfileUpdateExecution({ ...input, scopeAmbulatoryId: 'synthetic-ambulatory', authorizeCommit: guard });
    assert.deepEqual(execution.command.authorization, { kind: 'existing-host-admission', commitGuard: 'paired-transaction' });
    const result = await dispatchPatientProfileUpdate(execution, execution.command);
    assert.equal(result.kind, 'refused');
    if (result.kind !== 'refused') throw new Error('Expected refused outcome');
    assert.equal(result.result.status, 401);
    assert.ok(received);
    assert.equal(received.patientId, input.patientId); assert.equal(received.expectedVersion, 7);
    assert.equal(received.values.notes, input.values.notes);
    assert.equal(received.values.birthDate?.getTime(), 0);
    assert.equal(received.values.updatedAt?.getTime(), 1000);
    assert.equal(received.scopeAmbulatoryId, 'synthetic-ambulatory');
    assert.equal(received.authorizeCommit, guard);
    assert.deepEqual(received.audit, input.audit);
    assert.equal(await dispatchPatientProfileUpdate(execution, execution.command), result);
});
