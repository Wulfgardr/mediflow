/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    decodePortableSupervisorWebIpcFrameV1,
    encodePortableSupervisorWebIpcFrameV1,
} from '../../packages/aip/src/portable-supervisor-web-ipc-contract.ts';
import {
    PortableSupervisorWebIpcBridgeV1Error,
    createPortableSupervisorWebIpcBridgeV1,
} from './portable-supervisor-web-ipc-bridge.ts';

const SCHEMA = 'mediflow.portable-supervisor.web-ipc.v1';
const CHALLENGE = `pswc_${'2'.repeat(64)}`;
const capture = () => Object.freeze(Object.assign(Object.create(null), {
    schemaVersion: 'mediflow.portable-supervisor.web-capture.v1',
    userRef: `user.${'3'.repeat(64)}`, parentRef: `parent.${'4'.repeat(64)}`,
    patientId: 'patient.synthetic.bridge.01', ambulatoryId: 'ambulatory.synthetic.bridge.01',
    selectionEpoch: 7, expectedPatientVersion: 3, expiresAt: 20_000,
}));

function fixture(responder?: (frame: Record<string, unknown>, emit: (value: unknown) => void) => void) {
    let now = 1_000, connected = true, disconnected = 0;
    const frames: string[] = [], listeners = new Set<(message: unknown) => void>();
    const timers: Array<{ delay: number; callback: () => void; active: boolean }> = [];
    const bridge = createPortableSupervisorWebIpcBridgeV1({
        now: () => now,
        randomBytes: () => Buffer.from('1'.repeat(32), 'hex'),
        connected: () => connected,
        send: (value: string, done: (error: Error | null) => void) => {
            frames.push(value); done(null);
            const decoded = decodePortableSupervisorWebIpcFrameV1(value) as Record<string, unknown>;
            responder?.(decoded, (message) => { for (const listener of [...listeners]) listener(message); });
        },
        onMessage: (listener: (message: unknown) => void) => { listeners.add(listener); },
        offMessage: (listener: (message: unknown) => void) => { listeners.delete(listener); },
        disconnect: () => { connected = false; disconnected += 1; },
        schedule: (delay: number, callback: () => void) => {
            const timer = { delay, callback, active: true }; timers.push(timer);
            return () => { timer.active = false; };
        },
    });
    return { bridge, frames, listeners, timers,
        setNow: (value: number) => { now = value; },
        disconnected: () => disconnected,
        connected: () => connected };
}

const ack = (requestRef: unknown, outcome: 'prepared' | 'activated' | 'revoked', expiresAt?: number) =>
    encodePortableSupervisorWebIpcFrameV1(outcome === 'prepared'
        ? { schemaVersion: SCHEMA, method: 'ack', requestRef, outcome, challenge: CHALLENGE, expiresAt }
        : outcome === 'activated'
            ? { schemaVersion: SCHEMA, method: 'ack', requestRef, outcome, expiresAt }
            : { schemaVersion: SCHEMA, method: 'ack', requestRef, outcome });

const rejects = (code: 'host_unavailable' | 'protocol_invalid' | 'timeout' | 'denied' | 'context_invalid') =>
    (error: unknown) => error instanceof PortableSupervisorWebIpcBridgeV1Error && error.code === code;

test('prepares then activates one current capture with the same request and no retained listener', async () => {
    const current = fixture((frame, emit) => {
        if (frame.method === 'prepare') emit(ack(frame.requestRef, 'prepared', 5_000));
        else emit(ack(frame.requestRef, 'activated', 20_000));
    });
    let reads = 0;
    const result = await current.bridge.activate(() => { reads += 1; return capture(); });
    assert.deepEqual({ ...result }, { expiresAt: 20_000 });
    assert.equal(Object.getPrototypeOf(result), null);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(reads, 1);
    assert.equal(current.frames.length, 2);
    const [prepare, activate] = current.frames.map((frame) => decodePortableSupervisorWebIpcFrameV1(frame));
    assert.equal(prepare.method, 'prepare'); assert.equal(activate.method, 'activate');
    assert.equal(prepare.requestRef, activate.requestRef);
    assert.equal(activate.challenge, CHALLENGE);
    assert.equal(current.listeners.size, 0);
    assert.equal(current.timers.every((timer) => !timer.active), true);
    assert.equal(current.disconnected(), 0);
});

test('does not read capture after a typed preparation denial', async () => {
    const current = fixture((frame, emit) => emit(encodePortableSupervisorWebIpcFrameV1({
        schemaVersion: SCHEMA, method: 'ack', requestRef: frame.requestRef,
        outcome: 'denied', denialCode: 'host_unavailable',
    })));
    let reads = 0;
    await assert.rejects(current.bridge.activate(() => { reads += 1; return capture(); }), rejects('denied'));
    assert.equal(reads, 0);
    assert.equal(current.connected(), true);
    assert.equal(current.listeners.size, 0);
});

