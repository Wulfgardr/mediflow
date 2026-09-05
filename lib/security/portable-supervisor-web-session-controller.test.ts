/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'mediflow-web-session-controller-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], {
    env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
});
const {
    createPortableSupervisorWebSessionControllerV1,
    PortableSupervisorWebSessionV1Error,
} = await import('./portable-supervisor-web-session-controller.ts');
const { PortableSupervisorWebIpcBridgeV1Error } =
    await import('./portable-supervisor-web-ipc-bridge.ts');
const { createPortableSupervisorCheckupWebSessionPortV1 } =
    await import('./portable-supervisor-checkup-web-session-port.ts');

const PATIENT = 'patient.synthetic.web-session.01';
const OTHER_PATIENT = 'patient.synthetic.web-session.02';
const INPUT = Object.freeze({ expectedPatientId: PATIENT, selectionEpoch: 17 });
const EXPIRES_AT = 2_000_000_000_000;

type Deferred<T> = Readonly<{
    promise: Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
}>;
type FixtureOptions = Readonly<{
    acquire?: 'current' | 'null' | 'deferred';
    activation?: 'current' | 'deferred' | 'sensitive-error' | 'overscoped-output' | 'already-bound';
    revocation?: 'current' | 'deferred';
}>;
type Capture = Readonly<{
    schemaVersion: 'mediflow.portable-supervisor.web-capture.v1';
    userRef: string; parentRef: string; patientId: string; ambulatoryId: string;
    selectionEpoch: number; expectedPatientVersion: number; expiresAt: number;
}>;

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((accept, deny) => { resolve = accept; reject = deny; });
    return Object.freeze({ promise, resolve, reject });
}

function fixture(options: FixtureOptions = {}) {
    let capture: Capture = Object.freeze({
        schemaVersion: 'mediflow.portable-supervisor.web-capture.v1' as const,
        userRef: `user.${'1'.repeat(64)}`, parentRef: `parent.${'2'.repeat(64)}`,
        patientId: PATIENT, ambulatoryId: 'ambulatory.synthetic.web-session.01',
        selectionEpoch: INPUT.selectionEpoch, expectedPatientVersion: 3, expiresAt: EXPIRES_AT,
    });
    const acquisition = deferred<void>();
    const activation = deferred<Readonly<{ expiresAt: number }>>();
    const revocation = deferred<boolean>();
    const events: string[] = [];
    let observer: ((reason: 'logout' | 'application_lock' | 'reselection' | 'expiry'
        | 'web_disconnect' | 'explicit') => unknown) | null = null;
    let active = true, acquisitions = 0, activations = 0, reads = 0, revocations = 0, disconnects = 0;
    const owner = Object.freeze({
        readCapture() { reads += 1; events.push('capture:read'); return capture; },
        matchesCurrentContext() { return true; },
        revoke(reason: 'logout' | 'application_lock' | 'reselection' | 'explicit') {
            events.push(`local:${reason}`);
            if (!active) return false;
            active = false; observer?.(reason); return true;
        },
        dispose() {
            events.push('local:web_disconnect');
            if (!active) return false;
            active = false; observer?.('web_disconnect'); return true;
        },
    });
    const checkup = createPortableSupervisorCheckupWebSessionPortV1({ now: () => EXPIRES_AT - 10_000 });
    const controller = createPortableSupervisorWebSessionControllerV1({
        async acquireCaptureOwner(nextObserver) {
            acquisitions += 1; observer = nextObserver;
            if (options.acquire === 'deferred') await acquisition.promise;
            return options.acquire === 'null' ? null : owner;
        },
        async activateBridge(readCapture) {
            activations += 1; events.push('bridge:prepare');
            readCapture(); events.push('bridge:activate');
            if (options.activation === 'sensitive-error') {
                throw new Error(`${PATIENT}:${capture.parentRef}`);
            }
            if (options.activation === 'already-bound') {
                throw new PortableSupervisorWebIpcBridgeV1Error('denied', 'already_bound');
            }
            if (options.activation === 'overscoped-output') {
                return { expiresAt: capture.expiresAt + 1, patientId: PATIENT } as never;
            }
            if (options.activation === 'deferred') return activation.promise;
            return Object.freeze({ expiresAt: EXPIRES_AT - 1 });
        },
        revokeBridge: (reason) => {
            revocations += 1; events.push(`remote:${reason}`);
            return options.revocation === 'deferred' ? revocation.promise : Promise.resolve(true);
        },
        disconnectBridge: () => { disconnects += 1; events.push('transport:disconnect'); },
        checkupLifecycle: checkup.controller,
    });
    return Object.freeze({
        controller, checkupPort: checkup.port, events, acquisition, activation, revocation,
        acquisitions: () => acquisitions, activations: () => activations,
        reads: () => reads, revocations: () => revocations, disconnects: () => disconnects,
        setCapture(next: Partial<Capture>) { capture = Object.freeze({ ...capture, ...next }); },
        terminal(reason: 'logout' | 'application_lock' | 'reselection' | 'expiry'
            | 'web_disconnect' | 'explicit') { assert.ok(observer); observer(reason); },
    });
}

