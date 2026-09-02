/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createAipOwnerBrokerV1 } from './owner-broker.ts';
import {
    AIP_BOOTSTRAP_ENV_KEY_V1,
    AIP_IPC_MAX_INPUT_BYTES_V1,
    AipAuthenticatedIpcV1Error,
    createAipAuthenticatedIpcHostV1,
    createAipChildEnvironmentReplacementV1,
} from './authenticated-ipc.ts';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const BOOTSTRAP = `aipb_${'1'.repeat(32)}`;
const ACTIVATION = Object.freeze({
    expectedProcessRef: 'process.synthetic.mcp.0001',
    expectedUserRef: 'user.synthetic.local.0001',
    bootstrapExpiresAt: 2_000,
    parentRef: 'parent.synthetic.web.0001',
    purposeCode: 'headless_status',
    operation: 'mediflow.system.headless_status.v1',
    capabilityId: 'system.headless_status.v1',
    scopeDigest: DIGEST,
    maxStage: 'read_only' as const,
    budget: 1,
    expiresAt: 5_000,
    generation: 1,
    revocationGeneration: 0,
    selectionEpoch: 0,
    parentGeneration: 1,
    policyGeneration: 1,
    venue: 'local_intelligent_host' as const,
    egressAllowed: false,
});
const XPC_PEER = Object.freeze({
    transport: 'xpc',
    permission: 'per_user',
    peerRef: 'peer.synthetic.mcp.0001',
    runtimeRef: 'runtime.synthetic.mcp.0001',
    processRef: ACTIVATION.expectedProcessRef,
    userRef: ACTIVATION.expectedUserRef,
});
const frame = (bootstrapRef = BOOTSTRAP, extra: object = {}): Uint8Array => new TextEncoder().encode(JSON.stringify({
    schemaVersion: 'mediflow.aip.bootstrap.v1', operation: 'bootstrap', bootstrapRef, ...extra,
}));
const code = (expected: string) => (error: unknown): boolean => error instanceof AipAuthenticatedIpcV1Error
    && error.code === expected;

function fixture(peer: unknown = XPC_PEER, audit: unknown[] = []) {
    let timestamp = 1_000;
    const refs = ['agent.synthetic.aip.0001'];
    const broker = createAipOwnerBrokerV1({
        now: () => timestamp,
        nextRef: () => refs.shift(),
        hashRef: () => DIGEST,
        writeAudit: async () => undefined,
    });
    const host = createAipAuthenticatedIpcHostV1({
        broker,
        now: () => timestamp,
        nextBootstrapRef: () => BOOTSTRAP,
        hashRef: () => DIGEST,
        writeAudit: async (record: unknown) => { audit.push(record); },
        authenticateTrustedPortPeer: async () => peer,
    });
    return { host, broker, setNow: (value: number) => { timestamp = value; } };
}

test('bootstrap XPC per-user crea una connessione host-owned senza restituire authority', async () => {
    const audit: unknown[] = [];
    const { host } = fixture(XPC_PEER, audit);
    const connection = Object.freeze(Object.create(null));
    const bootstrapRef = host.stageLaunch(ACTIVATION);
    const environment = createAipChildEnvironmentReplacementV1(bootstrapRef);

    assert.equal(Object.getPrototypeOf(environment), null);
    assert.deepEqual(Reflect.ownKeys(environment), [AIP_BOOTSTRAP_ENV_KEY_V1]);
    assert.equal(environment[AIP_BOOTSTRAP_ENV_KEY_V1], BOOTSTRAP);
    assert.equal(Object.isFrozen(environment), true);

    const response = await host.handleBootstrap(connection, frame());
    assert.deepEqual(JSON.parse(new TextDecoder().decode(response)), {
        schemaVersion: 'mediflow.aip.bootstrap.result.v1', outcome: 'connected',
    });
    assert.equal(host.close(connection), true);
    assert.equal(host.close(connection), false);
    assert.deepEqual(audit, [{
        schemaVersion: 'mediflow.aip.ipc.audit.v1', eventType: 'bootstrap', outcome: 'allowed',
        transport: 'xpc', peerRefHash: DIGEST, runtimeRefHash: DIGEST, timestamp: 1_000, denialCode: null,
    }]);
    assert.equal(JSON.stringify(audit).includes(BOOTSTRAP), false);
    assert.equal(JSON.stringify(audit).includes(ACTIVATION.expectedProcessRef), false);
});

