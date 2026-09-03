/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, test } from 'node:test';

import {
    PORTABLE_SUPERVISOR_WEB_CAPTURE_SCHEMA_V1,
    decodePortableSupervisorWebIpcFrameV1,
    encodePortableSupervisorWebIpcFrameV1,
} from '../../packages/aip/src/portable-supervisor-web-ipc-contract.ts';
import {
    createFullPortProjectionOwnerProcessOwner, type ServerSessionSelectionBindingSnapshotV1,
} from './server-session-projection-owner.ts';
import type { ServerSession } from './server-session.ts';
import {
    issueSyntheticWebSession, retireSyntheticWebSession,
} from './web-auth-lifecycle-owner-test-fixture.ts';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'mediflow-portable-web-capture-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], {
    env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
});
const { createPortableSupervisorWebCaptureOwnerProcessV1 } =
    await import('./portable-supervisor-context-owner.ts');

const USER = Object.freeze({ id: 'synthetic-user-capture', username: 'synthetic-clinician', role: 'clinician' });
const PAIR = Object.freeze({
    patientId: 'patient.synthetic.capture.01', ambulatoryId: 'ambulatory.synthetic.capture.01',
});
const CAPTURE_KEYS = ['schemaVersion', 'userRef', 'parentRef', 'patientId', 'ambulatoryId',
    'selectionEpoch', 'expectedPatientVersion', 'expiresAt'];
const sessions = new Set<ServerSession>();
let sequence = 0;

type AcquisitionOutcome = 'current' | 'null' | 'reject' | 'deferred';
type SourceOverrides = Readonly<{
    clock?: () => unknown;
    hashRef?: (value: string) => unknown;
    scheduler?: (delay: number, operation: () => void) => unknown;
}>;

function fixture(acquisitionOutcome: AcquisitionOutcome = 'current', overrides: SourceOverrides = {}) {
    const session = issueSyntheticWebSession(USER, `portable-web-capture-${sequence += 1}`);
    sessions.add(session);
    let now = session.createdAt, patientVersion = 7, failBindingRead = false;
    const timers: Array<{ delay: number; active: boolean; fire(): void }> = [];
    const events: string[] = [];
    const selectionOwner = createFullPortProjectionOwnerProcessOwner({
        resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion }), clock: () => now,
    });
    const owner = selectionOwner.registry.acquire(session);
    const lease = owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const authenticatedContext = Object.freeze(Object.assign(Object.create(null), { session, owner }));
    let acquisitions = 0, resolveDeferred: (() => void) | null = null;
    let registrations = 0, confirmations = 0, unregistrations = 0;
    const selectionLifecycle = {
        withCurrentSelection: selectionOwner.selectionLifecycleController.withCurrentSelection,
        registerDependent(scope: unknown, dispose: () => void) {
            const registration = selectionOwner.selectionLifecycleController.registerDependent(scope, dispose);
            if (registration) registrations += 1; return registration;
        },
        confirmDependent(scope: unknown, registration: unknown) {
            const confirmed = selectionOwner.selectionLifecycleController.confirmDependent(scope, registration);
            if (confirmed) confirmations += 1; return confirmed;
        },
        unregisterDependent(scope: unknown, registration: unknown) {
            const unregistered = selectionOwner.selectionLifecycleController.unregisterDependent(scope, registration);
            if (unregistered) unregistrations += 1; return unregistered;
        },
        withCurrentDependent: selectionOwner.selectionLifecycleController.withCurrentDependent,
    };
    const selectionBinding = {
        withCurrentDependentBinding(scope: unknown, registration: unknown,
            operation: (binding: ServerSessionSelectionBindingSnapshotV1) => void) {
            if (failBindingRead) throw new Error(`${PAIR.patientId}:${PAIR.ambulatoryId}`);
            return selectionOwner.selectionBindingController.withCurrentDependentBinding(scope, registration, operation);
        },
    };
    const processOwner = createPortableSupervisorWebCaptureOwnerProcessV1({
        acquireAuthenticatedContext: () => {
            acquisitions += 1;
            if (acquisitionOutcome === 'reject') return Promise.reject(new Error('synthetic H1a rejection'));
            if (acquisitionOutcome === 'deferred') return new Promise((resolve) => {
                resolveDeferred = () => resolve(authenticatedContext);
            });
            return Promise.resolve(acquisitionOutcome === 'null' ? null : authenticatedContext);
        },
        selectionLifecycle, selectionBinding,
        selectionCommitBinding: selectionOwner.selectionCommitBindingController,
        clock: overrides.clock ?? (() => now),
        hashRef: overrides.hashRef
            ?? ((value) => `sha256:${Buffer.from(value).toString('hex').padEnd(64, '0').slice(0, 64)}`),
        scheduler: overrides.scheduler ?? ((delay, operation) => {
            const timer = { delay, active: true, fire() { if (!this.active) return; this.active = false; operation(); } };
            timers.push(timer); return () => { timer.active = false; };
        }),
    });
    return {
        session, owner, lease, processOwner, timers, events,
        acquire: () => processOwner.acquire((reason) => { events.push(reason); }),
        acquisitionCount: () => acquisitions,
        registrationCounts: () => ({ registrations, confirmations, unregistrations }),
        resolveAcquisition() { assert.ok(resolveDeferred); resolveDeferred(); resolveDeferred = null; },
        setNow(value: number) { now = value; },
        setPatientVersion(value: number) { patientVersion = value; },
        failBindingRead() { failBindingRead = true; },
    };
}

