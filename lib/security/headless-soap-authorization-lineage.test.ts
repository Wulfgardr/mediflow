/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createHeadlessSoapAuthorizationLineage,
    HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST,
    HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST_HEX,
    sameHeadlessSoapAuthorizationLineage,
} from './headless-soap-authorization-lineage.ts';

function record<T extends object>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
}

function identity(): Readonly<Record<never, never>> {
    return Object.freeze(Object.create(null)) as Readonly<Record<never, never>>;
}

function digest(codec: string, hex: string) {
    const bytes = Object.freeze(Array.from({ length: 32 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)));
    return record({ codec, sha256: record({ bytes, hex }) });
}

const ids = Object.freeze({
    generation: identity(), grant: identity(), parent: identity(), child: identity(), lease: identity(),
    scope: identity(), proposal: identity(), entry: identity(),
});

function candidate(overrides: Readonly<Record<string, unknown>> = {}) {
    const payloadHex = '2a'.repeat(32), sealHex = '3b'.repeat(32);
    return record({
        schema: 'mediflow.headless.soap-authorization-lineage.v1',
        operationId: 'mediflow.clinical_diary.append_soap.v1',
        webSession: record({
            id: '1'.repeat(64), userId: 'synthetic-clinician', username: 'synthetic.clinician', role: 'admin',
            authChannel: 'web', createdAt: 1_000, expiresAt: 100_000,
        }),
        activeRole: record({
            grantIdentity: ids.grant, principalRef: 'synthetic-clinician', authenticationGeneration: ids.generation,
            actorRef: 'synthetic-clinician', attestationRef: `hsar_${'a'.repeat(32)}`, attestationVersion: 1,
            revocationGeneration: 0, policyVersion: 'clinician_confirmed_single_use.v1',
        }),
        childLease: record({
            parent: record({ identity: ids.parent, contractVersion: 1, generation: 1, revocationGeneration: 0 }),
            child: record({ identity: ids.child, contractVersion: 1, generation: 1, revocationGeneration: 0,
                proposalBudget: 0, expiresAt: 90_000 }),
            lease: record({ identity: ids.lease, contractVersion: 1, generation: 1, revocationGeneration: 0 }),
        }),
        selection: record({
            scopeIdentity: ids.scope, sessionRef: `ssr_${'b'.repeat(32)}`, patientRef: `ptr_${'c'.repeat(32)}`,
            ambulatoryRef: `abr_${'d'.repeat(32)}`, leaseRef: `lsr_${'e'.repeat(32)}`,
            selectionEpoch: 7, expiresAt: 80_000,
        }),
        patientVersion: 4,
        action: 'append',
        purpose: 'clinician_requested_documentation',
        proposal: record({ proposalIdentity: ids.proposal, revision: 1, expiresAt: 70_000 }),
        entryIdentity: ids.entry,
        payloadDigest: digest('mediflow.headless.soap-entry-payload-digest.v1', payloadHex),
        sealDigest: digest('mediflow.headless.soap-entry-seal-digest.v1', sealHex),
        policyDigest: HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST,
        ...overrides,
    });
}