test('consegna una sola volta al launcher host l owner opaco della connessione autenticata', async () => {
    const { host, broker } = fixture();
    const connection = Object.freeze(Object.create(null));
    host.stageLaunch(ACTIVATION);

    assert.throws(() => host.claimAuthenticatedOwner(connection), code('connection_invalid'));
    const response = await host.handleBootstrap(connection, frame());
    assert.equal(new TextDecoder().decode(response).includes('owner'), false);

    const owner = host.claimAuthenticatedOwner(connection);
    assert.equal(Object.getPrototypeOf(owner), null);
    assert.equal(Object.isFrozen(owner), true);
    assert.deepEqual(Reflect.ownKeys(owner), []);
    assert.throws(() => host.claimAuthenticatedOwner(connection), code('connection_invalid'));

    assert.equal(host.close(connection), true);
    assert.equal(broker.revokeOwner(owner), false);
    assert.throws(() => host.claimAuthenticatedOwner(connection), code('connection_invalid'));
});

test('non rende reclamabile l owner durante auth e invalida il bridge a cancel e restart', async () => {
    let resolvePeer!: (value: unknown) => void;
    const pendingPeer = new Promise<unknown>((resolve) => { resolvePeer = resolve; });
    const refs = ['agent.synthetic.aip.0001'];
    const broker = createAipOwnerBrokerV1({ now: () => 1_000, nextRef: () => refs.shift(), hashRef: () => DIGEST,
        writeAudit: async () => undefined });
    const host = createAipAuthenticatedIpcHostV1({ broker, now: () => 1_000, nextBootstrapRef: () => BOOTSTRAP,
        hashRef: () => DIGEST, writeAudit: async () => undefined, authenticateTrustedPortPeer: () => pendingPeer });
    const connection = Object.freeze(Object.create(null));
    host.stageLaunch(ACTIVATION);
    const attempt = host.handleBootstrap(connection, frame());
    assert.throws(() => host.claimAuthenticatedOwner(connection), code('connection_invalid'));
    assert.equal(host.cancel(connection), true);
    resolvePeer(XPC_PEER);
    await assert.rejects(attempt, code('cancelled'));
    assert.throws(() => host.claimAuthenticatedOwner(connection), code('connection_invalid'));

    const restarted = fixture();
    const restartedConnection = Object.freeze(Object.create(null));
    restarted.host.stageLaunch(ACTIVATION);
    await restarted.host.handleBootstrap(restartedConnection, frame());
    restarted.host.restart();
    assert.throws(() => restarted.host.claimAuthenticatedOwner(restartedConnection), code('connection_invalid'));

    const hostile = new Proxy(Object.create(null), {});
    assert.throws(() => restarted.host.claimAuthenticatedOwner(hostile), code('connection_invalid'));
});

test('bootstrap e connessione sono monouso e process-bound anche con chiamate concorrenti', async () => {
    let resolvePeer!: (value: unknown) => void;
    const peerPromise = new Promise<unknown>((resolve) => { resolvePeer = resolve; });
    const refs = ['agent.synthetic.aip.0001'];
    const broker = createAipOwnerBrokerV1({ now: () => 1_000, nextRef: () => refs.shift(), hashRef: () => DIGEST,
        writeAudit: async () => undefined });
    const host = createAipAuthenticatedIpcHostV1({
        broker, now: () => 1_000, nextBootstrapRef: () => BOOTSTRAP, hashRef: () => DIGEST,
        writeAudit: async () => undefined, authenticateTrustedPortPeer: () => peerPromise,
    });
    host.stageLaunch(ACTIVATION);
    const firstConnection = Object.freeze(Object.create(null));
    const secondConnection = Object.freeze(Object.create(null));
    const first = host.handleBootstrap(firstConnection, frame());
    const replay = host.handleBootstrap(secondConnection, frame());
    resolvePeer(XPC_PEER);
    await first;
    await assert.rejects(replay, code('bootstrap_replay'));

    const { host: crossProcess } = fixture({ ...XPC_PEER, processRef: 'process.synthetic.mcp.9999' });
    crossProcess.stageLaunch(ACTIVATION);
    await assert.rejects(crossProcess.handleBootstrap(Object.freeze(Object.create(null)), frame()),
        code('identity_mismatch'));
});