function unavailable(operation: () => unknown): void {
    assert.throws(operation, (error: unknown) => {
        assert.equal((error as { code?: unknown }).code, 'capture_unavailable');
        assert.doesNotMatch(String((error as Error).message), /patient|ambulatory|cookie|session id/iu);
        return true;
    });
}

afterEach(() => {
    for (const session of sessions) retireSyntheticWebSession(session);
    sessions.clear();
});
after(() => rmSync(dataDir, { recursive: true, force: true }));

test('publishes only the canonical current Web capture required by the inherited IPC contract', async () => {
    const current = fixture();
    const owner = await current.acquire(); assert.ok(owner);
    assert.deepEqual(Reflect.ownKeys(owner), ['readCapture', 'matchesCurrentContext', 'revoke', 'dispose']);
    assert.equal(owner.matchesCurrentContext(Object.freeze(Object.assign(Object.create(null), {
        session: current.session, owner: current.owner,
    }))), true);
    assert.equal(owner.matchesCurrentContext(Object.freeze(Object.assign(Object.create(null), {
        session: Object.freeze({ ...current.session }), owner: current.owner,
    }))), false);
    const capture = owner.readCapture();
    assert.equal(Object.getPrototypeOf(capture), null);
    assert.equal(Object.isFrozen(capture), true);
    assert.deepEqual(Reflect.ownKeys(capture), CAPTURE_KEYS);
    assert.equal(capture.schemaVersion, PORTABLE_SUPERVISOR_WEB_CAPTURE_SCHEMA_V1);
    assert.equal(capture.patientId, PAIR.patientId);
    assert.equal(capture.ambulatoryId, PAIR.ambulatoryId);
    assert.equal(capture.selectionEpoch, current.lease.selectionEpoch);
    assert.equal(capture.expectedPatientVersion, 7);
    for (const reference of [capture.userRef, capture.parentRef]) {
        assert.match(reference, /^(?:user|parent)\.[0-9a-f]{64}$/u);
        assert.doesNotMatch(reference, new RegExp([USER.id, PAIR.patientId, PAIR.ambulatoryId].join('|'), 'u'));
    }
    const requestRef = `pswr_${'1'.repeat(32)}`, challenge = `pswc_${'2'.repeat(64)}`;
    const decoded = decodePortableSupervisorWebIpcFrameV1(encodePortableSupervisorWebIpcFrameV1({
        schemaVersion: 'mediflow.portable-supervisor.web-ipc.v1', method: 'activate', requestRef, challenge, capture,
    }));
    assert.deepEqual({ ...(decoded.capture as Record<string, unknown>) }, { ...capture });
});

test('keeps one fixed capture bounded by H1a and selection expiry', async () => {
    const current = fixture(); const owner = await current.acquire(); assert.ok(owner);
    const first = owner.readCapture();
    assert.equal(current.timers[0]?.delay, first.expiresAt - current.session.createdAt);
    current.setNow(current.session.createdAt + 1_000);
    assert.equal(owner.readCapture(), first);
    assert.ok(first.expiresAt <= current.lease.expiresAt);
    current.setNow(first.expiresAt - 1);
    unavailable(() => owner.readCapture());
    assert.deepEqual(current.events, ['expiry']);
});

