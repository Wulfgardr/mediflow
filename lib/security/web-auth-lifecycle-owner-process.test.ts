/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OWNER = path.join(ROOT, 'packages/web-auth-lifecycle-owner/internal/owner.cjs');
const ENTRY = path.join(ROOT, 'packages/web-auth-lifecycle-owner/index.js');
const ACTIVATION = path.join(ROOT, 'packages/web-auth-lifecycle-owner/internal/session-activation.cjs');
const RETIREMENT = path.join(ROOT, 'packages/web-auth-lifecycle-owner/internal/session-retirement.cjs');
const CELLS = path.join(ROOT, 'packages/web-auth-lifecycle-owner/internal/session-cell.cjs');

const CHILD = String.raw`
const assert = require('node:assert/strict');
const entry = require(process.argv[1]);
const { createOwner } = require(process.argv[2]);
const scenario = process.argv[3];
const request = (control, suffix) => ({
    controlId: control.controlId,
    ifMatch: control.etag,
    idempotencyKey: 'synthetic-idempotency-' + suffix,
});
const issue = (owner, suffix, role = 'clinician', userId = 'user.synthetic.' + suffix) => {
    const control = owner.bootstrapControl();
    assert.ok(control);
    const attempt = owner.begin('login', request(control, 'login-' + suffix));
    assert.ok(attempt);
    const issued = owner.issue(attempt, { id: userId, username: 'synthetic-' + suffix, role });
    assert.ok(issued);
    assert.equal(owner.issue(attempt, { id: 'forged', username: 'forged', role }), null);
    return { ...issued, controlId: control.controlId, bootstrapEtag: control.etag };
};
const resolve = (owner, issued) => owner.resolve(issued.sessionId, issued.controlId);

assert.equal(Object.isFrozen(entry), true);
assert.deepEqual(Reflect.ownKeys(entry).slice().sort(), [
    'abort', 'abortAdminReset', 'abortResourceUse', 'abortUserRetirement', 'begin', 'beginResourceUse',
    'bootstrapControl', 'commitAdminReset', 'commitResourceUse', 'commitUserRetirement', 'issue',
    'mintResourcePort', 'prepareAdminReset', 'prepareUserRetirement', 'registerPrivateResource',
    'releaseResourcePort', 'resolve', 'retire', 'retireForUser',
    'unregisterPrivateResource',
]);
assert.equal('createOwner' in entry, false);

if (scenario === 'lifecycle') {
    const owner = entry;
    const issued = issue(owner, 'lifecycle');
    const active = resolve(owner, issued);
    assert.equal(active.status, 'active');
    assert.equal(Object.isFrozen(active.projection), true);
    assert.equal(active.projection.expiresAt - active.projection.createdAt, Number(process.argv[4]));
    assert.equal(owner.resolve(issued.sessionId, '0'.repeat(64)).status, 'owned_denied');
    const forged = Object.freeze({ ...active.projection });
    assert.equal(owner.retire(forged, 'dispose').outcome, 'denied');
    const port = owner.mintResourcePort(active.projection);
    assert.ok(port);
    const use = owner.beginResourceUse(port);
    assert.ok(use);
    assert.equal(owner.commitResourceUse(use), true);
    assert.equal(owner.commitResourceUse(use), false);
    const cleanup = [];
    assert.ok(owner.registerPrivateResource(port, (reason) => { cleanup.push(reason); }));
    const lockRequest = {
        controlId: issued.controlId,
        ifMatch: issued.etag,
        idempotencyKey: 'synthetic-idempotency-lock-lifecycle',
    };
    const locked = owner.retire(active.projection, 'lock', lockRequest);
    assert.equal(locked.outcome, 'completed');
    assert.match(locked.etag, /^[0-9a-f]{64}$/u);
    assert.deepEqual(cleanup, ['lock']);
    assert.deepEqual(owner.retire(active.projection, 'lock', lockRequest), locked);
    assert.equal(resolve(owner, issued).status, 'owned_denied');
    assert.equal(owner.beginResourceUse(port), null);
} else if (scenario === 'pending-lock') {
    const owner = entry;
    const control = owner.bootstrapControl();
    assert.ok(control);
    const attempt = owner.begin('login', request(control, 'pending'));
    assert.ok(attempt);
    const lockRequest = {
        controlId: control.controlId,
        ifMatch: control.etag,
        idempotencyKey: 'synthetic-idempotency-lock-pending',
    };
    const locked = owner.retire(null, 'lock', lockRequest);
    assert.equal(locked.outcome, 'completed');
    assert.deepEqual(owner.retire(null, 'lock', lockRequest), locked);
    assert.equal(owner.issue(attempt, { id: 'user.synthetic.late', username: 'synthetic-late', role: 'clinician' }), null);
    assert.equal(owner.begin('login', request(control, 'stale')), null);
    const next = { controlId: control.controlId, etag: locked.etag };
    const fresh = owner.begin('login', request(next, 'fresh'));
    assert.ok(fresh);
    assert.ok(owner.issue(fresh, { id: 'user.synthetic.fresh', username: 'synthetic-fresh', role: 'clinician' }));
} else if (scenario === 'lock-failure-latch') {
    const owner = createOwner();
    const issued = issue(owner, 'lock-failure');
    const active = resolve(owner, issued);
    assert.equal(active.status, 'active');
    const replayAttempt = owner.begin('login', {
        controlId: issued.controlId,
        ifMatch: issued.bootstrapEtag,
        idempotencyKey: 'synthetic-idempotency-login-lock-failure',
    });
    assert.ok(replayAttempt);
    const port = owner.mintResourcePort(active.projection);
    assert.ok(port);
    assert.ok(owner.registerPrivateResource(port, () => { throw new Error('synthetic lock cleanup'); }));
    const lockRequest = {
        controlId: issued.controlId,
        ifMatch: issued.etag,
        idempotencyKey: 'synthetic-idempotency-lock-failure',
    };
    const failed = owner.retire(active.projection, 'lock', lockRequest);
    assert.equal(failed.outcome, 'failed');
    assert.match(failed.etag, /^[0-9a-f]{64}$/u);
    assert.notEqual(failed.etag, issued.etag);
    assert.deepEqual(owner.retire(active.projection, 'lock', lockRequest), failed);
    const nextLockRequest = {
        controlId: issued.controlId,
        ifMatch: failed.etag,
        idempotencyKey: 'synthetic-idempotency-lock-failure-next',
    };
    assert.deepEqual(owner.retire(active.projection, 'lock', nextLockRequest), failed);
    assert.deepEqual(owner.retire(active.projection, 'lock', nextLockRequest), failed);
    const poisonedAttempt = owner.begin('login', {
        controlId: issued.controlId,
        ifMatch: failed.etag,
        idempotencyKey: 'synthetic-idempotency-login-after-lock-failure',
    });
    assert.equal(poisonedAttempt, null);
    const poisonedUser = {
        id: 'user.synthetic.poisoned', username: 'synthetic-poisoned', role: 'clinician',
    };
    assert.equal(owner.issue(replayAttempt, poisonedUser), null);
    assert.equal(owner.issue(poisonedAttempt, poisonedUser), null);
    assert.equal(resolve(owner, issued).status, 'owned_denied');
    const restarted = createOwner();
    assert.equal(restarted.resolve(issued.sessionId, issued.controlId).status, 'absent');
    const fresh = issue(restarted, 'after-lock-failure-restart');
    assert.equal(resolve(restarted, fresh).status, 'active');
} else if (scenario === 'reset') {
    const owner = entry;
    const admin = issue(owner, 'admin', 'admin');
    const sibling = issue(owner, 'sibling');
    const active = resolve(owner, admin);
    assert.equal(active.status, 'active');
    const aborted = owner.prepareAdminReset(active.projection);
    assert.ok(aborted);
    assert.equal(resolve(owner, admin).status, 'owned_denied');
    assert.equal(owner.abortAdminReset(aborted), true);
    assert.equal(owner.abortAdminReset(aborted), false);
    assert.equal(resolve(owner, admin).status, 'active');
    assert.equal(resolve(owner, sibling).status, 'active');
    const adminPort = owner.mintResourcePort(active.projection);
    const siblingActive = resolve(owner, sibling);
    const siblingPort = owner.mintResourcePort(siblingActive.projection);
    assert.ok(adminPort);
    assert.ok(siblingPort);
    let nested = null;
    let thenCalls = 0;
    assert.ok(owner.registerPrivateResource(adminPort, () => { throw new Error('synthetic reset cleanup'); }));
    assert.ok(owner.registerPrivateResource(siblingPort, () => {
        nested = resolve(owner, admin).status;
        return { then() { thenCalls += 1; } };
    }));
    const prepared = owner.prepareAdminReset(active.projection);
    assert.ok(prepared);
    const originalNow = Date.now;
    Date.now = () => { throw new Error('reset commit must not read a clock'); };
    const committed = owner.commitAdminReset(prepared);
    Date.now = originalNow;
    assert.equal(committed.outcome, 'failed');
    assert.equal(nested, 'owned_denied');
    assert.equal(thenCalls, 0);
    assert.equal(owner.commitAdminReset(prepared).outcome, 'denied');
    assert.equal(resolve(owner, admin).status, 'owned_denied');
    assert.equal(resolve(owner, sibling).status, 'owned_denied');
} else if (scenario === 'retire-user') {
    const owner = entry;
    const userId = 'user.synthetic.shared';
    const first = issue(owner, 'shared-a', 'clinician', userId);
    const second = issue(owner, 'shared-b', 'clinician', userId);
    const other = issue(owner, 'other');
    const firstActive = resolve(owner, first);
    assert.equal(firstActive.status, 'active');
    assert.equal(owner.retireForUser(Object.freeze({ ...firstActive.projection })).outcome, 'denied');
    assert.equal(owner.retireForUser(firstActive.projection).outcome, 'completed');
    assert.equal(resolve(owner, first).status, 'owned_denied');
    assert.equal(resolve(owner, second).status, 'owned_denied');
    assert.equal(resolve(owner, other).status, 'active');
} else if (scenario === 'user-retirement-capability') {
    const owner = createOwner();
    const userId = 'user.synthetic.capability';
    const initiator = issue(owner, 'capability-initiator', 'clinician', userId);
    const sibling = issue(owner, 'capability-sibling', 'clinician', userId);
    const other = issue(owner, 'capability-other');
    const pendingControl = owner.bootstrapControl();
    assert.ok(pendingControl);
    const pending = owner.begin('login', request(pendingControl, 'capability-pre-prepare'));
    assert.ok(pending);
    const initiatorActive = resolve(owner, initiator);
    const siblingActive = resolve(owner, sibling);
    assert.equal(initiatorActive.status, 'active');
    assert.equal(siblingActive.status, 'active');
    assert.equal(owner.prepareUserRetirement(Object.freeze({ ...initiatorActive.projection })), null);
    const capability = owner.prepareUserRetirement(initiatorActive.projection);
    assert.ok(capability);
    assert.equal(Object.isFrozen(capability), true);
    const overlapping = owner.prepareUserRetirement(siblingActive.projection);
    assert.ok(overlapping);
    assert.equal(owner.abortUserRetirement(overlapping), true);
    const duringControl = owner.bootstrapControl();
    assert.ok(duringControl);
    assert.equal(owner.begin('login', request(duringControl, 'capability-during-prepare')), null);
    assert.equal(owner.commitUserRetirement(Object.freeze({ ...capability })).outcome, 'denied');
    const foreignOwner = createOwner();
    assert.equal(foreignOwner.commitUserRetirement(capability).outcome, 'denied');
    assert.equal(foreignOwner.abortUserRetirement(capability), false);
    const locked = owner.retire(initiatorActive.projection, 'lock', {
        controlId: initiator.controlId,
        ifMatch: initiator.etag,
        idempotencyKey: 'synthetic-idempotency-capability-lock',
    });
    assert.equal(locked.outcome, 'completed');
    assert.equal(resolve(owner, initiator).status, 'owned_denied');
    assert.equal(resolve(owner, sibling).status, 'active');
    assert.equal(owner.commitUserRetirement(capability).outcome, 'completed');
    assert.equal(owner.commitUserRetirement(capability).outcome, 'denied');
    assert.equal(owner.abortUserRetirement(capability), false);
    assert.equal(owner.issue(pending, {
        id: userId, username: 'synthetic-capability-pending', role: 'clinician',
    }), null);
    assert.equal(resolve(owner, sibling).status, 'owned_denied');
    assert.equal(resolve(owner, other).status, 'active');

    const abortable = issue(owner, 'capability-abort', 'clinician', userId);
    const abortableActive = resolve(owner, abortable);
    assert.equal(abortableActive.status, 'active');
    const preAbortControl = owner.bootstrapControl();
    assert.ok(preAbortControl);
    const preAbortAttempt = owner.begin('login', request(preAbortControl, 'capability-pre-abort'));
    assert.ok(preAbortAttempt);
    const aborted = owner.prepareUserRetirement(abortableActive.projection);
    assert.ok(aborted);
    const postAbortControl = owner.bootstrapControl();
    assert.ok(postAbortControl);
    assert.equal(owner.begin('login', request(postAbortControl, 'capability-during-abort')), null);
    assert.equal(owner.abortUserRetirement(aborted), true);
    assert.equal(owner.abortUserRetirement(aborted), false);
    assert.equal(owner.commitUserRetirement(aborted).outcome, 'denied');
    assert.equal(owner.issue(preAbortAttempt, {
        id: userId, username: 'synthetic-capability-stale', role: 'clinician',
    }), null);
    const postAbortAttempt = owner.begin('login', request(postAbortControl, 'capability-post-abort'));
    assert.ok(postAbortAttempt);
    const postAbortIssue = owner.issue(postAbortAttempt, {
        id: userId, username: 'synthetic-capability-post-abort', role: 'clinician',
    });
    assert.ok(postAbortIssue);
    assert.equal(resolve(owner, abortable).status, 'active');
    const postAbort = { ...postAbortIssue, controlId: postAbortControl.controlId };
    const postAbortActive = resolve(owner, postAbort);
    assert.equal(postAbortActive.status, 'active');
    const abortablePort = owner.mintResourcePort(abortableActive.projection);
    const postAbortPort = owner.mintResourcePort(postAbortActive.projection);
    assert.ok(abortablePort);
    assert.ok(postAbortPort);
    const cleanup = [];
    let nested = null;
    assert.ok(owner.registerPrivateResource(abortablePort, (reason) => {
        cleanup.push('initiator:' + reason);
        nested = resolve(owner, postAbort).status;
    }));
    assert.ok(owner.registerPrivateResource(postAbortPort, (reason) => {
        cleanup.push('sibling:' + reason);
        throw new Error('synthetic sibling cleanup failure');
    }));
    const reentrant = owner.prepareUserRetirement(abortableActive.projection);
    assert.ok(reentrant);
    assert.equal(owner.commitUserRetirement(reentrant).outcome, 'failed');
    assert.equal(nested, 'owned_denied');
    assert.deepEqual(cleanup, ['initiator:delete', 'sibling:delete']);
    assert.equal(resolve(owner, abortable).status, 'owned_denied');
    assert.equal(resolve(owner, postAbort).status, 'owned_denied');
} else if (scenario === 'reentry') {
    const owner = entry;
    const first = issue(owner, 'reentry');
    const other = issue(owner, 'reentry-other');
    const active = resolve(owner, first);
    const port = owner.mintResourcePort(active.projection);
    assert.ok(port);
    let nested = null;
    assert.ok(owner.registerPrivateResource(port, () => { nested = resolve(owner, other).status; }));
    assert.equal(owner.retire(active.projection, 'dispose').outcome, 'denied');
    assert.equal(nested, 'owned_denied');
    assert.equal(resolve(owner, first).status, 'owned_denied');
    assert.equal(resolve(owner, other).status, 'active');
} else if (scenario === 'intrinsics') {
    const owner = entry;
    const issued = issue(owner, 'intrinsics');
    const originalAssign = Object.assign;
    Object.assign = () => { throw new Error('mutable Object.assign reached'); };
    const active = resolve(owner, issued);
    Object.assign = originalAssign;
    assert.equal(active.status, 'active');
} else if (scenario === 'restart') {
    const first = createOwner();
    const issued = issue(first, 'restart');
    const active = resolve(first, issued);
    assert.equal(active.status, 'active');
    const second = createOwner();
    assert.equal(second.resolve(issued.sessionId, issued.controlId).status, 'absent');
    assert.equal(second.retireForUser(active.projection).outcome, 'denied');
} else {
    throw new Error('unknown scenario');
}
process.stdout.write('pass');
`;

