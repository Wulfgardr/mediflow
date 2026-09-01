/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviderSecretBrokerV2, ProviderSecretBrokerV2Error } from './provider-secret-broker.ts';

const SENTINEL = 'sk-proj-SYNTHETIC_SECRET_SENTINEL_0123456789';
const CLAIM = Object.freeze({ providerId: 'openai', operation: 'document_synthesis', generation: 4 });
const REFERENCE = Object.freeze({ scheme: 'env', name: 'OPENAI_API_KEY' });

test('emette una lease opaca e inietta la credenziale una sola volta', async () => {
    const broker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SENTINEL });
    const lease = broker.issue({ ...CLAIM, secretRef: REFERENCE });
    assert.deepEqual(Reflect.ownKeys(lease), []);
    assert.deepEqual(broker.snapshot(lease), {
        schemaVersion: 'mediflow.ai.provider-secret-lease.v2', ...CLAIM, expiresAt: 31_000, state: 'available',
    });

    const headers: Record<string, string> = {};
    const result = await broker.consume(lease, CLAIM, async (inject) => {
        inject({ set(name, value) { headers[name] = value; } });
        return 'transport-ready';
    });
    assert.equal(result, 'transport-ready');
    assert.equal(headers.Authorization, `Bearer ${SENTINEL}`);
    assert.equal(broker.snapshot(lease).state, 'consumed');
    assert.equal(JSON.stringify({ broker, lease, snapshot: broker.snapshot(lease) }).includes(SENTINEL), false);
    await assert.rejects(
        broker.consume(lease, CLAIM, async () => undefined),
        (error: unknown) => error instanceof ProviderSecretBrokerV2Error && error.code === 'lease_consumed',
    );
    const hostileLease = broker.issue({ ...CLAIM, secretRef: REFERENCE });
    await assert.rejects(broker.consume(hostileLease, CLAIM, async (inject) => {
        inject({ set(_name, value) { throw new Error(value); } });
    }), (error: unknown) => error instanceof ProviderSecretBrokerV2Error
        && error.code === 'injection_failed' && !error.message.includes(SENTINEL));
    const forgedLease = broker.issue({ ...CLAIM, secretRef: REFERENCE });
    await assert.rejects(broker.consume(forgedLease, CLAIM, async (inject) => {
        inject({ set() {} }); const forged = new ProviderSecretBrokerV2Error('lease_revoked'); forged.message = SENTINEL; throw forged;
    }), (error: unknown) => error instanceof ProviderSecretBrokerV2Error && !error.message.includes(SENTINEL));
});

test('nega una lease scaduta anche se il clock host avanza durante il callback', async () => {
    let current = 1_000;
    const broker = createProviderSecretBrokerV2({ now: () => current, readEnv: () => SENTINEL });
    const lease = broker.issue({ ...CLAIM, secretRef: REFERENCE });
    await assert.rejects(broker.consume(lease, CLAIM, async (inject) => {
        current = 31_000;
        inject({ set() { throw new Error('must not receive secret'); } });
    }), (error: unknown) => error instanceof ProviderSecretBrokerV2Error && error.code === 'lease_expired');
    assert.equal(broker.snapshot(lease).state, 'expired');
});

test('revoca localmente la lease e cancella ogni riferimento prima del consumo', async () => {
    const broker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SENTINEL });
    const lease = broker.issue({ ...CLAIM, secretRef: REFERENCE });
    assert.equal(broker.revoke(lease), true);
    assert.equal(broker.snapshot(lease).state, 'revoked');
    await assert.rejects(broker.consume(lease, CLAIM, async () => undefined), (error: unknown) => (
        error instanceof ProviderSecretBrokerV2Error && error.code === 'lease_revoked'
    ));
    assert.equal(JSON.stringify({ lease, snapshot: broker.snapshot(lease) }).includes(SENTINEL), false);
});

test('nega e revoca mismatch di provider, operation o generation', async () => {
    for (const [claim, code] of [
        [{ ...CLAIM, providerId: 'anthropic' }, 'provider_mismatch'],
        [{ ...CLAIM, operation: 'patient_insight' }, 'operation_mismatch'],
        [{ ...CLAIM, generation: 5 }, 'generation_mismatch'],
    ] as const) {
        const broker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SENTINEL });
        const lease = broker.issue({ ...CLAIM, secretRef: REFERENCE });
        await assert.rejects(broker.consume(lease, claim, async () => undefined), (error: unknown) => (
            error instanceof ProviderSecretBrokerV2Error && error.code === code && !error.message.includes(SENTINEL)
        ));
        assert.equal(broker.snapshot(lease).state, 'revoked');
    }
});