test('accetta solo attestazioni locali con permesso equivalente esplicito', async () => {
    const accepted = [
        XPC_PEER,
        { ...XPC_PEER, transport: 'uds', permission: 'mode_0600_peer_credentials' },
        { ...XPC_PEER, transport: 'named_pipe', permission: 'owner_only_acl' },
    ];
    for (const peer of accepted) {
        const { host } = fixture(peer);
        host.stageLaunch(ACTIVATION);
        await host.handleBootstrap(Object.freeze(Object.create(null)), frame());
    }
    const denied = [
        { ...XPC_PEER, transport: 'tcp', permission: 'per_user' },
        { ...XPC_PEER, transport: 'uds', permission: 'mode_0660_peer_credentials' },
        { ...XPC_PEER, transport: 'uds', permission: 'mode_0600' },
        { ...XPC_PEER, transport: 'named_pipe', permission: 'authenticated_users_acl' },
        { ...XPC_PEER, transport: 'xpc', permission: 'system_wide' },
    ];
    for (const peer of denied) {
        const { host } = fixture(peer);
        host.stageLaunch(ACTIVATION);
        await assert.rejects(host.handleBootstrap(Object.freeze(Object.create(null)), frame()),
            code('permission_denied'));
    }

    const refs = ['agent.synthetic.aip.0001'];
    const broker = createAipOwnerBrokerV1({ now: () => 1_000, nextRef: () => refs.shift(), hashRef: () => DIGEST,
        writeAudit: async () => undefined });
    assert.throws(() => createAipAuthenticatedIpcHostV1({ broker, now: () => 1_000,
        nextBootstrapRef: () => BOOTSTRAP, hashRef: () => DIGEST, writeAudit: async () => undefined }),
    code('input_invalid'));
});

test('nega frame inattesi, UTF-8 invalido e input oltre il bound senza authority caller-supplied', async () => {
    const audit: unknown[] = [];
    const cases = [
        frame(BOOTSTRAP, { clientInfo: { name: 'hostile' } }),
        new TextEncoder().encode(JSON.stringify({ schemaVersion: 'mediflow.aip.bootstrap.v1', operation: 'bootstrap',
            bootstrapRef: BOOTSTRAP, patientId: 'synthetic-patient' })),
        frame(BOOTSTRAP, { transport: 'xpc', permission: 'per_user', peerRef: XPC_PEER.peerRef,
            runtimeRef: XPC_PEER.runtimeRef, processRef: XPC_PEER.processRef, userRef: XPC_PEER.userRef }),
        Uint8Array.from([0xc3, 0x28]),
    ];
    for (const payload of cases) {
        const { host } = fixture(XPC_PEER, audit);
        host.stageLaunch(ACTIVATION);
        await assert.rejects(host.handleBootstrap(Object.freeze(Object.create(null)), payload), code('frame_invalid'));
    }
    const { host } = fixture();
    host.stageLaunch(ACTIVATION);
    await assert.rejects(host.handleBootstrap(Object.freeze(Object.create(null)),
        new Uint8Array(AIP_IPC_MAX_INPUT_BYTES_V1 + 1)), code('frame_oversized'));
    assert.deepEqual(Object.keys(audit[0] as object), ['schemaVersion', 'eventType', 'outcome', 'transport',
        'peerRefHash', 'runtimeRefHash', 'timestamp', 'denialCode']);
    assert.equal(JSON.stringify(audit).includes(BOOTSTRAP), false);
    assert.equal(JSON.stringify(audit).includes('synthetic-patient'), false);
});

