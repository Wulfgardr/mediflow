/* @Codex */
import 'server-only';

import { types } from 'node:util';

export const HEADLESS_SOAP_AUTHORIZATION_LINEAGE_SCHEMA =
    'mediflow.headless.soap-authorization-lineage.v1' as const;
export const HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST_CODEC =
    'mediflow.headless.soap-authorization-policy-digest.v1' as const;
export const HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST_HEX =
    '1175ad0f063ac03d73f71afce252a7922e359882c9c1f7313a5cbc445e3a5f17' as const;

const OPERATION_ID = 'mediflow.clinical_diary.append_soap.v1' as const;
const ACTION = 'append' as const;
const PURPOSE = 'clinician_requested_documentation' as const;
const POLICY_VERSION = 'clinician_confirmed_single_use.v1' as const;
const PAYLOAD_DIGEST_CODEC = 'mediflow.headless.soap-entry-payload-digest.v1' as const;
const SEAL_DIGEST_CODEC = 'mediflow.headless.soap-entry-seal-digest.v1' as const;
const TOP_KEYS = ['schema', 'operationId', 'webSession', 'activeRole', 'childLease', 'selection', 'patientVersion',
    'action', 'purpose', 'proposal', 'entryIdentity', 'payloadDigest', 'sealDigest', 'policyDigest'] as const;
const SESSION_KEYS = ['id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt'] as const;
const ACTIVE_ROLE_KEYS = ['grantIdentity', 'principalRef', 'authenticationGeneration', 'actorRef', 'attestationRef',
    'attestationVersion', 'revocationGeneration', 'policyVersion'] as const;
const CHILD_LEASE_KEYS = ['parent', 'child', 'lease'] as const;
const GENERATION_KEYS = ['identity', 'contractVersion', 'generation', 'revocationGeneration'] as const;
const CHILD_KEYS = ['identity', 'contractVersion', 'generation', 'revocationGeneration', 'proposalBudget', 'expiresAt'] as const;
const SELECTION_KEYS = ['scopeIdentity', 'sessionRef', 'patientRef', 'ambulatoryRef', 'leaseRef', 'selectionEpoch', 'expiresAt'] as const;
const PROPOSAL_KEYS = ['proposalIdentity', 'revision', 'expiresAt'] as const;
const DIGEST_KEYS = ['codec', 'sha256'] as const;
const SHA_KEYS = ['bytes', 'hex'] as const;
const SESSION_ID = /^[0-9a-f]{64}$/u;
const ATTESTATION_REF = /^hsar_[0-9a-f]{32}$/u;
const SESSION_REF = /^ssr_[0-9a-f]{32}$/u;
const PATIENT_REF = /^ptr_[0-9a-f]{32}$/u;
const AMBULATORY_REF = /^abr_[0-9a-f]{32}$/u;
const LEASE_REF = /^lsr_[0-9a-f]{32}$/u;
const HEX = /^[0-9a-f]{64}$/u;

type Identity = Readonly<Record<never, never>>;
type Digest<Codec extends string> = Readonly<{
    codec: Codec;
    sha256: Readonly<{ bytes: readonly number[]; hex: string }>;
}>;
export type HeadlessSoapAuthorizationLineageV1 = Readonly<{
    schema: typeof HEADLESS_SOAP_AUTHORIZATION_LINEAGE_SCHEMA;
    operationId: typeof OPERATION_ID;
    webSession: Readonly<{ id: string; userId: string; username: string; role: 'admin'; authChannel: 'web';
        createdAt: number; expiresAt: number }>;
    activeRole: Readonly<{ grantIdentity: Identity; principalRef: string; authenticationGeneration: Identity;
        actorRef: string; attestationRef: string; attestationVersion: 1; revocationGeneration: 0;
        policyVersion: typeof POLICY_VERSION }>;
    childLease: Readonly<{
        parent: Readonly<{ identity: Identity; contractVersion: 1; generation: 1; revocationGeneration: 0 }>;
        child: Readonly<{ identity: Identity; contractVersion: 1; generation: 1; revocationGeneration: 0;
            proposalBudget: 0; expiresAt: number }>;
        lease: Readonly<{ identity: Identity; contractVersion: 1; generation: 1; revocationGeneration: 0 }>;
    }>;
    selection: Readonly<{ scopeIdentity: Identity; sessionRef: string; patientRef: string; ambulatoryRef: string;
        leaseRef: string; selectionEpoch: number; expiresAt: number }>;
    patientVersion: number;
    action: typeof ACTION;
    purpose: typeof PURPOSE;
    proposal: Readonly<{ proposalIdentity: Identity; revision: 1; expiresAt: number }>;
    entryIdentity: Identity;
    payloadDigest: Digest<typeof PAYLOAD_DIGEST_CODEC>;
    sealDigest: Digest<typeof SEAL_DIGEST_CODEC>;
    policyDigest: Digest<typeof HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST_CODEC>;
}>;

