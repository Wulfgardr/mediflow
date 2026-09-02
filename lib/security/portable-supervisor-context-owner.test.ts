/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, test } from 'node:test';

import { CONTEXT_KEYS } from '../headless/authenticated-agent-launcher-contract.ts';
import {
    createFullPortProjectionOwnerProcessOwner, type ServerSessionSelectionBindingSnapshotV1,
} from './server-session-projection-owner.ts';
import type { ServerSession } from './server-session.ts';
import {
    issueSyntheticWebSession, retireSyntheticWebSession,
} from './web-auth-lifecycle-owner-test-fixture.ts';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'mediflow-portable-supervisor-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], {
    env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
});
const { createPortableSupervisorContextOwnerProcessV1 } = await import('./portable-supervisor-context-owner.ts');

const USER = Object.freeze({ id: 'synthetic-user-context', username: 'synthetic-clinician', role: 'clinician' });
const PAIR = Object.freeze({
    patientId: 'patient.synthetic.supervisor.01', ambulatoryId: 'ambulatory.synthetic.supervisor.01',
});
const sessions = new Set<ServerSession>();
let sequence = 0;

type AcquisitionOutcome = 'current' | 'null' | 'reject';

function fixture(acquisitionOutcome: AcquisitionOutcome = 'current') {
    const session = issueSyntheticWebSession(USER, `portable-supervisor-${sequence += 1}`);
    sessions.add(session);
    let now = session.createdAt;
    let patientVersion = 7;
    const timers: Array<{ delay: number; active: boolean; fire(): void }> = [];
    const selectionOwner = createFullPortProjectionOwnerProcessOwner({
        resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion }), clock: () => now,
    });
    const owner = selectionOwner.registry.acquire(session);
    const lease = owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const authenticatedContext = Object.freeze(Object.assign(Object.create(null), { session, owner }));
    let acquisitions = 0;
    let failBindingRead = false;
    const selectionBinding = {
        withCurrentDependentBinding(scope: unknown, registration: unknown,
            operation: (binding: ServerSessionSelectionBindingSnapshotV1) => void) {
            if (failBindingRead) throw new Error(`${PAIR.patientId}:${PAIR.ambulatoryId}`);
            return selectionOwner.selectionBindingController.withCurrentDependentBinding(
                scope, registration, operation,
            );
        },
    };
    const supervisor = createPortableSupervisorContextOwnerProcessV1({
        acquireAuthenticatedContext: () => {
            acquisitions += 1;
            if (acquisitionOutcome === 'reject') return Promise.reject(new Error('synthetic H1a rejection'));
            return Promise.resolve(acquisitionOutcome === 'null' ? null : authenticatedContext);
        },
        selectionLifecycle: selectionOwner.selectionLifecycleController,
        selectionBinding,
        selectionCommitBinding: selectionOwner.selectionCommitBindingController,
        clock: () => now,
        hashRef: (value) => `sha256:${Buffer.from(value).toString('hex').padEnd(64, '0').slice(0, 64)}`,
        scheduler: (delay, operation) => {
            const timer = { delay, active: true, fire() { if (!this.active) return; this.active = false; operation(); } };
            timers.push(timer); return () => { timer.active = false; };
        },
    });
    return {
        session, selectionOwner, owner, lease, supervisor, timers,
        acquisitionCount() { return acquisitions; },
        setNow(value: number) { now = value; },
        setPatientVersion(value: number) { patientVersion = value; },
        failBindingRead() { failBindingRead = true; },
    };
}

function contextKeys(value: unknown): void {
    assert.ok(value && typeof value === 'object');
    assert.equal(Object.getPrototypeOf(value), null);
    assert.equal(Object.isFrozen(value), true);
    assert.deepEqual(Reflect.ownKeys(value), CONTEXT_KEYS);
}

function unavailable(operation: () => unknown): boolean {
    try { operation(); return false; }
    catch (error) {
        assert.equal((error as { code?: unknown }).code, 'context_unavailable');
        assert.doesNotMatch(String((error as Error).message), /patient|ambulatory|cookie|session id/iu);
        return true;
    }
}

afterEach(() => {
    for (const session of sessions) retireSyntheticWebSession(session);
    sessions.clear();
});
after(() => rmSync(dataDir, { recursive: true, force: true }));

test('acquires only a current authenticated host selection and publishes the exact synchronous launcher context', async () => {
    const current = fixture();
    const supervisor = await current.supervisor.acquire();
    assert.ok(supervisor);
    assert.equal(Object.getPrototypeOf(supervisor), null);
    assert.equal(Object.isFrozen(supervisor), true);
    assert.deepEqual(Reflect.ownKeys(supervisor), ['readHostContext', 'stop', 'restart', 'dispose']);

    const context = supervisor.readHostContext();
    contextKeys(context);
    assert.equal(context.status, 'available');
    assert.equal(context.purposeCode, 'care_coordination');
    assert.equal(context.patientId, PAIR.patientId);
    assert.equal(context.ambulatoryId, PAIR.ambulatoryId);
    assert.equal(context.selectionEpoch, current.lease.selectionEpoch);
    assert.equal(context.generation, 1);
    assert.equal(context.revocationGeneration, 0);
    assert.equal(context.restartGeneration, 1);
    assert.equal(context.parentGeneration, 1);
    assert.equal(context.policyGeneration, 1);
    assert.ok(context.bootstrapExpiresAt > current.session.createdAt);
    assert.ok(context.bootstrapExpiresAt < context.expiresAt);
    assert.ok(context.expiresAt <= current.lease.expiresAt);
    for (const reference of [context.userRef, context.parentRef]) {
        assert.match(reference, /^(?:user|parent)\.[0-9a-f]{64}$/u);
        assert.doesNotMatch(reference, new RegExp([USER.id, PAIR.patientId, PAIR.ambulatoryId].join('|'), 'u'));
    }
});