test('cancel, timeout, expiry e restart bruciano bootstrap e negano completamenti tardivi', async () => {
    let resolvePeer!: (value: unknown) => void;
    const pendingPeer = new Promise<unknown>((resolve) => { resolvePeer = resolve; });
    const refs = ['agent.synthetic.aip.0001'];
    const broker = createAipOwnerBrokerV1({ now: () => 1_000, nextRef: () => refs.shift(), hashRef: () => DIGEST,
        writeAudit: async () => undefined });
    const host = createAipAuthenticatedIpcHostV1({ broker, now: () => 1_000, nextBootstrapRef: () => BOOTSTRAP,
        hashRef: () => DIGEST, writeAudit: async () => undefined, authenticateTrustedPortPeer: () => pendingPeer });
    host.stageLaunch(ACTIVATION);
    const connection = Object.freeze(Object.create(null));
    const attempt = host.handleBootstrap(connection, frame());
    assert.equal(host.cancel(connection), true);
    resolvePeer(XPC_PEER);
    await assert.rejects(attempt, code('cancelled'));
    await assert.rejects(host.handleBootstrap(Object.freeze(Object.create(null)), frame()), code('bootstrap_replay'));

    const expired = fixture();
    expired.host.stageLaunch(ACTIVATION);
    expired.setNow(2_000);
    await assert.rejects(expired.host.handleBootstrap(Object.freeze(Object.create(null)), frame()), code('bootstrap_expired'));

    const restarted = fixture();
    restarted.host.stageLaunch(ACTIVATION);
    restarted.host.restart();
    await assert.rejects(restarted.host.handleBootstrap(Object.freeze(Object.create(null)), frame()), code('restart_changed'));

    const live = fixture();
    live.host.stageLaunch(ACTIVATION);
    await live.host.handleBootstrap(Object.freeze(Object.create(null)), frame());
    live.host.restart();
    await assert.rejects(live.host.handleBootstrap(Object.freeze(Object.create(null)), frame()), code('restart_changed'));

    const timeoutRefs = ['agent.synthetic.aip.0001'];
    const timeoutBroker = createAipOwnerBrokerV1({ now: () => 1_000, nextRef: () => timeoutRefs.shift(), hashRef: () => DIGEST,
        writeAudit: async () => undefined });
    const timeoutHost = createAipAuthenticatedIpcHostV1({ broker: timeoutBroker, now: () => 1_000,
        nextBootstrapRef: () => BOOTSTRAP, hashRef: () => DIGEST, writeAudit: async () => undefined,
        authenticateTrustedPortPeer: async () => new Promise(() => undefined) });
    timeoutHost.stageLaunch(ACTIVATION);
    await assert.rejects(timeoutHost.handleBootstrap(Object.freeze(Object.create(null)), frame()), code('timeout'));
});

test('cancel durante audit asincrono revoca owner e impedisce il commit della connessione', async () => {
    let releaseAudit!: () => void;
    let auditEntered!: () => void;
    const auditGate = new Promise<void>((resolve) => { releaseAudit = resolve; });
    const entered = new Promise<void>((resolve) => { auditEntered = resolve; });
    const refs = ['agent.synthetic.aip.0001'];
    const broker = createAipOwnerBrokerV1({ now: () => 1_000, nextRef: () => refs.shift(), hashRef: () => DIGEST,
        writeAudit: async () => undefined });
    const host = createAipAuthenticatedIpcHostV1({ broker, now: () => 1_000, nextBootstrapRef: () => BOOTSTRAP,
        hashRef: () => DIGEST, authenticateTrustedPortPeer: async () => XPC_PEER,
        writeAudit: async (record: unknown) => {
            if ((record as { outcome?: unknown }).outcome === 'allowed') { auditEntered(); await auditGate; }
        } });
    host.stageLaunch(ACTIVATION);
    const connection = Object.freeze(Object.create(null));
    const attempt = host.handleBootstrap(connection, frame());
    await entered;
    assert.equal(host.cancel(connection), true);
    releaseAudit();
    await assert.rejects(attempt, code('cancelled'));
    await assert.rejects(host.handleBootstrap(Object.freeze(Object.create(null)), frame()), code('bootstrap_replay'));
});