test('reselection, patient drift, session retirement and timer expiry revoke before another read', async () => {
    for (const terminal of ['reselection', 'source_drift', 'retirement', 'scheduled_expiry'] as const) {
        const current = fixture(); const owner = await current.acquire(); assert.ok(owner);
        if (terminal === 'reselection') current.owner.issueSelection({ expectedEpoch: 1, ...PAIR });
        else if (terminal === 'source_drift') current.setPatientVersion(8);
        else if (terminal === 'retirement') { retireSyntheticWebSession(current.session); sessions.delete(current.session); }
        else current.timers[0]?.fire();
        unavailable(() => owner.readCapture());
        assert.equal(owner.revoke('explicit'), false, terminal);
        assert.deepEqual(current.events, [terminal === 'scheduled_expiry' ? 'expiry' : 'reselection'], terminal);
    }
});

test('explicit revoke and disconnect are idempotent, closed-world and one-shot for the process lifetime', async () => {
    const logout = fixture(); const first = await logout.acquire(); assert.ok(first);
    assert.equal(first.revoke('caller_reason' as never), false);
    assert.equal(first.revoke('logout'), true); assert.equal(first.revoke('logout'), false);
    assert.deepEqual(logout.events, ['logout']);
    assert.equal(await logout.acquire(), null);

    const disconnected = fixture(); const second = await disconnected.acquire(); assert.ok(second);
    assert.equal(second.dispose(), true); assert.equal(second.dispose(), false);
    assert.deepEqual(disconnected.events, ['web_disconnect']);
});

test('double and concurrent acquisition cannot publish siblings or retry after publication', async () => {
    const current = fixture('deferred');
    const pending = current.acquire();
    assert.equal(await current.acquire(), null);
    assert.equal(current.acquisitionCount(), 1);
    current.resolveAcquisition();
    const owner = await pending; assert.ok(owner);
    assert.equal(await current.acquire(), null);
    assert.deepEqual(current.registrationCounts(), { registrations: 1, confirmations: 1, unregistrations: 0 });
    assert.equal(owner.revoke('explicit'), true);
    assert.deepEqual(current.registrationCounts(), { registrations: 1, confirmations: 1, unregistrations: 1 });
    assert.equal(await current.acquire(), null);
});

test('missing selection and H1a denial fail before publishing resources', async () => {
    const missing = fixture(); missing.owner.dispose();
    assert.equal(await missing.acquire(), null);
    for (const outcome of ['null', 'reject'] as const) {
        const current = fixture(outcome);
        assert.equal(await current.acquire(), null, outcome);
        assert.equal(current.timers.length, 0, outcome);
        assert.deepEqual(current.events, [], outcome);
    }
});

test('currentness failures are redacted, terminal and notify once', async () => {
    const current = fixture(); const owner = await current.acquire(); assert.ok(owner);
    current.failBindingRead();
    unavailable(() => owner.readCapture());
    unavailable(() => owner.readCapture());
    assert.deepEqual(current.events, ['reselection']);
});

test('invalid observers and hostile clock, hash or scheduler results fail before publication', async () => {
    const observer = fixture();
    assert.equal(await observer.processOwner.acquire(async () => undefined), null);
    assert.equal(observer.acquisitionCount(), 0);

    const clock = fixture('current', { clock: () => Promise.reject(new Error('synthetic clock')) });
    assert.equal(await clock.acquire(), null);
    const hash = fixture('current', { hashRef: () => Promise.reject(new Error('synthetic hash')) });
    assert.equal(await hash.acquire(), null);
    const scheduler = fixture('current', {
        scheduler: (_delay, operation) => { operation(); return Promise.reject(new Error('synthetic timer')); },
    });
    assert.equal(await scheduler.acquire(), null);
    assert.deepEqual([...clock.events, ...hash.events, ...scheduler.events], []);
});

test('production composition remains Web-only and cannot mint Supervisor authority', () => {
    const source = readFileSync(new URL('./portable-supervisor-context-owner.ts', import.meta.url), 'utf8');
    assert.match(source, /acquireAuthenticatedWebSessionProjectionOwnerContext/u);
    assert.match(source, /selectionLifecycleController/u);
    assert.match(source, /selectionBindingController/u);
    assert.match(source, /selectionCommitBindingController/u);
    assert.match(source, /PORTABLE_SUPERVISOR_WEB_CAPTURE_SCHEMA_V1/u);
    assert.doesNotMatch(source, /readHostContext|authenticated-headless-agent-launcher|owner-broker|operation-rpc|child_process|listen\s*\(|cookieStore|NextRequest|NextResponse/iu);
    assert.doesNotMatch(source, /generation:\s*|bootstrapExpiresAt|purposeCode/iu);
});