const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectIsFrozen = Object.isFrozen;
const reflectOwnKeys = Reflect.ownKeys;
const regexpTest = RegExp.prototype.test;
const reflectApply = Reflect.apply;
const numberIsSafeInteger = Number.isSafeInteger;
const isProxy = types.isProxy;
const issued = new WeakSet<object>();

function record<T extends object>(source: T): Readonly<T> {
    const output = objectCreate(null) as Record<PropertyKey, unknown>;
    for (const key of reflectOwnKeys(source)) output[key] = (source as Record<PropertyKey, unknown>)[key];
    return objectFreeze(output) as Readonly<T>;
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || isProxy(value)
            || objectGetPrototypeOf(value) !== null || !objectIsFrozen(value)) return null;
        const ownKeys = reflectOwnKeys(value);
        if (ownKeys.length !== keys.length) return null;
        const output = objectCreate(null) as Record<string, unknown>;
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index]!;
            if (ownKeys[index] !== key) return null;
            const descriptor = objectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)
                || descriptor.configurable || descriptor.writable) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch {
        return null;
    }
}

function identity(value: unknown): value is Identity {
    try {
        return typeof value === 'object' && value !== null && !isProxy(value)
            && objectGetPrototypeOf(value) === null && objectIsFrozen(value) && reflectOwnKeys(value).length === 0;
    } catch {
        return false;
    }
}

function safeInteger(value: unknown, minimum = 0): value is number {
    return numberIsSafeInteger(value) && (value as number) >= minimum;
}

function text(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;
}

function pattern(value: unknown, expression: RegExp): value is string {
    try { return typeof value === 'string' && reflectApply(regexpTest, expression, [value]); }
    catch { return false; }
}

function digest<Codec extends string>(value: unknown, codec: Codec): Digest<Codec> | null {
    const outer = exact(value, DIGEST_KEYS);
    const sha = outer && exact(outer.sha256, SHA_KEYS);
    if (!outer || !sha || outer.codec !== codec || !pattern(sha.hex, HEX)
        || !Array.isArray(sha.bytes) || !objectIsFrozen(sha.bytes) || sha.bytes.length !== 32) return null;
    const bytes: number[] = [];
    let hex = '';
    try {
        const keys = reflectOwnKeys(sha.bytes);
        if (keys.length !== 33 || keys[32] !== 'length') return null;
        for (let index = 0; index < 32; index += 1) {
            if (keys[index] !== String(index)) return null;
            const descriptor = objectGetOwnPropertyDescriptor(sha.bytes, String(index));
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)
                || descriptor.configurable || descriptor.writable || !safeInteger(descriptor.value)
                || (descriptor.value as number) > 255) return null;
            bytes.push(descriptor.value as number);
            hex += (descriptor.value as number).toString(16).padStart(2, '0');
        }
    } catch { return null; }
    if (hex !== sha.hex) return null;
    return record({ codec, sha256: record({ bytes: objectFreeze(bytes), hex }) }) as Digest<Codec>;
}

const policyBytes = objectFreeze(Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST_HEX.slice(index * 2, index * 2 + 2), 16)));
export const HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST = record({
    codec: HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST_CODEC,
    sha256: record({ bytes: policyBytes, hex: HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST_HEX }),
});