async function rejectsCode(promise: Promise<unknown>, code: string): Promise<void> {
    await assert.rejects(promise, (error: unknown) => {
        assert.ok(error instanceof PortableSupervisorWebSessionV1Error);
        assert.equal(error.code, code);
        assert.doesNotMatch(error.message, /patient\.synthetic|user\.|parent\.|ambulatory/iu);
        return true;
    });
}

after(() => rmSync(dataDir, { recursive: true, force: true }));

test('activates once from the owner capture and exposes only active expiry', async () => {
    const current = fixture();
    const first = current.controller.activateCurrentSelection(INPUT);
    const result = await first;
    assert.equal(Object.getPrototypeOf(result), null);
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(Reflect.ownKeys(result), ['state', 'expiresAt']);
    assert.deepEqual({ ...result }, { state: 'active', expiresAt: EXPIRES_AT - 1 });
    assert.equal(current.reads(), 3);
    assert.equal(current.acquisitions(), 1);
    assert.equal(current.activations(), 1);
    assert.equal(JSON.stringify(result).includes(PATIENT), false);
    assert.equal(JSON.stringify(result).includes('user.'), false);
});

test('activates the checkup dependent port only after H1a and drains it on retirement', async () => {
    const current = fixture(); let disposals = 0, observations = 0;
    assert.equal(current.checkupPort.attach(() => { disposals += 1; }), null);
    await current.controller.activateCurrentSelection(INPUT);
    const binding = current.checkupPort.attach(() => { disposals += 1; }); assert.ok(binding);
    assert.equal(current.checkupPort.withCurrent(binding, (capture) => {
        observations += 1; assert.equal(capture.patientId, PATIENT);
    }), true);
    assert.equal(observations, 1); assert.equal(disposals, 0);
    await current.controller.retire('explicit');
    assert.equal(disposals, 1);
    assert.equal(current.checkupPort.withCurrent(binding, () => { observations += 1; }), false);
    assert.equal(observations, 1);
});

test('denies every sibling request without treating caller input equality as H1a identity', async () => {
    const current = fixture({ acquire: 'deferred' });
    const first = current.controller.activateCurrentSelection(INPUT);
    await rejectsCode(current.controller.activateCurrentSelection({ ...INPUT }), 'selection_conflict');
    await rejectsCode(current.controller.activateCurrentSelection({
        expectedPatientId: OTHER_PATIENT, selectionEpoch: INPUT.selectionEpoch,
    }), 'selection_conflict');
    assert.equal(current.acquisitions(), 1);
    current.acquisition.resolve();
    assert.equal((await first).state, 'active');
    assert.equal(current.acquisitions(), 1);
    assert.equal(current.activations(), 1);
    await rejectsCode(current.controller.activateCurrentSelection({ ...INPUT }), 'selection_conflict');
});

test('keeps an idle controller available across the initial patient selection', async () => {
    const current = fixture();
    assert.equal(await current.controller.retire('reselection'), false);
    assert.equal(current.revocations(), 0);
    assert.equal(current.disconnects(), 0);
    assert.equal((await current.controller.activateCurrentSelection(INPUT)).state, 'active');
    assert.equal(current.acquisitions(), 1);
});

test('fails closed when owner capture patient or epoch differs and revokes locally first', async () => {
    for (const drift of [
        { patientId: OTHER_PATIENT },
        { selectionEpoch: INPUT.selectionEpoch + 1 },
    ]) {
        const current = fixture(); current.setCapture(drift);
        await rejectsCode(current.controller.activateCurrentSelection(INPUT), 'selection_conflict');
        assert.equal(current.revocations(), 1);
        assert.ok(current.events.indexOf('local:reselection') < current.events.indexOf('remote:reselection'));
        await rejectsCode(current.controller.activateCurrentSelection(INPUT), 'session_terminal');
        assert.equal(current.acquisitions(), 1);
    }
});