test('ignores canonical ACKs for another request but disconnects on malformed parent frames', async () => {
    const unrelated = `pswr_${'9'.repeat(32)}`;
    const valid = fixture((frame, emit) => {
        emit(ack(unrelated, 'prepared', 5_000));
        emit(ack(frame.requestRef, frame.method === 'prepare' ? 'prepared' : 'activated',
            frame.method === 'prepare' ? 5_000 : 20_000));
    });
    await valid.bridge.activate(capture);
    assert.equal(valid.connected(), true);

    const malformed = fixture((_frame, emit) => emit('{"not":"canonical"}'));
    await assert.rejects(malformed.bridge.activate(capture), rejects('protocol_invalid'));
    assert.equal(malformed.disconnected(), 1);
    assert.equal(malformed.listeners.size, 0);
});

test('rejects expired or overlong challenge windows before reading capture', async () => {
    for (const expiresAt of [999, 6_001]) {
        const current = fixture((frame, emit) => emit(ack(frame.requestRef, 'prepared', expiresAt)));
        let reads = 0;
        await assert.rejects(current.bridge.activate(() => { reads += 1; return capture(); }),
            rejects('protocol_invalid'));
        assert.equal(reads, 0);
        assert.equal(current.disconnected(), 1);
    }
});

test('activation validates the post-challenge capture and bounded effective expiry', async () => {
    const invalidCapture = fixture((frame, emit) => emit(ack(frame.requestRef, 'prepared', 5_000)));
    await assert.rejects(invalidCapture.bridge.activate(() => ({ ...capture(), extra: true })),
        rejects('context_invalid'));
    assert.equal(invalidCapture.frames.length, 1);
    assert.equal(invalidCapture.connected(), true);

    const extended = fixture((frame, emit) => emit(ack(frame.requestRef,
        frame.method === 'prepare' ? 'prepared' : 'activated', frame.method === 'prepare' ? 5_000 : 20_001)));
    await assert.rejects(extended.bridge.activate(capture), rejects('protocol_invalid'));
    assert.equal(extended.disconnected(), 1);

    const holder: { current?: ReturnType<typeof fixture> } = {};
    const rollback = fixture((frame, emit) => {
        if (frame.method === 'prepare') emit(ack(frame.requestRef, 'prepared', 5_000));
        else { holder.current?.setNow(999); emit(ack(frame.requestRef, 'activated', 20_000)); }
    });
    holder.current = rollback;
    await assert.rejects(rollback.bridge.activate(capture), rejects('protocol_invalid'));
    assert.equal(rollback.disconnected(), 1);
});

test('timeout and disconnected transport fail closed and remove per-call resources', async () => {
    const timeout = fixture();
    const pending = timeout.bridge.activate(capture);
    assert.equal(timeout.timers[0]?.delay, 5_000);
    timeout.timers[0]?.callback();
    await assert.rejects(pending, rejects('timeout'));
    assert.equal(timeout.disconnected(), 1);
    assert.equal(timeout.listeners.size, 0);

    const absent = fixture(); absent.bridge.disconnect();
    await assert.rejects(absent.bridge.activate(capture), rejects('host_unavailable'));
});

test('revoke_all requires its exact ACK within one second and disconnects on failure', async () => {
    const current = fixture((frame, emit) => emit(ack(frame.requestRef, 'revoked')));
    assert.equal(await current.bridge.revokeAll('application_lock'), true);
    assert.equal(decodePortableSupervisorWebIpcFrameV1(current.frames[0]!).reason, 'application_lock');
    assert.equal(current.timers[0]?.delay, 1_000);

    const timeout = fixture(); const pending = timeout.bridge.revokeAll('reselection');
    assert.equal(timeout.timers[0]?.delay, 1_000); timeout.timers[0]?.callback();
    await assert.rejects(pending, rejects('timeout'));
    assert.equal(timeout.disconnected(), 1);
});

test('bridge source is stateless, Web-only and never writes protocol data to stdout', () => {
    const source = readFileSync(new URL('./portable-supervisor-web-ipc-bridge.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /(?:db-server|server-auth|owner-broker|operation-rpc|child_process|net|http|listen\s*\(|process\.stdout|console\.(?:log|info)|process\.env|writeFile|readFile)/iu);
    assert.doesNotMatch(source, /(?:let|const)\s+(?:pending|challenge|capture|owner)\s*=/u);
    assert.match(source, /process\.on\('message'/u);
    assert.match(source, /process\.off\('message'/u);
});