/** Copies and validates one complete memory-only H6 lineage capsule. */
export function createHeadlessSoapAuthorizationLineage(value: unknown): HeadlessSoapAuthorizationLineageV1 | null {
    const source = exact(value, TOP_KEYS);
    if (!source || source.schema !== HEADLESS_SOAP_AUTHORIZATION_LINEAGE_SCHEMA || source.operationId !== OPERATION_ID
        || source.action !== ACTION || source.purpose !== PURPOSE || !safeInteger(source.patientVersion, 1)
        || !identity(source.entryIdentity)) return null;
    const web = exact(source.webSession, SESSION_KEYS);
    if (!web || !pattern(web.id, SESSION_ID) || !text(web.userId) || !text(web.username) || web.role !== 'admin'
        || web.authChannel !== 'web' || !safeInteger(web.createdAt) || !safeInteger(web.expiresAt)
        || (web.createdAt as number) >= (web.expiresAt as number)) return null;
    const active = exact(source.activeRole, ACTIVE_ROLE_KEYS);
    if (!active || !identity(active.grantIdentity) || !identity(active.authenticationGeneration)
        || !text(active.principalRef) || active.principalRef !== web.userId || !text(active.actorRef)
        || active.actorRef !== web.userId || !pattern(active.attestationRef, ATTESTATION_REF)
        || active.attestationVersion !== 1 || active.revocationGeneration !== 0
        || active.policyVersion !== POLICY_VERSION) return null;
    const childLease = exact(source.childLease, CHILD_LEASE_KEYS);
    const parent = childLease && exact(childLease.parent, GENERATION_KEYS);
    const child = childLease && exact(childLease.child, CHILD_KEYS);
    const lease = childLease && exact(childLease.lease, GENERATION_KEYS);
    const currentGeneration = (item: Record<string, unknown> | null): item is Record<string, unknown> => !!item
        && identity(item.identity) && item.contractVersion === 1 && item.generation === 1 && item.revocationGeneration === 0;
    if (!currentGeneration(parent) || !currentGeneration(child) || !currentGeneration(lease)
        || child.proposalBudget !== 0 || !safeInteger(child.expiresAt)) return null;
    const selection = exact(source.selection, SELECTION_KEYS);
    if (!selection || !identity(selection.scopeIdentity) || !pattern(selection.sessionRef, SESSION_REF)
        || !pattern(selection.patientRef, PATIENT_REF) || !pattern(selection.ambulatoryRef, AMBULATORY_REF)
        || !pattern(selection.leaseRef, LEASE_REF) || !safeInteger(selection.selectionEpoch, 1)
        || !safeInteger(selection.expiresAt)) return null;
    const proposal = exact(source.proposal, PROPOSAL_KEYS);
    if (!proposal || !identity(proposal.proposalIdentity) || proposal.revision !== 1
        || !safeInteger(proposal.expiresAt)) return null;
    const payload = digest(source.payloadDigest, PAYLOAD_DIGEST_CODEC);
    const seal = digest(source.sealDigest, SEAL_DIGEST_CODEC);
    const policy = digest(source.policyDigest, HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST_CODEC);
    if (!payload || !seal || !policy || policy.sha256.hex !== HEADLESS_SOAP_AUTHORIZATION_POLICY_DIGEST_HEX) return null;
    const output = record({
        schema: HEADLESS_SOAP_AUTHORIZATION_LINEAGE_SCHEMA,
        operationId: OPERATION_ID,
        webSession: record({ id: web.id as string, userId: web.userId as string, username: web.username as string,
            role: 'admin' as const, authChannel: 'web' as const, createdAt: web.createdAt as number,
            expiresAt: web.expiresAt as number }),
        activeRole: record({ grantIdentity: active.grantIdentity as Identity, principalRef: active.principalRef as string,
            authenticationGeneration: active.authenticationGeneration as Identity, actorRef: active.actorRef as string,
            attestationRef: active.attestationRef as string, attestationVersion: 1 as const, revocationGeneration: 0 as const,
            policyVersion: POLICY_VERSION }),
        childLease: record({
            parent: record({ identity: parent.identity as Identity, contractVersion: 1 as const,
                generation: 1 as const, revocationGeneration: 0 as const }),
            child: record({ identity: child.identity as Identity, contractVersion: 1 as const,
                generation: 1 as const, revocationGeneration: 0 as const, proposalBudget: 0 as const,
                expiresAt: child.expiresAt as number }),
            lease: record({ identity: lease.identity as Identity, contractVersion: 1 as const,
                generation: 1 as const, revocationGeneration: 0 as const }),
        }),
        selection: record({ scopeIdentity: selection.scopeIdentity as Identity, sessionRef: selection.sessionRef as string,
            patientRef: selection.patientRef as string, ambulatoryRef: selection.ambulatoryRef as string,
            leaseRef: selection.leaseRef as string, selectionEpoch: selection.selectionEpoch as number,
            expiresAt: selection.expiresAt as number }),
        patientVersion: source.patientVersion as number,
        action: ACTION,
        purpose: PURPOSE,
        proposal: record({ proposalIdentity: proposal.proposalIdentity as Identity, revision: 1 as const,
            expiresAt: proposal.expiresAt as number }),
        entryIdentity: source.entryIdentity as Identity,
        payloadDigest: payload,
        sealDigest: seal,
        policyDigest: policy,
    }) as HeadlessSoapAuthorizationLineageV1;
    issued.add(output);
    return output;
}

