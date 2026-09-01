/* @Codex */
import assert from 'node:assert/strict';

import { createHeadlessSoapAuthorizationProofToken } from './headless-soap-authorization-proof-token';
import { createHeadlessSoapAuthorizationLineage,
    HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST } from './headless-soap-authorization-lineage';
import { createHeadlessSoapCommandBindingOwner } from './headless-soap-command-binding-lifecycle';

export const syntheticRecord = <T extends object>(value: T): Readonly<T> =>
    Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
const opaque = () => Object.freeze(Object.create(null)) as Readonly<Record<never, never>>;
const hash = (codec: string, byte: number) => syntheticRecord({ codec, sha256: syntheticRecord({
    bytes: Object.freeze(Array(32).fill(byte)), hex: byte.toString(16).padStart(2, '0').repeat(32),
}) });
const encrypted = (byte: number) => `ENC:${Buffer.alloc(12, byte).toString('base64')}:${Buffer.alloc(16, byte).toString('base64')}`;

export function syntheticBinding(patientVersion = 1) {
    const ids = { generation: opaque(), grant: opaque(), parent: opaque(), child: opaque(), lease: opaque(),
        scope: opaque(), proposal: opaque(), entry: opaque() };
    const payloadDigest = hash('mediflow.headless.soap-entry-payload-digest.v1', 0x2a);
    const sealDigest = hash('mediflow.headless.soap-entry-seal-digest.v1', 0x3b);
    const lineage = createHeadlessSoapAuthorizationLineage(syntheticRecord({
        schema: 'mediflow.headless.soap-authorization-lineage.v1', operationId: 'mediflow.clinical_diary.append_soap.v1',
        webSession: syntheticRecord({ id: '1'.repeat(64), userId: 'synthetic-clinician', username: 'synthetic.clinician',
            role: 'admin', authChannel: 'web', createdAt: 1, expiresAt: 100_000 }),
        activeRole: syntheticRecord({ grantIdentity: ids.grant, principalRef: 'synthetic-clinician',
            authenticationGeneration: ids.generation, actorRef: 'synthetic-clinician',
            attestationRef: `hsar_${'a'.repeat(32)}`, attestationVersion: 1, revocationGeneration: 0,
            policyVersion: 'clinician_confirmed_single_use.v1' }),
        childLease: syntheticRecord({
            parent: syntheticRecord({ identity: ids.parent, contractVersion: 1, generation: 1, revocationGeneration: 0 }),
            child: syntheticRecord({ identity: ids.child, contractVersion: 1, generation: 1, revocationGeneration: 0,
                proposalBudget: 0, expiresAt: 90_000 }),
            lease: syntheticRecord({ identity: ids.lease, contractVersion: 1, generation: 1, revocationGeneration: 0 }),
        }),
        selection: syntheticRecord({ scopeIdentity: ids.scope, sessionRef: `ssr_${'b'.repeat(32)}`,
            patientRef: `ptr_${'c'.repeat(32)}`, ambulatoryRef: `abr_${'d'.repeat(32)}`,
            leaseRef: `lsr_${'e'.repeat(32)}`, selectionEpoch: 1, expiresAt: 80_000 }),
        patientVersion, action: 'append', purpose: 'clinician_requested_documentation',
        proposal: syntheticRecord({ proposalIdentity: ids.proposal, revision: 1, expiresAt: 70_000 }),
        entryIdentity: ids.entry, payloadDigest, sealDigest, policyDigest: HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST,
    }));
    assert.ok(lineage);
    const sealBundle = syntheticRecord({ schema: 'mediflow.headless.soap-entry-seal.v1', type: 'visit',
        date: '2026-09-01T10:00:00.000Z', setting: 'ambulatory', title: encrypted(1), content: encrypted(2),
        metadata: encrypted(3), payloadDigest, sealDigest });
    return { lineage, sealBundle };
}

export function syntheticProof(byte: number): string {
    const minted = createHeadlessSoapAuthorizationProofToken(new Uint8Array(32).fill(byte));
    assert.ok(minted); return minted.authorizationProof;
}

export function commandBindingFixture(entropyByte = 0x44) {
    const trace: string[] = [], registrations = new Map<string, { registration: object; dispose: () => void }>();
    let current = syntheticBinding(), entropyCalls = 0, wipes = 0, currentFailure: unknown = null;
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
                if (currentFailure) throw currentFailure;
                operation(current.lineage, current.sealBundle); return true;
            },
            async withSingleUseDependentBinding(proof: unknown, registration: unknown,
                operation: (lineage: unknown, sealBundle: unknown) => void) {
                trace.push('single-use'); const dependent = registrations.get(String(proof));
                if (!dependent || dependent.registration !== registration) return false;
                operation(current.lineage, current.sealBundle); dependent.dispose(); registrations.delete(String(proof)); return true;
            },
        },
        proofService: { wipe(proof: unknown) { trace.push('wipe-proof'); wipes += 1; return registrations.delete(String(proof)); } },
        entropy() { trace.push(`entropy-${++entropyCalls}`); return new Uint8Array(32).fill(entropyByte); },
    });
    return { owner, trace, current: () => current, setCurrent(next: ReturnType<typeof syntheticBinding>) { current = next; },
        failCurrent(error: unknown) { currentFailure = error; },
        wipes: () => wipes, drain(proof: string) { registrations.get(proof)?.dispose(); registrations.delete(proof); } };
}
