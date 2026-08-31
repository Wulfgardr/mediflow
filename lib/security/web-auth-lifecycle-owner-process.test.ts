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
const { createOwner } = require(process.argv[1]);
const entry = require(process.argv[2]);
const scenario = process.argv[3];
const issue = (owner, suffix, role = 'clinician', userId = 'user.synthetic.' + suffix) => {
    const attempt = owner.begin('login');
    assert.ok(attempt);
    const issued = owner.issue(attempt, { id: userId, username: 'synthetic-' + suffix, role });
    assert.ok(issued);
    assert.equal(owner.issue(attempt, { id: 'forged', username: 'forged', role }), null);
    return issued;
};
assert.equal(Object.isFrozen(entry), true);
assert.deepEqual(Reflect.ownKeys(entry), []);
if (scenario === 'lifecycle') {
    const owner = createOwner();
    const issued = issue(owner, 'lifecycle');
    const active = owner.resolve(issued.sessionId);
    assert.equal(active.status, 'active');
    assert.equal(Object.isFrozen(active), true);
    assert.equal(Object.isFrozen(active.projection), true);
    assert.deepEqual(Object.keys(active.projection), ['id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt']);
    assert.equal(active.projection.id, issued.sessionId);
    assert.equal(active.projection.authChannel, 'web');
    assert.equal(active.projection.expiresAt - active.projection.createdAt, 8 * 60 * 60 * 1_000);
    const forged = Object.freeze({ ...active.projection });
    assert.equal(owner.retire(forged, 'lock').outcome, 'denied');
    assert.equal(owner.mintResourcePort(forged), null);
    const port = owner.mintResourcePort(active.projection);
    assert.ok(port);
    const use = owner.beginResourceUse(port);
    assert.ok(use);
    assert.equal(owner.commitResourceUse(use), true);
    assert.equal(owner.commitResourceUse(use), false);
    const cleanup = [];
    assert.ok(owner.registerPrivateResource(port, (reason) => { cleanup.push(reason); }));
    assert.deepEqual(cleanup, []);
    assert.equal(owner.retire(active.projection, 'lock').outcome, 'completed');
    assert.deepEqual(cleanup, ['lock']);
    assert.equal(owner.resolve(issued.sessionId).status, 'owned_denied');
    assert.equal(owner.retire(active.projection, 'lock').outcome, 'denied');
    assert.equal(owner.beginResourceUse(port), null);
} else if (scenario === 'reset') {
    const owner = createOwner();
    const admin = issue(owner, 'admin', 'admin');
    const sibling = issue(owner, 'sibling');
    const pending = owner.begin('login');
    assert.ok(pending);
    const active = owner.resolve(admin.sessionId);
    assert.equal(active.status, 'active');
    const aborted = owner.prepareAdminReset(active.projection);
    assert.ok(aborted);
    assert.equal(owner.begin('login'), null);
    assert.equal(owner.resolve(admin.sessionId).status, 'owned_denied');
    assert.equal(owner.issue(pending, { id: 'user.synthetic.resumed', username: 'synthetic-resumed', role: 'clinician' }), null);
    assert.equal(owner.abortAdminReset(aborted), true);
    assert.equal(owner.abortAdminReset(aborted), false);
    assert.equal(owner.resolve(admin.sessionId).status, 'active');
    assert.equal(owner.resolve(sibling.sessionId).status, 'active');
    const resumed = owner.issue(pending, { id: 'user.synthetic.resumed', username: 'synthetic-resumed', role: 'clinician' });
    assert.ok(resumed);
    const adminPort = owner.mintResourcePort(active.projection);
    const siblingActive = owner.resolve(sibling.sessionId);
    assert.equal(siblingActive.status, 'active');
    const siblingPort = owner.mintResourcePort(siblingActive.projection);
    assert.ok(adminPort);
    assert.ok(siblingPort);
    let thenCalls = 0;
    let resetNested = null;
    assert.ok(owner.registerPrivateResource(adminPort, () => { throw new Error('synthetic reset cleanup'); }));
    assert.ok(owner.registerPrivateResource(siblingPort, () => {
        resetNested = owner.resolve(admin.sessionId).status;
        return { then() { thenCalls += 1; } };
    }));
    const prepared = owner.prepareAdminReset(active.projection);
    assert.ok(prepared);
    const originalNow = Date.now;
    Date.now = () => { throw new Error('reset commit must not read a clock'); };
    const committed = owner.commitAdminReset(prepared);
    Date.now = originalNow;
    assert.equal(committed.outcome, 'failed');
    assert.equal(resetNested, 'owned_denied');
    assert.equal(thenCalls, 0);
    assert.equal(owner.commitAdminReset(prepared).outcome, 'denied');
    assert.equal(owner.resolve(admin.sessionId).status, 'owned_denied');
    assert.equal(owner.resolve(sibling.sessionId).status, 'owned_denied');
    assert.equal(owner.resolve(resumed.sessionId).status, 'owned_denied');
    assert.equal(owner.abort(pending), false);
} else if (scenario === 'retire-user') {
    const owner = createOwner();
    const userId = 'user.synthetic.shared';
    const first = issue(owner, 'shared-a', 'clinician', userId);
    const second = issue(owner, 'shared-b', 'clinician', userId);
    const other = issue(owner, 'other');
    const firstActive = owner.resolve(first.sessionId);
    assert.equal(firstActive.status, 'active');
    const forged = Object.freeze({ ...firstActive.projection });
    assert.equal(owner.retireForUser(forged).outcome, 'denied');
    assert.equal(owner.resolve(first.sessionId).status, 'active');
    assert.equal(owner.resolve(second.sessionId).status, 'active');
    const otherOwner = createOwner();
    assert.equal(otherOwner.retireForUser(firstActive.projection).outcome, 'denied');
    assert.equal(owner.retireForUser(firstActive.projection).outcome, 'completed');
    assert.equal(owner.resolve(first.sessionId).status, 'owned_denied');
    assert.equal(owner.resolve(second.sessionId).status, 'owned_denied');
    assert.equal(owner.resolve(other.sessionId).status, 'active');
    assert.equal(owner.retireForUser(firstActive.projection).outcome, 'denied');
} else if (scenario === 'reentry') {
    const owner = createOwner();
    const first = issue(owner, 'reentry');
    const other = issue(owner, 'reentry-other');
    const active = owner.resolve(first.sessionId);
    assert.equal(active.status, 'active');
    const port = owner.mintResourcePort(active.projection);
    assert.ok(port);
    let nested = null;
    assert.ok(owner.registerPrivateResource(port, () => { nested = owner.resolve(other.sessionId).status; }));
    assert.equal(owner.retire(active.projection, 'lock').outcome, 'denied');
    assert.equal(nested, 'owned_denied');
    assert.equal(owner.resolve(first.sessionId).status, 'owned_denied');
    assert.equal(owner.resolve(other.sessionId).status, 'active');
    assert.equal(owner.retire(active.projection, 'lock').outcome, 'denied');
} else if (scenario === 'intrinsics') {
    const owner = createOwner();
    const issued = issue(owner, 'intrinsics');
    const originalAssign = Object.assign;
    Object.assign = () => { throw new Error('mutable Object.assign reached'); };
    const active = owner.resolve(issued.sessionId);
    Object.assign = originalAssign;
    assert.equal(active.status, 'active');
    assert.equal(active.projection.id, issued.sessionId);
} else if (scenario === 'restart') {
    const first = createOwner();
    const issued = issue(first, 'restart');
    const active = first.resolve(issued.sessionId);
    assert.equal(active.status, 'active');
    const second = createOwner();
    assert.equal(second.resolve(issued.sessionId).status, 'absent');
    assert.equal(second.retire(active.projection, 'lock').outcome, 'denied');
    assert.equal(second.retireForUser(active.projection).outcome, 'denied');
} else {
    throw new Error('unknown scenario');
}
process.stdout.write('pass');
`;

const HOSTILE_CLOCK_CHILD = String.raw`
const assert = require('node:assert/strict');
const originalNow = Date.now;
let owner = null;
let locator = '';
let mode = 'plain';
let nested = null;
Date.now = function hostileClock() {
    const at = Reflect.apply(originalNow, Date, []);
    if (mode === 'throw') throw new Error('synthetic throwing clock');
    if (mode === 'reenter') {
        mode = 'plain';
        nested = owner.resolve(locator).status;
    }
    return at;
};
const { createOwner } = require(process.argv[1]);
const issue = (target, suffix, role = 'clinician') => {
    const attempt = target.begin('login');
    assert.ok(attempt);
    const result = target.issue(attempt, { id: 'user.synthetic.' + suffix, username: 'synthetic-' + suffix, role });
    assert.ok(result);
    return result;
};
owner = createOwner();
const issued = issue(owner, 'clock-reentry');
locator = issued.sessionId;
mode = 'reenter';
assert.equal(owner.resolve(locator).status, 'owned_denied');
assert.equal(nested, 'owned_denied');
assert.equal(owner.resolve(locator).status, 'active');
const resetOwner = createOwner();
const admin = issue(resetOwner, 'clock-reset', 'admin');
const adminActive = resetOwner.resolve(admin.sessionId);
assert.equal(adminActive.status, 'active');
const reset = resetOwner.prepareAdminReset(adminActive.projection);
assert.ok(reset);
mode = 'throw';
const committed = resetOwner.commitAdminReset(reset);
mode = 'plain';
assert.equal(committed.outcome, 'completed');
assert.equal(resetOwner.resolve(admin.sessionId).status, 'owned_denied');
process.stdout.write('pass');
`;

function runScenario(scenario: 'intrinsics' | 'lifecycle' | 'reentry' | 'reset' | 'restart' | 'retire-user'): void {
    const result = spawnSync(process.execPath, ['-e', CHILD, OWNER, ENTRY, scenario], {
        cwd: ROOT,
        env: { ...process.env, NODE_ENV: 'test' },
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'pass');
}

test('keeps the prepared root inert and owns one exact lifecycle in a synthetic child', () => {
    runScenario('lifecycle');
});

test('prepares admin reset before mutation and keeps abort distinct from commit', () => {
    runScenario('reset');
});

test('requires one exact current projection for same-user retirement', () => {
    runScenario('retire-user');
});

test('poisons an outer owner operation on disposer reentry', () => {
    runScenario('reentry');
});

test('uses captured resolver intrinsics when Object.assign is hostile', () => {
    runScenario('intrinsics');
});

test('poisons clock reentry and commits reset without a post-DB clock read', () => {
    const result = spawnSync(process.execPath, ['-e', HOSTILE_CLOCK_CHILD, OWNER], {
        cwd: ROOT,
        env: { ...process.env, NODE_ENV: 'test' },
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'pass');
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

test('denies locators and projections across process-local owners and child restarts', () => {
    runScenario('restart');
    const producer = spawnSync(process.execPath, ['-e', [
        "const {createOwner}=require(process.argv[1]);",
        "const owner=createOwner();",
        "const attempt=owner.begin('login');",
        "const issued=owner.issue(attempt,{id:'user.synthetic.process',username:'synthetic-process',role:'admin'});",
        'process.stdout.write(issued.sessionId);',
    ].join(''), OWNER], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(producer.status, 0, producer.stderr);
    assert.match(producer.stdout, /^[0-9a-f]{64}$/u);
    const consumer = spawnSync(process.execPath, ['-e', [
        "const {createOwner}=require(process.argv[1]);",
        'const owner=createOwner();',
        'process.stdout.write(owner.resolve(process.argv[2]).status);',
    ].join(''), OWNER, producer.stdout], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(consumer.status, 0, consumer.stderr);
    assert.equal(consumer.stdout, 'absent');
});