function sameDigest(left: Digest<string>, right: Digest<string>): boolean {
    if (left.codec !== right.codec || left.sha256.hex !== right.sha256.hex) return false;
    let difference = 0;
    for (let index = 0; index < 32; index += 1) difference |= left.sha256.bytes[index]! ^ right.sha256.bytes[index]!;
    return difference === 0;
}

/** Compares two owner-issued lineages without adopting value-equivalent identities. */
export function sameHeadlessSoapAuthorizationLineage(left: unknown, right: unknown): boolean {
    if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null
        || !issued.has(left) || !issued.has(right)) return false;
    const a = left as HeadlessSoapAuthorizationLineageV1;
    const b = right as HeadlessSoapAuthorizationLineageV1;
    for (const key of SESSION_KEYS) if (a.webSession[key] !== b.webSession[key]) return false;
    if (a.activeRole.grantIdentity !== b.activeRole.grantIdentity
        || a.activeRole.principalRef !== b.activeRole.principalRef
        || a.activeRole.authenticationGeneration !== b.activeRole.authenticationGeneration
        || a.activeRole.actorRef !== b.activeRole.actorRef || a.activeRole.attestationRef !== b.activeRole.attestationRef
        || a.activeRole.attestationVersion !== b.activeRole.attestationVersion
        || a.activeRole.revocationGeneration !== b.activeRole.revocationGeneration
        || a.activeRole.policyVersion !== b.activeRole.policyVersion) return false;
    for (const key of ['parent', 'child', 'lease'] as const) {
        const x = a.childLease[key], y = b.childLease[key];
        if (x.identity !== y.identity || x.contractVersion !== y.contractVersion || x.generation !== y.generation
            || x.revocationGeneration !== y.revocationGeneration) return false;
    }
    if (a.childLease.child.proposalBudget !== b.childLease.child.proposalBudget
        || a.childLease.child.expiresAt !== b.childLease.child.expiresAt
        || a.selection.scopeIdentity !== b.selection.scopeIdentity || a.selection.sessionRef !== b.selection.sessionRef
        || a.selection.patientRef !== b.selection.patientRef || a.selection.ambulatoryRef !== b.selection.ambulatoryRef
        || a.selection.leaseRef !== b.selection.leaseRef || a.selection.selectionEpoch !== b.selection.selectionEpoch
        || a.selection.expiresAt !== b.selection.expiresAt || a.patientVersion !== b.patientVersion
        || a.proposal.proposalIdentity !== b.proposal.proposalIdentity || a.proposal.revision !== b.proposal.revision
        || a.proposal.expiresAt !== b.proposal.expiresAt || a.entryIdentity !== b.entryIdentity) return false;
    return sameDigest(a.payloadDigest, b.payloadDigest) && sameDigest(a.sealDigest, b.sealDigest)
        && sameDigest(a.policyDigest, b.policyDigest);
}
