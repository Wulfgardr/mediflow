/* @Codex */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAipOwnerBrokerV1 } from './owner-broker.ts';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const BINDING = Object.freeze({
    peerRef: 'peer.local.synthetic.0001',
    runtimeRef: 'runtime.local.synthetic.0001',
    parentRef: 'parent.local.synthetic.0001',
    purposeCode: 'terminology_lookup',
    operation: 'terminology_search',
    capabilityId: 'mediflow.terminology.search.v1',
    scopeDigest: DIGEST,
    maxStage: 'read_only',
    budget: 2,
    expiresAt: 2_000,
    generation: 1,
    revocationGeneration: 0,
    selectionEpoch: 7,
    parentGeneration: 3,
    policyGeneration: 5,
    venue: 'local_intelligent_host',
    egressAllowed: false,
});
const CURRENT = Object.freeze({
    peerRef: BINDING.peerRef,
    generation: BINDING.generation,
    revocationGeneration: BINDING.revocationGeneration,
    selectionEpoch: BINDING.selectionEpoch,
    parentGeneration: BINDING.parentGeneration,
    policyGeneration: BINDING.policyGeneration,
});
const CLAIM = Object.freeze({ operation: BINDING.operation, capabilityId: BINDING.capabilityId });

test('emette handle opachi e autorizza solo dopo un audit PHI-safe', async () => {
    const audit: unknown[] = [];
    const refs = ['agent.synthetic.0001', 'lease.synthetic.0001', 'permit.synthetic.0001'];
    const broker = createAipOwnerBrokerV1({
        now: () => 1_000,
        nextRef: () => refs.shift(),
        hashRef: () => DIGEST,
        writeAudit: async (record: unknown) => { audit.push(record); },
    });

    const owner = broker.issueOwner(BINDING);
    const lease = broker.issueLease(owner);
    const permit = await broker.authorize(lease, CURRENT, CLAIM);

    for (const handle of [owner, lease, permit]) {
        assert.equal(Object.getPrototypeOf(handle), null);
        assert.deepEqual(Reflect.ownKeys(handle), []);
        assert.equal(JSON.stringify(handle), '{}');
    }
    assert.deepEqual(audit, [{
        schemaVersion: 'mediflow.aip.audit.v1', eventType: 'authorization', outcome: 'allowed',
        operation: BINDING.operation, capabilityId: BINDING.capabilityId, agentRefHash: DIGEST,
        leaseRefHash: DIGEST, purposeCode: BINDING.purposeCode, maxStage: BINDING.maxStage,
        generation: 1, selectionEpoch: 7, timestamp: 1_000, denialCode: null, budgetUsed: 1,
    }]);
    assert.doesNotMatch(JSON.stringify(audit), /peer|runtime|parent|patient|payload|prompt|cookie|secret/ui);
});

test('nega e revoca un peer diverso registrando soltanto il denial minimizzato', async () => {
    const audit: Array<Record<string, unknown>> = [];
    const refs = ['agent.synthetic.0002', 'lease.synthetic.0002'];
    const broker = createAipOwnerBrokerV1({
        now: () => 1_000,
        nextRef: () => refs.shift(),
        hashRef: () => DIGEST,
        writeAudit: async (record: unknown) => { audit.push(record as Record<string, unknown>); },
    });
    const lease = broker.issueLease(broker.issueOwner(BINDING));

    await assert.rejects(
        broker.authorize(lease, { ...CURRENT, peerRef: 'peer.local.synthetic.other' }, CLAIM),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'peer_mismatch',
    );
    assert.equal(audit.length, 1);
    assert.deepEqual({ outcome: audit[0]?.outcome, denialCode: audit[0]?.denialCode },
        { outcome: 'denied', denialCode: 'peer_mismatch' });
    assert.doesNotMatch(JSON.stringify(audit), /peer\.local|runtime|parent|patient|payload|prompt|cookie|secret/ui);
});

test('nega il replay della stessa lease e ne registra il denial', async () => {
    const audit: Array<Record<string, unknown>> = [];
    const refs = ['agent.synthetic.0003', 'lease.synthetic.0003', 'permit.synthetic.0003'];
    const broker = createAipOwnerBrokerV1({
        now: () => 1_000,
        nextRef: () => refs.shift(),
        hashRef: () => DIGEST,
        writeAudit: async (record: unknown) => { audit.push(record as Record<string, unknown>); },
    });
    const lease = broker.issueLease(broker.issueOwner(BINDING));
    await broker.authorize(lease, CURRENT, CLAIM);

    await assert.rejects(broker.authorize(lease, CURRENT, CLAIM),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'lease_replay');
    assert.deepEqual(audit.map((record) => [record.outcome, record.denialCode]),
        [['allowed', null], ['denied', 'lease_replay']]);
});