test('un audit che non completa fallisce chiuso entro il timeout bounded', async () => {
    const refs = ['agent.synthetic.aip.0001'];
    const broker = createAipOwnerBrokerV1({ now: () => 1_000, nextRef: () => refs.shift(), hashRef: () => DIGEST,
        writeAudit: async () => undefined });
    const host = createAipAuthenticatedIpcHostV1({ broker, now: () => 1_000, nextBootstrapRef: () => BOOTSTRAP,
        hashRef: () => DIGEST, authenticateTrustedPortPeer: async () => XPC_PEER,
        writeAudit: async () => new Promise(() => undefined) });
    host.stageLaunch(ACTIVATION);
    const outcome = await Promise.race([
        host.handleBootstrap(Object.freeze(Object.create(null)), frame()).then(() => 'connected',
            (error: unknown) => error instanceof AipAuthenticatedIpcV1Error ? error.code : 'unexpected'),
        new Promise<string>((resolve) => setTimeout(() => resolve('unbounded'), 1_250)),
    ]);
    assert.equal(outcome, 'audit_failed');
});

test('nega Proxy/accessor e reentrancy delle porte trusted senza osservare authority', async () => {
    let getterObserved = false;
    const proxy = new Proxy(XPC_PEER, { ownKeys: () => { throw new Error('observed'); } });
    for (const peer of [proxy, Object.defineProperty({}, 'transport', { get: () => {
        getterObserved = true; return 'xpc';
    } })]) {
        const { host } = fixture(peer);
        host.stageLaunch(ACTIVATION);
        await assert.rejects(host.handleBootstrap(Object.freeze(Object.create(null)), frame()), code('peer_denied'));
    }
    assert.equal(getterObserved, false);

    const holder: { host?: ReturnType<typeof createAipAuthenticatedIpcHostV1> } = {};
    const reentrantRefs = ['agent.synthetic.aip.0001'];
    const broker = createAipOwnerBrokerV1({ now: () => 1_000, nextRef: () => reentrantRefs.shift(), hashRef: () => DIGEST,
        writeAudit: async () => undefined });
    const host = createAipAuthenticatedIpcHostV1({ broker, now: () => 1_000, nextBootstrapRef: () => BOOTSTRAP,
        hashRef: () => DIGEST, writeAudit: async () => undefined,
        authenticateTrustedPortPeer: async () => { holder.host?.restart(); return XPC_PEER; } });
    holder.host = host;
    host.stageLaunch(ACTIVATION);
    await assert.rejects(host.handleBootstrap(Object.freeze(Object.create(null)), frame()), code('peer_denied'));
});

test('nega Proxy revocati senza propagare eccezioni native', async () => {
    const revokedActivation = Proxy.revocable({ ...ACTIVATION }, {});
    revokedActivation.revoke();
    const activationHost = fixture().host;
    assert.throws(() => activationHost.stageLaunch(revokedActivation.proxy), code('input_invalid'));

    const revokedPeer = Proxy.revocable({ ...XPC_PEER }, {});
    revokedPeer.revoke();
    const peerHost = fixture(revokedPeer.proxy).host;
    peerHost.stageLaunch(ACTIVATION);
    await assert.rejects(peerHost.handleBootstrap(Object.freeze(Object.create(null)), frame()), code('peer_denied'));

    const revokedFrame = Proxy.revocable(frame(), {});
    revokedFrame.revoke();
    const frameHost = fixture().host;
    frameHost.stageLaunch(ACTIVATION);
    await assert.rejects(frameHost.handleBootstrap(Object.freeze(Object.create(null)), revokedFrame.proxy),
        code('frame_invalid'));
});
