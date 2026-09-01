/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createHeadlessSoapAuthorizationProofToken } from './headless-soap-authorization-proof-token.ts';
import {
    createHeadlessSoapAuthorizationLineage,
    HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST,
} from './headless-soap-authorization-lineage.ts';
import {
    createHeadlessSoapCommandBindingOwner,
    HeadlessSoapCommandBindingError,
} from './headless-soap-command-binding-lifecycle.ts';

const record = <T extends object>(value: T): Readonly<T> =>
    Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
const opaque = () => Object.freeze(Object.create(null)) as Readonly<Record<never, never>>;
const hash = (codec: string, byte: number) => record({ codec, sha256: record({
    bytes: Object.freeze(Array(32).fill(byte)), hex: byte.toString(16).padStart(2, '0').repeat(32),
}) });
const encrypted = (byte: number) => `ENC:${Buffer.alloc(12, byte).toString('base64')}:${Buffer.alloc(16, byte).toString('base64')}`;

function binding() {
    const identities = { generation: opaque(), grant: opaque(), parent: opaque(), child: opaque(), lease: opaque(),
        scope: opaque(), proposal: opaque(), entry: opaque() };
    const payloadDigest = hash('mediflow.headless.soap-entry-payload-digest.v1', 0x2a);
    const sealDigest = hash('mediflow.headless.soap-entry-seal-digest.v1', 0x3b);
    const lineage = createHeadlessSoapAuthorizationLineage(record({
        schema: 'mediflow.headless.soap-authorization-lineage.v1', operationId: 'mediflow.clinical_diary.append_soap.v1',
        webSession: record({ id: '1'.repeat(64), userId: 'synthetic-clinician', username: 'synthetic.clinician',
            role: 'admin', authChannel: 'web', createdAt: 1, expiresAt: 100_000 }),
        activeRole: record({ grantIdentity: identities.grant, principalRef: 'synthetic-clinician',
            authenticationGeneration: identities.generation, actorRef: 'synthetic-clinician',
            attestationRef: `hsar_${'a'.repeat(32)}`, attestationVersion: 1, revocationGeneration: 0,
            policyVersion: 'clinician_confirmed_single_use.v1' }),
        childLease: record({ parent: record({ identity: identities.parent, contractVersion: 1, generation: 1, revocationGeneration: 0 }),
            child: record({ identity: identities.child, contractVersion: 1, generation: 1, revocationGeneration: 0,
                proposalBudget: 0, expiresAt: 90_000 }),
            lease: record({ identity: identities.lease, contractVersion: 1, generation: 1, revocationGeneration: 0 }) }),
        selection: record({ scopeIdentity: identities.scope, sessionRef: `ssr_${'b'.repeat(32)}`,
            patientRef: `ptr_${'c'.repeat(32)}`, ambulatoryRef: `abr_${'d'.repeat(32)}`,
            leaseRef: `lsr_${'e'.repeat(32)}`, selectionEpoch: 1, expiresAt: 80_000 }),
        patientVersion: 1, action: 'append', purpose: 'clinician_requested_documentation',
        proposal: record({ proposalIdentity: identities.proposal, revision: 1, expiresAt: 70_000 }),
        entryIdentity: identities.entry, payloadDigest, sealDigest, policyDigest: HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST,
    }));
    assert.ok(lineage);
    const sealBundle = record({ schema: 'mediflow.headless.soap-entry-seal.v1', type: 'visit',
        date: '2026-09-01T10:00:00.000Z', setting: 'ambulatory', title: encrypted(1), content: encrypted(2),
        metadata: encrypted(3), payloadDigest, sealDigest });
    return { lineage, sealBundle };
}

function fixture(entropyByte = 0x44) {
    const trace: string[] = [], registrations = new Map<string, { registration: object; dispose: () => void }>();
    const current = binding(); let entropyCalls = 0, wipes = 0;
    const owner = createHeadlessSoapCommandBindingOwner({
        proofLifecycle: {
            registerDependent(proof: unknown, dispose: () => void) { trace.push('register'); const registration = opaque();
                registrations.set(String(proof), { registration, dispose }); return registration; },
            confirmDependent(proof: unknown, registration: unknown) { trace.push('confirm');
                return registrations.get(String(proof))?.registration === registration; },
            unregisterDependent(proof: unknown, registration: unknown) { trace.push('unregister');
                return registrations.get(String(proof))?.registration === registration && registrations.delete(String(proof)); },
        },
        proofBinding: {
            async withCurrentDependentBinding(proof: unknown, registration: unknown,
                operation: (lineage: unknown, sealBundle: unknown) => void) {
                trace.push('current'); if (registrations.get(String(proof))?.registration !== registration) return false;
                operation(current.lineage, current.sealBundle); return true;
            },
        },
        proofService: { wipe(proof: unknown) { trace.push('wipe-proof'); wipes += 1; return registrations.delete(String(proof)); } },
        entropy() { trace.push(`entropy-${++entropyCalls}`); return new Uint8Array(32).fill(entropyByte); },
    });
    return { owner, trace, current, wipes: () => wipes,
        drain(proof: string) { registrations.get(proof)?.dispose(); registrations.delete(proof); } };
}

function proof(byte: number): string {
    const minted = createHeadlessSoapAuthorizationProofToken(new Uint8Array(32).fill(byte));
    assert.ok(minted); return minted.authorizationProof;
}

test('binds one current H5b dependent and publishes only approvalRef plus idempotencyKey', async () => {
    const current = fixture(), authorizationProof = proof(1);
    const result = await current.owner.service.bind(authorizationProof);
    assert.deepEqual(Reflect.ownKeys(result), ['status', 'approvalRef', 'idempotencyKey']);
    assert.equal(Object.getPrototypeOf(result), null); assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(result, record({ status: 'approval_bound', approvalRef: `hsaa_${'44'.repeat(32)}`,
        idempotencyKey: `hsai_${'44'.repeat(32)}` }));
    assert.deepEqual(current.trace, ['register', 'confirm', 'current', 'entropy-1', 'entropy-2', 'entropy-3', 'confirm']);
    assert.equal(current.owner.service.wipe(result.approvalRef, proof(9)), false);
    assert.equal(current.owner.service.wipe(result.approvalRef, authorizationProof), true);
    assert.equal(current.owner.service.wipe(result.approvalRef, authorizationProof), false);
    assert.equal(current.wipes(), 1);
});

test('keeps malformed proofs inert and burns an attached proof on identifier collision', async () => {
    const current = fixture();
    await assert.rejects(current.owner.service.bind('not-a-proof'),
        (error) => error instanceof HeadlessSoapCommandBindingError && error.code === 'proof_unavailable');
    assert.deepEqual(current.trace, []);
    const firstProof = proof(1), first = await current.owner.service.bind(firstProof);
    const secondProof = proof(2);
    await assert.rejects(current.owner.service.bind(secondProof),
        (error) => error instanceof HeadlessSoapCommandBindingError && error.code === 'lifecycle_unavailable');
    assert.equal(current.wipes(), 1);
    assert.equal(current.owner.service.wipe(first.approvalRef, firstProof), true);
});

test('retires a published binding once when H5b drains it upstream', async () => {
    const current = fixture(), authorizationProof = proof(3);
    const result = await current.owner.service.bind(authorizationProof);
    current.drain(authorizationProof);
    assert.equal(current.owner.service.wipe(result.approvalRef, authorizationProof), false);
    assert.equal(current.wipes(), 0);
});
