/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { MINI_EXIT, runMiniTransport } from '../packages/mini/src/cli';
import {
    createHeadlessSyntheticNoBypassHarness,
    HEADLESS_P6_SOURCE_DIGEST,
} from './verify-headless-synthetic-no-bypass';

const raw = (command = 'headless.intent.chat', args: Record<string, unknown> = {}) => JSON.stringify({
    command,
    args: {
        intent: 'synthetic: summarize the selected fixture',
        requestRef: 'req_opaque0001',
        idempotencyRef: 'idem_opaque0001',
        ...args,
    },
});

test('composes the unbound transport into one frozen no-bypass candidate receipt', () => {
    const publicTransport = runMiniTransport([], raw());
    assert.equal(publicTransport.exitCode, MINI_EXIT.BROKER_UNAVAILABLE);
    assert.equal(JSON.parse(publicTransport.stdout).error, 'TRANSPORT_UNBOUND');

    const harness = createHeadlessSyntheticNoBypassHarness();
    const receipt = harness.run([], raw());
    assert.equal(harness.executionCount(), 1);
    assert.deepEqual(receipt, {
        schemaVersion: 'mediflow.headless.synthetic-no-bypass-receipt.v1',
        headlessSourceSha: '67204eb18e766553c8bc7d01368a10d2da9e1c76',
        sourceDigest: HEADLESS_P6_SOURCE_DIGEST,
        sourceBlobs: [
            { path: 'packages/mini/src/cli.ts', gitBlob: '4dbbe7727a92ceaf6f213e997c28c35db4dde3e0', sha256: '1230d0dc148b0ef7bc1ae97ca2534a77640e791f9f0ddf47f5d46755b93502d2' },
            { path: 'packages/mini/src/headless-intent-adapter.ts', gitBlob: '8474b5402402e2d656ab1b0635bc1d12553512c6', sha256: '1a7e421aae6a4b60726c82a005e4c40c7f9a285d56454b3641033005d5e13de6' },
            { path: 'lib/headless-semantic-orchestrator.ts', gitBlob: '13c11bc8a8b8c9be4be2b428a15ed734a04dac5c', sha256: '1271ab2d529df310455293a3b79d69ce34ec44a88a045cf06eabe8b691ccfd22' },
        ],
        transportState: 'TRANSPORT_UNBOUND', adapterKind: 'chat', requestRef: 'req_opaque0001',
        actionRef: 'act_0123456789abcdef0123456789abcdef', capabilityId: 'web-01',
        applicationServiceRef: 'appsvc:web-01', fabricDependency: null, outcome: 'read',
        policyDecision: 'per_operation_allow', revisionBinding: 'lease:7',
        createdAt: '2026-08-24T08:00:00.000Z', writesPerformed: 0, applyPolicy: 'none',
        claimCeiling: 'Candidate synthetic evidence only; not operational, integrated, release-ready, or released.',
    });
    assert.equal(Object.isFrozen(receipt), true);
    assert.equal(Object.isFrozen(receipt.sourceBlobs), true);
    assert.ok(receipt.sourceBlobs.every(Object.isFrozen));
});

test('rejects ambiguous raw transport, bounds, commands, and caller authority before execution', () => {
    const cases: Array<[readonly string[], string]> = [
        [[], '{"command":"headless.intent.chat","command":"headless.intent.voice","args":{}}'],
        [[], '{"command":"headless.intent.chat","args":{"intent":"synthetic: one","intent":"synthetic: two","requestRef":"req_opaque0001","idempotencyRef":"idem_opaque0001"}}'],
        [['--format', 'json', '--format', 'ndjson'], raw()],
        [['--format', 'xml'], raw()],
        [[], raw('headless.intent.unknown')],
        [[], raw('headless.intent.chat', { authority: 'caller-choice' })],
        [[], raw('headless.intent.chat', { provider: 'caller-choice' })],
        [[], raw('headless.intent.chat', { prompt: 'free text' })],
        [[], raw('headless.intent.chat', { apply: true })],
        [[], 'x'.repeat(16 * 1024 + 1)],
    ];
    for (const [argv, stdin] of cases) {
        const harness = createHeadlessSyntheticNoBypassHarness();
        assert.throws(() => harness.run(argv, stdin));
        assert.equal(harness.executionCount(), 0);
    }
});

test('rejects hostile argv records without reflection or async coercion', () => {
    let reads = 0;
    const accessor = ['--format', 'json'];
    Object.defineProperty(accessor, '0', { enumerable: true, get: () => { reads += 1; return '--format'; } });
    const custom = Object.setPrototypeOf(['--format', 'json'], { forged: true });
    const thenable = Object.assign(['--format', 'json'], { then: () => undefined });
    for (const argv of [new Proxy([], {}), accessor, custom, thenable, new Array(1)]) {
        assert.throws(() => createHeadlessSyntheticNoBypassHarness().run(argv, raw()));
    }
    assert.equal(reads, 0);
});

test('denies unsafe host states and identities, burns replay, and prevents reentry', () => {
    for (const scenario of ['revoked', 'denied', 'lease_drift', 'mutation_drift', 'bad_service', 'bad_capability', 'bad_fabric', 'reentered'] as const) {
        const harness = createHeadlessSyntheticNoBypassHarness(scenario);
        assert.throws(() => harness.run([], raw()));
        assert.equal(harness.executionCount(), ['lease_drift', 'mutation_drift', 'reentered'].includes(scenario) ? 1 : 0);
    }
    const harness = createHeadlessSyntheticNoBypassHarness();
    harness.run([], raw());
    assert.throws(() => harness.run([], raw()), /idempotency_replayed/);
    assert.equal(harness.executionCount(), 1);
});

test('keeps the receipt PHI-safe, exact-source-bound, zero-write, and apply-denied', () => {
    assert.equal(HEADLESS_P6_SOURCE_DIGEST, '768c6f8eb430e02ca5882a5befd5769ac1bc026c00671fcfe7bd911e957319e1');
    const receipt = createHeadlessSyntheticNoBypassHarness().run(['--format', 'ndjson'], raw('headless.intent.voice'));
    const keys = new Set<string>();
    const visit = (value: unknown): void => {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) { keys.add(key.toLowerCase()); visit(child); }
    };
    visit(receipt);
    for (const forbidden of ['name', 'patient', 'clinicalpayload', 'prompt', 'modeloutput', 'credential', 'cookie', 'token', 'authority', 'provider', 'venue', 'egress', 'sql', 'sqlite', 'write', 'apply'])
        assert.equal(keys.has(forbidden), false, forbidden);
    assert.equal(receipt.writesPerformed, 0);
    assert.equal(receipt.applyPolicy, 'none');
    assert.equal(receipt.adapterKind, 'voice');
});