test('materializes the exact frozen H6 lineage and fixed policy golden', () => {
    assert.equal(HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST_HEX,
        '1175ad0f063ac03d73f71afce252a7922e359882c9c1f7313a5cbc445e3a5f17');
    assert.equal(HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST.sha256.hex,
        HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST_HEX);
    const lineage = createHeadlessSoapAuthorizationLineage(candidate());
    assert.ok(lineage);
    assert.deepEqual(Reflect.ownKeys(lineage), [
        'schema', 'operationId', 'webSession', 'activeRole', 'childLease', 'selection', 'patientVersion',
        'action', 'purpose', 'proposal', 'entryIdentity', 'payloadDigest', 'sealDigest', 'policyDigest',
    ]);
    assert.equal(Object.getPrototypeOf(lineage), null);
    assert.equal(Object.isFrozen(lineage), true);
    assert.notEqual(lineage, candidate());
    assert.equal(lineage.activeRole.grantIdentity, ids.grant);
    assert.equal(lineage.activeRole.authenticationGeneration, ids.generation);
    assert.equal(lineage.childLease.parent.identity, ids.parent);
    assert.equal(lineage.childLease.child.identity, ids.child);
    assert.equal(lineage.childLease.lease.identity, ids.lease);
    assert.equal(lineage.selection.scopeIdentity, ids.scope);
    assert.equal(lineage.proposal.proposalIdentity, ids.proposal);
    assert.equal(lineage.entryIdentity, ids.entry);
    for (const nested of [lineage.webSession, lineage.activeRole, lineage.childLease, lineage.childLease.parent,
        lineage.childLease.child, lineage.childLease.lease, lineage.selection, lineage.proposal,
        lineage.payloadDigest, lineage.payloadDigest.sha256, lineage.sealDigest, lineage.sealDigest.sha256,
        lineage.policyDigest, lineage.policyDigest.sha256]) {
        assert.equal(Object.getPrototypeOf(nested), null);
        assert.equal(Object.isFrozen(nested), true);
    }
});

test('copies value records but preserves only the intended opaque identities', () => {
    const source = candidate();
    const first = createHeadlessSoapAuthorizationLineage(source);
    const second = createHeadlessSoapAuthorizationLineage(source);
    assert.ok(first && second);
    assert.notEqual(first, second);
    assert.notEqual(first.webSession, source.webSession);
    assert.notEqual(first.childLease, source.childLease);
    assert.notEqual(first.payloadDigest, source.payloadDigest);
    assert.equal(first.entryIdentity, second.entryIdentity);
    assert.equal(sameHeadlessSoapAuthorizationLineage(first, second), true);
});

test('rejects malformed shape, authority drift, non-current versions, and policy drift', () => {
    const cases: unknown[] = [
        { ...candidate() },
        record({ ...candidate(), extra: true }),
        record({ ...candidate(), patientVersion: 0 }),
        record({ ...candidate(), activeRole: record({ ...candidate().activeRole, principalRef: 'other' }) }),
        record({ ...candidate(), activeRole: record({ ...candidate().activeRole, revocationGeneration: 1 }) }),
        record({ ...candidate(), childLease: record({ ...candidate().childLease,
            child: record({ ...candidate().childLease.child, proposalBudget: 1 }) }) }),
        record({ ...candidate(), proposal: record({ ...candidate().proposal, revision: 2 }) }),
        record({ ...candidate(), policyDigest: digest('mediflow.headless.soap-authorization-policy-digest.v1', 'ff'.repeat(32)) }),
        new Proxy(candidate(), {}),
    ];
    for (const value of cases) assert.equal(createHeadlessSoapAuthorizationLineage(value), null);
});

test('compares every scalar, digest, and process identity without adopting equivalents', () => {
    const baseline = createHeadlessSoapAuthorizationLineage(candidate());
    assert.ok(baseline);
    const drifts = [
        candidate({ patientVersion: 5 }),
        candidate({ entryIdentity: identity() }),
        candidate({ activeRole: record({ ...candidate().activeRole, authenticationGeneration: identity() }) }),
        candidate({ childLease: record({ ...candidate().childLease,
            lease: record({ ...candidate().childLease.lease, identity: identity() }) }) }),
        candidate({ selection: record({ ...candidate().selection, selectionEpoch: 8 }) }),
        candidate({ proposal: record({ ...candidate().proposal, proposalIdentity: identity() }) }),
        candidate({ sealDigest: digest('mediflow.headless.soap-entry-seal-digest.v1', '4c'.repeat(32)) }),
    ];
    for (const drift of drifts) {
        const parsed = createHeadlessSoapAuthorizationLineage(drift);
        assert.ok(parsed);
        assert.equal(sameHeadlessSoapAuthorizationLineage(baseline, parsed), false);
    }
    assert.equal(sameHeadlessSoapAuthorizationLineage(baseline, candidate()), false);
});