test('la revoca host interrompe anche una callback di consumo gia attiva', async () => {
    const broker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => SENTINEL });
    const lease = broker.issue({ ...CLAIM, secretRef: REFERENCE });
    await assert.rejects(broker.consume(lease, CLAIM, async (inject) => {
        broker.revoke(lease);
        inject({ set() { throw new Error('must not receive secret'); } });
    }), (error: unknown) => error instanceof ProviderSecretBrokerV2Error && error.code === 'lease_revoked');
    assert.equal(broker.snapshot(lease).state, 'revoked');
});

test('risolve solo i due nomi env allowlisted e nega absent o reference alternative', async () => {
    const reads: string[] = [];
    const broker = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: (name: string) => { reads.push(name); return SENTINEL; } });
    const anthropicClaim = { ...CLAIM, providerId: 'anthropic' };
    const lease = broker.issue({ ...anthropicClaim, secretRef: { scheme: 'env', name: 'ANTHROPIC_API_KEY' } });
    let header: readonly [string, string] | null = null;
    await broker.consume(lease, anthropicClaim, async (inject) => inject({ set(name, value) { header = [name, value]; } }));
    assert.deepEqual(header, ['x-api-key', SENTINEL]);
    assert.deepEqual(reads, ['ANTHROPIC_API_KEY']);

    for (const secretRef of [
        { scheme: 'env', name: 'CUSTOM_API_KEY' },
        { scheme: 'inline', name: 'OPENAI_API_KEY' },
        { scheme: 'env', name: 'OPENAI_API_KEY', value: SENTINEL },
        Object.assign(Object.create({ command: 'printenv' }), REFERENCE),
    ]) {
        const closed = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => { throw new Error('must not read'); } });
        assert.throws(() => closed.issue({ ...CLAIM, secretRef }), (error: unknown) => (
            error instanceof ProviderSecretBrokerV2Error && error.code === 'secret_ref_invalid' && !error.message.includes(SENTINEL)
        ));
    }
    const absent = createProviderSecretBrokerV2({ now: () => 1_000, readEnv: () => undefined });
    assert.throws(() => absent.issue({ ...CLAIM, secretRef: REFERENCE }), (error: unknown) => (
        error instanceof ProviderSecretBrokerV2Error && error.code === 'secret_absent'
    ));
});

test('materializza getter una volta e respinge prototipi ostili prima di leggere il secret', async () => {
    let nowReads = 0; let envReads = 0; let nameReads = 0; let setterReads = 0;
    const sources = Object.defineProperties({}, {
        now: { enumerable: true, get() { nowReads += 1; return () => 1_000; } },
        readEnv: { enumerable: true, get() { envReads += 1; return () => SENTINEL; } },
    });
    const secretRef = Object.defineProperties({ scheme: 'env' }, {
        name: { enumerable: true, get() { nameReads += 1; return nameReads === 1 ? 'OPENAI_API_KEY' : 'CUSTOM_API_KEY'; } },
    });
    const broker = createProviderSecretBrokerV2(sources);
    const lease = broker.issue({ ...CLAIM, secretRef });
    const sink = Object.defineProperty({}, 'set', { get() {
        setterReads += 1;
        return setterReads === 1 ? () => undefined : () => { throw new Error('getter read twice'); };
    } });
    await broker.consume(lease, CLAIM, async (inject) => inject(sink as { set(name: string, value: string): unknown }));
    assert.deepEqual([nowReads, envReads, nameReads, setterReads], [1, 1, 1, 1]);

    for (const run of [
        () => createProviderSecretBrokerV2(Object.assign(Object.create({ authority: 'caller' }), { now: () => 1_000, readEnv: () => SENTINEL })),
        () => broker.issue(Object.assign(Object.create({ authority: 'caller' }), { ...CLAIM, secretRef: REFERENCE })),
    ]) assert.throws(run, (error: unknown) => error instanceof ProviderSecretBrokerV2Error && error.code === 'input_invalid');
});

test('un clock host non monotono chiude e revoca la lease senza leak', () => {
    let current = 1_000;
    const broker = createProviderSecretBrokerV2({ now: () => current, readEnv: () => SENTINEL });
    const lease = broker.issue({ ...CLAIM, secretRef: REFERENCE });
    current = 999;
    assert.throws(() => broker.snapshot(lease), (error: unknown) => (
        error instanceof ProviderSecretBrokerV2Error && error.code === 'clock_invalid' && !error.message.includes(SENTINEL)
    ));
    current = 1_001;
    assert.equal(broker.snapshot(lease).state, 'revoked');
});