test('rolling bootstrap expiry stays bounded while owner expiry never extends its parent selection', async () => {
    const current = fixture();
    const supervisor = await current.supervisor.acquire(); assert.ok(supervisor);
    const first = supervisor.readHostContext();
    assert.equal(current.timers.length, 1);
    assert.equal(current.timers[0]!.delay, first.expiresAt - current.session.createdAt);

    current.setNow(current.session.createdAt + 1_000);
    const second = supervisor.readHostContext();
    assert.ok(second.bootstrapExpiresAt > first.bootstrapExpiresAt);
    assert.ok(second.bootstrapExpiresAt - (current.session.createdAt + 1_000) <= 5_000);
    assert.equal(second.expiresAt, first.expiresAt);

    current.setNow(first.expiresAt);
    assert.equal(unavailable(() => supervisor.readHostContext()), true);
    assert.equal(current.timers[0]!.active, false);
});

test('reselection, patient-source drift, retirement, and scheduled expiry drain before the next read', async () => {
    for (const terminal of ['reselection', 'source_drift', 'retirement', 'scheduled_expiry'] as const) {
        const current = fixture();
        const supervisor = await current.supervisor.acquire(); assert.ok(supervisor);
        if (terminal === 'reselection') current.owner.issueSelection({ expectedEpoch: 1, ...PAIR });
        else if (terminal === 'source_drift') current.setPatientVersion(8);
        else if (terminal === 'retirement') { retireSyntheticWebSession(current.session); sessions.delete(current.session); }
        else current.timers[0]!.fire();

        assert.equal(unavailable(() => supervisor.readHostContext()), true, terminal);
        assert.equal(supervisor.stop(), false, terminal);
    }
});

test('stop, restart, and dispose are terminal and idempotent; process generations remain monotone', async () => {
    const current = fixture();
    const first = await current.supervisor.acquire(); assert.ok(first);
    const firstContext = first.readHostContext();
    assert.equal(first.stop(), true); assert.equal(first.stop(), false); assert.equal(first.dispose(), false);
    assert.equal(unavailable(() => first.readHostContext()), true);

    const second = await current.supervisor.acquire(); assert.ok(second);
    const secondContext = second.readHostContext();
    assert.ok(secondContext.generation > firstContext.generation);
    assert.ok(secondContext.parentGeneration > firstContext.parentGeneration);
    assert.ok(secondContext.revocationGeneration > firstContext.revocationGeneration);
    assert.ok(secondContext.restartGeneration >= firstContext.restartGeneration);
    assert.ok(secondContext.policyGeneration >= firstContext.policyGeneration);
    assert.equal(second.restart(), true); assert.equal(second.restart(), false); assert.equal(second.stop(), false);
    assert.equal(unavailable(() => second.readHostContext()), true);

    const third = await current.supervisor.acquire(); assert.ok(third);
    const thirdContext = third.readHostContext();
    assert.ok(thirdContext.restartGeneration > secondContext.restartGeneration);
    assert.equal(third.dispose(), true); assert.equal(third.dispose(), false); assert.equal(third.restart(), false);
    assert.equal(unavailable(() => third.readHostContext()), true);
});

test('missing selection fails closed without registering or activating authority', async () => {
    const current = fixture();
    current.owner.dispose();
    assert.equal(await current.supervisor.acquire(), null);
    assert.equal(current.timers.length, 0);
});

test('H1a denial or rejection fails closed before selection authority or timers are reached', async () => {
    for (const outcome of ['null', 'reject'] as const) {
        const current = fixture(outcome);
        assert.equal(await current.supervisor.acquire(), null, outcome);
        assert.equal(current.acquisitionCount(), 1, outcome);
        assert.equal(current.timers.length, 0, outcome);
    }
});

test('a host currentness failure is redacted and terminal before it reaches the launcher', async () => {
    const current = fixture();
    const supervisor = await current.supervisor.acquire(); assert.ok(supervisor);
    current.failBindingRead();
    assert.equal(unavailable(() => supervisor.readHostContext()), true);
    assert.equal(supervisor.dispose(), false);
});

test('production composition consumes only canonical H1a context and production selection controllers', () => {
    const source = readFileSync(new URL('./portable-supervisor-context-owner.ts', import.meta.url), 'utf8');
    assert.match(source, /acquireAuthenticatedWebSessionProjectionOwnerContext/u);
    assert.match(source, /acquireAuthenticatedContext:\s*acquireAuthenticatedWebSessionProjectionOwnerContext/u);
    assert.match(source, /const authenticated = authenticatedContext\.session/u);
    assert.match(source, /purposeCode:\s*'care_coordination'/u);
    assert.match(source, /selectionLifecycleController/u);
    assert.match(source, /selectionBindingController/u);
    assert.match(source, /selectionCommitBindingController/u);
    assert.match(source, /createHash\('sha256'\)/u);
    assert.doesNotMatch(source, /readAuthenticatedWebSession|requireSession|NextRequest|NextResponse|request\.json|request\.body|frame|cookieStore|patientId:\s*input|ambulatoryId:\s*input/iu);
});