test('nega ogni drift di generazione, selezione, parent, policy o capability', async () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>, string]> = [
        [{ ...CURRENT, generation: 2 }, { ...CLAIM }, 'generation_changed'],
        [{ ...CURRENT, revocationGeneration: 1 }, { ...CLAIM }, 'revoked'],
        [{ ...CURRENT, selectionEpoch: 8 }, { ...CLAIM }, 'selection_changed'],
        [{ ...CURRENT, parentGeneration: 4 }, { ...CLAIM }, 'parent_disposed'],
        [{ ...CURRENT, policyGeneration: 6 }, { ...CLAIM }, 'policy_changed'],
        [{ ...CURRENT }, { ...CLAIM, operation: 'other_operation' }, 'claim_mismatch'],
        [{ ...CURRENT }, { ...CLAIM, capabilityId: 'mediflow.other.v1' }, 'claim_mismatch'],
    ];
    for (const [current, claim, expected] of cases) {
        const audit: Array<Record<string, unknown>> = [];
        const refs = ['agent.synthetic.drift', 'lease.synthetic.drift'];
        const broker = createAipOwnerBrokerV1({ now: () => 1_000, nextRef: () => refs.shift(),
            hashRef: () => DIGEST, writeAudit: async (record: unknown) => { audit.push(record as Record<string, unknown>); } });
        const lease = broker.issueLease(broker.issueOwner(BINDING));
        await assert.rejects(broker.authorize(lease, current, claim),
            (error: unknown) => error instanceof Error && 'code' in error && error.code === expected);
        assert.equal(audit[0]?.denialCode, expected);
        assert.equal(audit[0]?.outcome, 'denied');
    }
});

test('nega scadenza e budget esaurito prima di emettere un permit', async () => {
    const expiredAudit: Array<Record<string, unknown>> = [];
    const expiredTimes = [1_000, 2_000];
    const expiredRefs = ['agent.synthetic.expired', 'lease.synthetic.expired'];
    const expired = createAipOwnerBrokerV1({ now: () => expiredTimes.shift(), nextRef: () => expiredRefs.shift(),
        hashRef: () => DIGEST, writeAudit: async (record: unknown) => { expiredAudit.push(record as Record<string, unknown>); } });
    const expiredLease = expired.issueLease(expired.issueOwner(BINDING));
    await assert.rejects(expired.authorize(expiredLease, CURRENT, CLAIM),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'expired');
    assert.equal(expiredAudit[0]?.denialCode, 'expired');

    const budgetAudit: Array<Record<string, unknown>> = [];
    const budgetRefs = ['agent.synthetic.budget', 'lease.synthetic.budget1', 'lease.synthetic.budget2', 'permit.synthetic.budget'];
    const budget = createAipOwnerBrokerV1({ now: () => 1_000, nextRef: () => budgetRefs.shift(),
        hashRef: () => DIGEST, writeAudit: async (record: unknown) => { budgetAudit.push(record as Record<string, unknown>); } });
    const owner = budget.issueOwner({ ...BINDING, budget: 1 });
    const first = budget.issueLease(owner);
    const second = budget.issueLease(owner);
    await budget.authorize(first, CURRENT, CLAIM);
    await assert.rejects(budget.authorize(second, CURRENT, CLAIM),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'budget_exhausted');
    assert.deepEqual(budgetAudit.map((record) => record.denialCode), [null, 'budget_exhausted']);
});

test('revoca owner, parent e intero broker e non ripristina lease dopo restart', async () => {
    const cases: Array<[string, (broker: ReturnType<typeof createAipOwnerBrokerV1>, owner: unknown) => void]> = [
        ['revoked', (broker, owner) => { broker.revokeOwner(owner); }],
        ['revoked', (broker) => { broker.revokeAll(); }],
        ['parent_disposed', (broker) => { broker.disposeParent(BINDING.parentRef); }],
        ['restart_changed', (broker) => { broker.restart(); }],
    ];
    for (const [expected, revoke] of cases) {
        const audit: Array<Record<string, unknown>> = [];
        const refs = ['agent.synthetic.revoke', 'lease.synthetic.revoke'];
        const broker = createAipOwnerBrokerV1({ now: () => 1_000, nextRef: () => refs.shift(),
            hashRef: () => DIGEST, writeAudit: async (record: unknown) => { audit.push(record as Record<string, unknown>); } });
        const owner = broker.issueOwner(BINDING);
        const lease = broker.issueLease(owner);
        revoke(broker, owner);
        await assert.rejects(broker.authorize(lease, CURRENT, CLAIM),
            (error: unknown) => error instanceof Error && 'code' in error && error.code === expected);
        assert.equal(audit[0]?.denialCode, expected);
    }
});