test('treats a null owner as one conservative selection denial and never rebinds', async () => {
    const current = fixture({ acquire: 'null' });
    await rejectsCode(current.controller.activateCurrentSelection(INPUT), 'selection_unavailable');
    assert.equal(current.disconnects(), 1);
    await rejectsCode(current.controller.activateCurrentSelection(INPUT), 'session_terminal');
    assert.equal(current.acquisitions(), 1);
});

test('a synchronous terminal observer starts one stored revoke and remains terminal', async () => {
    const current = fixture({ revocation: 'deferred' });
    await current.controller.activateCurrentSelection(INPUT);
    current.terminal('expiry');
    assert.equal(current.revocations(), 1);
    const observed = current.controller.retire('explicit');
    assert.equal(current.controller.retire('logout'), observed);
    current.revocation.resolve(true);
    assert.equal(await observed, true);
    assert.equal(current.revocations(), 1);
    await rejectsCode(current.controller.activateCurrentSelection(INPUT), 'session_terminal');
    assert.equal(current.acquisitions(), 1);
});

test('coalesces explicit retirement and orders local revocation before bridge IPC', async () => {
    const current = fixture({ revocation: 'deferred' });
    await current.controller.activateCurrentSelection(INPUT);
    const first = current.controller.retire('application_lock');
    const second = current.controller.retire('logout');
    assert.equal(second, first);
    assert.equal(current.revocations(), 1);
    assert.ok(current.events.indexOf('local:application_lock')
        < current.events.indexOf('remote:application_lock'));
    current.revocation.resolve(true);
    assert.equal(await first, true);
    assert.equal(current.controller.retire('explicit'), first);
    assert.equal(current.revocations(), 1);
});

test('cuts retirement during owner acquisition and revokes a late owner only locally', async () => {
    const current = fixture({ acquire: 'deferred' });
    const activating = current.controller.activateCurrentSelection(INPUT);
    const activationRejection = rejectsCode(activating, 'session_terminal');
    const first = current.controller.retire('logout');
    assert.equal(current.controller.retire('application_lock'), first);
    const outcome = await Promise.race([
        first,
        new Promise<'still_pending'>((resolve) => setImmediate(() => resolve('still_pending'))),
    ]);
    assert.equal(outcome, false);
    const activationOutcome = await Promise.race([
        activationRejection.then(() => 'rejected' as const),
        new Promise<'still_pending'>((resolve) => setImmediate(() => resolve('still_pending'))),
    ]);
    assert.equal(activationOutcome, 'rejected');
    assert.equal(current.revocations(), 0);
    assert.equal(current.disconnects(), 1);
    current.acquisition.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(current.activations(), 0);
    assert.equal(current.events.includes('local:logout'), true);
    assert.equal(current.revocations(), 0);
    assert.equal(current.controller.retire('explicit'), first);
});

test('propagates revoke timeout only after disconnect and never retries', async () => {
    const current = fixture({ revocation: 'deferred' });
    await current.controller.activateCurrentSelection(INPUT);
    const timeout = new PortableSupervisorWebIpcBridgeV1Error('timeout');
    const retiring = current.controller.retire('explicit');
    current.revocation.reject(timeout);
    await assert.rejects(retiring, (error: unknown) => error === timeout);
    assert.equal(current.disconnects(), 1);
    assert.ok(current.events.indexOf('remote:explicit') < current.events.indexOf('transport:disconnect'));
    assert.equal(current.controller.retire('logout'), retiring);
    assert.equal(current.revocations(), 1);
});

test('does not log or return sensitive bridge failure detail', async () => {
    const originalError = console.error; const logged: unknown[][] = [];
    console.error = (...values: unknown[]) => { logged.push(values); };
    try {
        const current = fixture({ activation: 'sensitive-error' });
        await rejectsCode(current.controller.activateCurrentSelection(INPUT), 'host_unavailable');
        assert.deepEqual(logged, []);
    } finally { console.error = originalError; }
});

test('denies a host sibling binding and overscoped bridge output without rebinding', async () => {
    for (const [activation, code] of [
        ['already-bound', 'selection_conflict'],
        ['overscoped-output', 'host_unavailable'],
    ] as const) {
        const current = fixture({ activation });
        await rejectsCode(current.controller.activateCurrentSelection(INPUT), code);
        assert.equal(current.acquisitions(), 1);
        assert.equal(current.revocations(), 1);
        await rejectsCode(current.controller.activateCurrentSelection(INPUT), 'session_terminal');
    }
});