function runScenario(
    scenario: 'intrinsics' | 'lifecycle' | 'lock-failure-latch' | 'pending-lock' | 'reentry' | 'reset'
        | 'restart' | 'retire-user' | 'user-retirement-capability',
    ttl = '28800000',
    environment: NodeJS.ProcessEnv = process.env,
): void {
    const result = spawnSync(process.execPath, ['-e', CHILD, ENTRY, OWNER, scenario, ttl], {
        cwd: ROOT,
        env: { ...environment, NODE_ENV: 'test' },
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'pass');
}

test('activates the final frozen root and binds lifecycle authority to control plus bearer', () => {
    runScenario('lifecycle');
});

test('advances lock before a pending auth can issue and replays the bounded receipt', () => {
    runScenario('pending-lock');
});

test('latches lock cleanup failure on its control until process restart', () => {
    runScenario('lock-failure-latch');
});

test('prepares admin reset before mutation and keeps abort distinct from commit', () => {
    runScenario('reset');
});

test('requires one exact current projection for same-user retirement', () => {
    runScenario('retire-user');
});

test('commits an opaque per-user retirement after the initiating projection is locked', () => {
    runScenario('user-retirement-capability');
});

test('poisons an outer owner operation on disposer reentry', () => {
    runScenario('reentry');
});

test('uses captured resolver intrinsics when Object.assign is hostile', () => {
    runScenario('intrinsics');
});

test('reads the configured session TTL once and denies an invalid present value', () => {
    runScenario('lifecycle', '60000', { ...process.env, MEDIFLOW_SESSION_TTL_MS: '60000' });
    const invalid = spawnSync(process.execPath, ['-e', [
        "const assert=require('node:assert/strict');",
        "const owner=require(process.argv[1]);",
        "const control=owner.bootstrapControl();",
        "const attempt=owner.begin('login',{controlId:control.controlId,ifMatch:control.etag,idempotencyKey:'synthetic-idempotency-invalid-ttl'});",
        "assert.ok(attempt);",
        "assert.equal(owner.issue(attempt,{id:'user.synthetic.invalid',username:'synthetic-invalid',role:'admin'}),null);",
    ].join(''), ENTRY], {
        cwd: ROOT,
        env: { ...process.env, NODE_ENV: 'test', MEDIFLOW_SESSION_TTL_MS: 'invalid' },
        encoding: 'utf8',
    });
    assert.equal(invalid.status, 0, invalid.stderr);
});

test('keeps both successful P2 CAS tails to one total prevalidated cell flip', () => {
    const activation = readFileSync(ACTIVATION, 'utf8');
    const retirement = readFileSync(RETIREMENT, 'utf8');
    const cells = readFileSync(CELLS, 'utf8');
    const activationTake = activation.indexOf('cells.takeActivationCellCommit(cellState, record.cellCapability)');
    const activationCas = activation.indexOf('control.commitPreparedAuthControlActivation(controlState, record.controlCapability)');
    const activationFlip = activation.indexOf('cells.commitActivationCell(cellState);');
    assert.ok(activationTake > 0 && activationTake < activationCas && activationCas < activationFlip);
    assert.equal(activation.slice(activationFlip, activation.indexOf('\n}', activationFlip)).trim(),
        'cells.commitActivationCell(cellState);\n    return true;');
    const retirementTake = retirement.indexOf('cells.takeRetirementCellCommit(cellState, record.cellCapability)');
    const retirementCas = retirement.indexOf('control.commitPreparedAuthControlRetirement(controlState, record.controlCapability)');
    const retirementFlip = retirement.indexOf('cells.commitRetirementCell(cellState);');
    assert.ok(retirementTake > 0 && retirementTake < retirementCas && retirementCas < retirementFlip);
    assert.equal(retirement.slice(retirementFlip, retirement.indexOf('\n}', retirementFlip)).trim(),
        'cells.commitRetirementCell(cellState);\n    return 2;');
    for (const [name, next] of [
        ['commitActivationCell', 'denyActivationCellCommit'],
        ['commitRetirementCell', 'denyRetirementCellCommit'],
    ] as const) {
        const start = cells.indexOf(`function ${name}(state) {`);
        const end = cells.indexOf(`function ${next}`, start);
        const body = cells.slice(start, end);
        assert.ok(start > 0 && end > start);
        assert.doesNotMatch(body, /\b(?:if|try|catch|for|while|Date|Map|Set|Reflect|Object)\b/u);
    }
});

test('denies locators and projections across process-local owners and restarts', () => {
    runScenario('restart');
    const producer = spawnSync(process.execPath, ['-e', [
        "const owner=require(process.argv[1]);",
        "const control=owner.bootstrapControl();",
        "const attempt=owner.begin('login',{controlId:control.controlId,ifMatch:control.etag,idempotencyKey:'synthetic-idempotency-process-a'});",
        "const issued=owner.issue(attempt,{id:'user.synthetic.process',username:'synthetic-process',role:'admin'});",
        "process.stdout.write(JSON.stringify({sessionId:issued.sessionId,controlId:control.controlId}));",
    ].join(''), ENTRY], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(producer.status, 0, producer.stderr);
    const artifact = JSON.parse(producer.stdout) as { sessionId: string; controlId: string };
    const consumer = spawnSync(process.execPath, ['-e', [
        "const owner=require(process.argv[1]);",
        "process.stdout.write(owner.resolve(process.argv[2],process.argv[3]).status);",
    ].join(''), ENTRY, artifact.sessionId, artifact.controlId], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(consumer.status, 0, consumer.stderr);
    assert.equal(consumer.stdout, 'absent');
});