test('un errore del boundary audit revoca la lease senza propagare dettagli', async () => {
    const sentinel = 'sensitive-audit-boundary-detail';
    let hashCalls = 0;
    const hashRefs = ['agent.synthetic.hashfail', 'lease.synthetic.hashfail'];
    const hashAudit: unknown[] = [];
    const hashFailure = createAipOwnerBrokerV1({ now: () => 1_000, nextRef: () => hashRefs.shift(),
        hashRef: () => { hashCalls += 1; if (hashCalls === 1) throw new Error(sentinel); return DIGEST; },
        writeAudit: async (record: unknown) => { hashAudit.push(record); } });
    const hashLease = hashFailure.issueLease(hashFailure.issueOwner(BINDING));
    await assert.rejects(hashFailure.authorize(hashLease, CURRENT, CLAIM),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'audit_failed'
            && !error.message.includes(sentinel));
    await assert.rejects(hashFailure.authorize(hashLease, CURRENT, CLAIM),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'lease_revoked');
    assert.equal((hashAudit[0] as Record<string, unknown>)?.denialCode, 'lease_revoked');

    let auditCalls = 0;
    const portRefs = ['agent.synthetic.auditfail', 'lease.synthetic.auditfail'];
    const portFailure = createAipOwnerBrokerV1({ now: () => 1_000, nextRef: () => portRefs.shift(), hashRef: () => DIGEST,
        writeAudit: async () => { auditCalls += 1; if (auditCalls === 1) throw new Error(sentinel); } });
    const portLease = portFailure.issueLease(portFailure.issueOwner(BINDING));
    await assert.rejects(portFailure.authorize(portLease, CURRENT, CLAIM),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'audit_failed'
            && !error.message.includes(sentinel));
    await assert.rejects(portFailure.authorize(portLease, CURRENT, CLAIM),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'lease_revoked');
});

test('input currentness o claim ostili revocano e producono un denial senza leggerli due volte', async () => {
    for (const [current, claim, expected] of [
        [{ ...CURRENT, extra: 'forbidden' }, CLAIM, 'currentness_invalid'],
        [CURRENT, { ...CLAIM, extra: 'forbidden' }, 'claim_invalid'],
    ] as const) {
        const audit: Array<Record<string, unknown>> = [];
        const refs = ['agent.synthetic.invalid', 'lease.synthetic.invalid'];
        const broker = createAipOwnerBrokerV1({ now: () => 1_000, nextRef: () => refs.shift(), hashRef: () => DIGEST,
            writeAudit: async (record: unknown) => { audit.push(record as Record<string, unknown>); } });
        const lease = broker.issueLease(broker.issueOwner(BINDING));
        await assert.rejects(broker.authorize(lease, current, claim),
            (error: unknown) => error instanceof Error && 'code' in error && error.code === expected);
        assert.equal(audit[0]?.denialCode, expected);
        await assert.rejects(broker.authorize(lease, CURRENT, CLAIM),
            (error: unknown) => error instanceof Error && 'code' in error && error.code === 'lease_revoked');
    }
});

test('rifiuta reference host duplicate prima di creare una lease', () => {
    const broker = createAipOwnerBrokerV1({ now: () => 1_000, nextRef: () => 'reference.synthetic.duplicate',
        hashRef: () => DIGEST, writeAudit: async () => undefined });
    const owner = broker.issueOwner(BINDING);
    assert.throws(() => broker.issueLease(owner),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'reference_invalid');
});

test('un clock host non monotono revoca la lease senza emettere un permit', async () => {
    const times = [1_000, 999, 1_000];
    const refs = ['agent.synthetic.clock', 'lease.synthetic.clock'];
    const broker = createAipOwnerBrokerV1({ now: () => times.shift(), nextRef: () => refs.shift(),
        hashRef: () => DIGEST, writeAudit: async () => undefined });
    const lease = broker.issueLease(broker.issueOwner(BINDING));
    await assert.rejects(broker.authorize(lease, CURRENT, CLAIM),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'clock_invalid');
    await assert.rejects(broker.authorize(lease, CURRENT, CLAIM),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'lease_revoked');
});

test('non richiede nuova entropy dopo avere registrato una authorization allowed', async () => {
    const refs = ['agent.synthetic.commit', 'lease.synthetic.commit'];
    const audit: unknown[] = [];
    const broker = createAipOwnerBrokerV1({ now: () => 1_000,
        nextRef: () => { const value = refs.shift(); if (!value) throw new Error('post-audit entropy'); return value; },
        hashRef: () => DIGEST, writeAudit: async (record: unknown) => { audit.push(record); } });
    const lease = broker.issueLease(broker.issueOwner(BINDING));
    const permit = await broker.authorize(lease, CURRENT, CLAIM);
    assert.deepEqual(Reflect.ownKeys(permit), []);
    assert.equal((audit[0] as Record<string, unknown>)?.outcome, 'allowed');
});
