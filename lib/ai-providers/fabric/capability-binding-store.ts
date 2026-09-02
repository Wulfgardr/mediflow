/* @Codex */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { types } from 'node:util';
import { getDataDir } from '../../data-dir';

export const GUIDED_FABRIC_CAPABILITIES = Object.freeze([
    'ocr', 'patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning',
] as const);
export type GuidedFabricCapability = typeof GUIDED_FABRIC_CAPABILITIES[number];
export const FABRIC_BINDING_CANDIDATE_SCHEMA_V1 = 'mediflow.ai.fabric-binding-candidate.v1' as const;
export const FABRIC_BINDING_STORE_SCHEMA_V1 = 'mediflow.ai.fabric-binding-store.v1' as const;
export const FABRIC_BINDING_TRANSITION_SCHEMA_V1 = 'mediflow.ai.fabric-binding-transition.v1' as const;

export type FabricBindingCandidateV1 = Readonly<{
    schemaVersion: typeof FABRIC_BINDING_CANDIDATE_SCHEMA_V1;
    capability: GuidedFabricCapability; profileId: string; provider: string; engine: string; runtimeRef: string;
    model: string; modelVersion: string; modelDigest: string; venue: 'local_process';
    credentialRef: string | null; egressProfileId: 'local_only'; dataPolicy: 'clinical_local_only';
    recipeId: string; readiness: 'synthetic_smoke_passed'; smokeReceiptRef: string;
    provenanceRef: string; fallback: 'none';
}>;
export type FabricCapabilityBindingV1 = Readonly<FabricBindingCandidateV1 & { activatedAt: string }>;
type Transition = Readonly<{
    schemaVersion: typeof FABRIC_BINDING_TRANSITION_SCHEMA_V1; kind: 'activation' | 'rollback';
    transitionRef: string; sourceTransitionRef: string | null; capability: GuidedFabricCapability;
    previousBinding: FabricCapabilityBindingV1 | null; currentBinding: FabricCapabilityBindingV1 | null;
    timestamp: string;
}>;
export type FabricBindingStoreStateV1 = Readonly<{
    schemaVersion: typeof FABRIC_BINDING_STORE_SCHEMA_V1; version: number;
    bindings: Readonly<Record<GuidedFabricCapability, FabricCapabilityBindingV1 | null>>;
    lastTransition: Transition | null;
}>;
export type FabricBindingTransitionReceiptV1 = Readonly<{
    schemaVersion: 'mediflow.ai.fabric-binding-transition-receipt.v1'; outcome: 'activated' | 'rolled_back';
    transitionRef: string; capability: GuidedFabricCapability; fromVersion: number; toVersion: number;
    previousBindingDigest: string | null; currentBindingDigest: string | null; timestamp: string;
}>;
export type FabricBindingStoreErrorCode = 'input_invalid' | 'corrupt' | 'unavailable' | 'busy'
    | 'version_conflict' | 'transition_conflict' | 'clock_invalid' | 'source_invalid';
export class FabricBindingStoreError extends Error {
    constructor(public readonly code: FabricBindingStoreErrorCode) {
        super(`Fabric binding store rejected: ${code}`); this.name = 'FabricBindingStoreError';
    }
}

const CANDIDATE_KEYS = ['schemaVersion', 'capability', 'profileId', 'provider', 'engine', 'runtimeRef', 'model', 'modelVersion',
    'modelDigest', 'venue', 'credentialRef', 'egressProfileId', 'dataPolicy', 'recipeId', 'readiness',
    'smokeReceiptRef', 'provenanceRef', 'fallback'] as const;
const BINDING_KEYS = [...CANDIDATE_KEYS, 'activatedAt'] as const;
const STATE_KEYS = ['schemaVersion', 'version', 'bindings', 'lastTransition'] as const;
const TRANSITION_KEYS = ['schemaVersion', 'kind', 'transitionRef', 'sourceTransitionRef', 'capability',
    'previousBinding', 'currentBinding', 'timestamp'] as const;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,127}$/u;
const REF = /^[a-z][a-z0-9._-]{15,127}$/u;
const TRANSITION_REF = /^fabric_transition_[0-9a-f]{32}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
type Sources = Readonly<{ now: () => unknown; entropy: () => unknown }>;

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)) {
        throw new FabricBindingStoreError('input_invalid');
    }
    let ownKeys: (string | symbol)[]; let descriptors: Record<string, PropertyDescriptor>; let prototype: object | null;
    try { ownKeys = Reflect.ownKeys(value); descriptors = Object.getOwnPropertyDescriptors(value);
        prototype = Object.getPrototypeOf(value); } catch { throw new FabricBindingStoreError('input_invalid'); }
    if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length
        || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
        throw new FabricBindingStoreError('input_invalid');
    }
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !('value' in descriptor)) throw new FabricBindingStoreError('input_invalid');
        output[key] = descriptor.value;
    }
    return output;
}
function iso(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try { return new Date(value).toISOString() === value; } catch { return false; }
}
function capability(value: unknown): value is GuidedFabricCapability {
    return typeof value === 'string' && (GUIDED_FABRIC_CAPABILITIES as readonly string[]).includes(value);
}
function snapshotCandidate(value: unknown): FabricBindingCandidateV1 {
    const input = exact(value, CANDIDATE_KEYS);
    if (input.schemaVersion !== FABRIC_BINDING_CANDIDATE_SCHEMA_V1 || !capability(input.capability)
        || ![input.profileId, input.provider, input.engine, input.runtimeRef, input.model, input.modelVersion, input.recipeId]
            .every((item) => typeof item === 'string' && TOKEN.test(item))
        || typeof input.modelDigest !== 'string' || !DIGEST.test(input.modelDigest)
        || input.venue !== 'local_process' || (input.credentialRef !== null
            && (typeof input.credentialRef !== 'string' || !REF.test(input.credentialRef)))
        || input.egressProfileId !== 'local_only' || input.dataPolicy !== 'clinical_local_only'
        || input.readiness !== 'synthetic_smoke_passed'
        || typeof input.smokeReceiptRef !== 'string' || !REF.test(input.smokeReceiptRef)
        || typeof input.provenanceRef !== 'string' || !REF.test(input.provenanceRef)
        || input.fallback !== 'none') throw new FabricBindingStoreError('input_invalid');
    return Object.freeze({ ...input }) as FabricBindingCandidateV1;
}
function snapshotBinding(value: unknown): FabricCapabilityBindingV1 {
    const input = exact(value, BINDING_KEYS); const candidate = snapshotCandidate(Object.fromEntries(
        CANDIDATE_KEYS.map((key) => [key, input[key]])));
    if (!iso(input.activatedAt)) throw new FabricBindingStoreError('input_invalid');
    return Object.freeze({ ...candidate, activatedAt: input.activatedAt });
}
function emptyBindings(): Record<GuidedFabricCapability, null> {
    return Object.fromEntries(GUIDED_FABRIC_CAPABILITIES.map((id) => [id, null])) as Record<GuidedFabricCapability, null>;
}
function snapshotState(value: unknown): FabricBindingStoreStateV1 {
    const input = exact(value, STATE_KEYS);
    if (input.schemaVersion !== FABRIC_BINDING_STORE_SCHEMA_V1 || !Number.isSafeInteger(input.version)
        || (input.version as number) < 0) throw new FabricBindingStoreError('corrupt');
    let rawBindings: Record<string, unknown>;
    try { rawBindings = exact(input.bindings, GUIDED_FABRIC_CAPABILITIES); }
    catch { throw new FabricBindingStoreError('corrupt'); }
    const bindings = Object.create(null) as Record<GuidedFabricCapability, FabricCapabilityBindingV1 | null>;
    try {
        for (const id of GUIDED_FABRIC_CAPABILITIES) {
            bindings[id] = rawBindings[id] === null ? null : snapshotBinding(rawBindings[id]);
            if (bindings[id] !== null && bindings[id]?.capability !== id) throw new Error();
        }
    } catch { throw new FabricBindingStoreError('corrupt'); }
    let lastTransition: Transition | null = null;
    if (input.lastTransition !== null) {
        try {
            const transition = exact(input.lastTransition, TRANSITION_KEYS);
            if (transition.schemaVersion !== FABRIC_BINDING_TRANSITION_SCHEMA_V1
                || (transition.kind !== 'activation' && transition.kind !== 'rollback')
                || typeof transition.transitionRef !== 'string' || !TRANSITION_REF.test(transition.transitionRef)
                || (transition.sourceTransitionRef !== null && (typeof transition.sourceTransitionRef !== 'string'
                    || !TRANSITION_REF.test(transition.sourceTransitionRef)))
                || !capability(transition.capability) || !iso(transition.timestamp)) throw new Error();
            const previous = transition.previousBinding === null ? null : snapshotBinding(transition.previousBinding);
            const current = transition.currentBinding === null ? null : snapshotBinding(transition.currentBinding);
            if ((previous !== null && previous.capability !== transition.capability)
                || (current !== null && current.capability !== transition.capability)
                || (transition.kind === 'activation') === (transition.sourceTransitionRef !== null)) throw new Error();
            lastTransition = Object.freeze({ ...transition, previousBinding: previous, currentBinding: current }) as Transition;
        } catch { throw new FabricBindingStoreError('corrupt'); }
    }
    return Object.freeze({ schemaVersion: FABRIC_BINDING_STORE_SCHEMA_V1, version: input.version as number,
        bindings: Object.freeze(bindings), lastTransition });
}
function digest(binding: FabricCapabilityBindingV1 | null): string | null {
    return binding ? `sha256:${createHash('sha256').update(JSON.stringify(binding)).digest('hex')}` : null;
}
function candidateDigest(binding: FabricBindingCandidateV1 | FabricCapabilityBindingV1): string {
    const candidate = Object.fromEntries(CANDIDATE_KEYS.map((key) => [key, binding[key]]));
    return createHash('sha256').update(JSON.stringify(candidate)).digest('hex');
}
function sources(value: unknown): Sources {
    if (value === undefined) return Object.freeze({ now: () => new Date().toISOString(),
        entropy: () => randomBytes(16).toString('hex') });
    const input = exact(value, ['now', 'entropy']);
    if (typeof input.now !== 'function' || typeof input.entropy !== 'function'
        || types.isProxy(input.now) || types.isProxy(input.entropy)) throw new FabricBindingStoreError('source_invalid');
    return Object.freeze({ now: input.now as () => unknown, entropy: input.entropy as () => unknown });
}

export function getFabricBindingStorePaths(appDataDir = getDataDir()) {
    const directory = path.join(appDataDir, 'ai', 'fabric');
    return Object.freeze({ directory, recordPath: path.join(directory, 'capability-bindings.v1.json'),
        lockPath: path.join(directory, 'capability-bindings.v1.lock') });
}
export function createFabricCapabilityBindingStore(appDataDir = getDataDir(), sourceValue?: unknown) {
    if (typeof appDataDir !== 'string' || !path.isAbsolute(appDataDir)) throw new FabricBindingStoreError('input_invalid');
    const host = sources(sourceValue); const paths = getFabricBindingStorePaths(appDataDir);
    const read = (): FabricBindingStoreStateV1 => {
        let raw: string;
        try { raw = fs.readFileSync(paths.recordPath, 'utf8'); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return snapshotState({
                schemaVersion: FABRIC_BINDING_STORE_SCHEMA_V1, version: 0, bindings: emptyBindings(), lastTransition: null });
            throw new FabricBindingStoreError('unavailable');
        }
        try { return snapshotState(JSON.parse(raw)); } catch { throw new FabricBindingStoreError('corrupt'); }
    };
    const metadata = (current: FabricBindingStoreStateV1): { transitionRef: string; timestamp: string } => {
        let entropy: unknown; let timestamp: unknown;
        try { entropy = host.entropy(); timestamp = host.now(); } catch { throw new FabricBindingStoreError('source_invalid'); }
        if (typeof entropy !== 'string' || !/^[0-9a-f]{32}$/u.test(entropy) || !iso(timestamp)) {
            throw new FabricBindingStoreError('source_invalid');
        }
        if (current.lastTransition && timestamp < current.lastTransition.timestamp) throw new FabricBindingStoreError('clock_invalid');
        if (current.lastTransition?.transitionRef === `fabric_transition_${entropy}`) {
            throw new FabricBindingStoreError('source_invalid');
        }
        return { transitionRef: `fabric_transition_${entropy}`, timestamp };
    };
    const save = (expectedVersion: number, build: (current: FabricBindingStoreStateV1,
        meta: ReturnType<typeof metadata>) => FabricBindingStoreStateV1): FabricBindingStoreStateV1 => {
        fs.mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
        if (process.platform !== 'win32') fs.chmodSync(paths.directory, 0o700);
        let lock: number;
        try { lock = fs.openSync(paths.lockPath, 'wx', 0o600); } catch { throw new FabricBindingStoreError('busy'); }
        let temporaryPath: string | null = null;
        try {
            const current = read(); if (current.version !== expectedVersion) throw new FabricBindingStoreError('version_conflict');
            const next = build(current, metadata(current));
            temporaryPath = `${paths.recordPath}.${process.pid}.${randomUUID()}.tmp`;
            const file = fs.openSync(temporaryPath, 'wx', 0o600);
            try { fs.writeFileSync(file, `${JSON.stringify(next)}\n`, 'utf8'); fs.fsyncSync(file); } finally { fs.closeSync(file); }
            fs.renameSync(temporaryPath, paths.recordPath); temporaryPath = null;
            if (process.platform !== 'win32') {
                fs.chmodSync(paths.recordPath, 0o600); const directory = fs.openSync(paths.directory, 'r');
                try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
            }
            return snapshotState(next);
        } finally {
            if (temporaryPath) fs.rmSync(temporaryPath, { force: true }); fs.closeSync(lock!); fs.rmSync(paths.lockPath, { force: true });
        }
    };
    const receipt = (state: FabricBindingStoreStateV1): FabricBindingTransitionReceiptV1 => {
        const transition = state.lastTransition!;
        return Object.freeze({ schemaVersion: 'mediflow.ai.fabric-binding-transition-receipt.v1',
            outcome: transition.kind === 'activation' ? 'activated' : 'rolled_back',
            transitionRef: transition.transitionRef, capability: transition.capability,
            fromVersion: state.version - 1, toVersion: state.version,
            previousBindingDigest: digest(transition.previousBinding), currentBindingDigest: digest(transition.currentBinding),
            timestamp: transition.timestamp });
    };
    const activate = (value: unknown): FabricBindingTransitionReceiptV1 => {
        const input = exact(value, ['expectedVersion', 'binding']);
        if (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 0) {
            throw new FabricBindingStoreError('input_invalid');
        }
        const candidate = snapshotCandidate(input.binding);
        const state = save(input.expectedVersion as number, (current, meta) => {
            const previous = current.bindings[candidate.capability];
            const binding = Object.freeze({ ...candidate, activatedAt: meta.timestamp });
            if (previous && candidateDigest(previous) === candidateDigest(candidate)) {
                throw new FabricBindingStoreError('transition_conflict');
            }
            return snapshotState({ schemaVersion: FABRIC_BINDING_STORE_SCHEMA_V1, version: current.version + 1,
                bindings: { ...current.bindings, [candidate.capability]: binding }, lastTransition: {
                    schemaVersion: FABRIC_BINDING_TRANSITION_SCHEMA_V1, kind: 'activation',
                    transitionRef: meta.transitionRef, sourceTransitionRef: null, capability: candidate.capability,
                    previousBinding: previous, currentBinding: binding, timestamp: meta.timestamp } });
        });
        return receipt(state);
    };
    const rollback = (value: unknown): FabricBindingTransitionReceiptV1 => {
        const input = exact(value, ['expectedVersion', 'transitionRef']);
        if (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 1
            || typeof input.transitionRef !== 'string' || !TRANSITION_REF.test(input.transitionRef)) {
            throw new FabricBindingStoreError('input_invalid');
        }
        const state = save(input.expectedVersion as number, (current, meta) => {
            const previous = current.lastTransition;
            if (!previous || previous.kind !== 'activation' || previous.transitionRef !== input.transitionRef
                || digest(current.bindings[previous.capability]) !== digest(previous.currentBinding)) {
                throw new FabricBindingStoreError('transition_conflict');
            }
            return snapshotState({ schemaVersion: FABRIC_BINDING_STORE_SCHEMA_V1, version: current.version + 1,
                bindings: { ...current.bindings, [previous.capability]: previous.previousBinding }, lastTransition: {
                    schemaVersion: FABRIC_BINDING_TRANSITION_SCHEMA_V1, kind: 'rollback',
                    transitionRef: meta.transitionRef, sourceTransitionRef: previous.transitionRef,
                    capability: previous.capability, previousBinding: previous.currentBinding,
                    currentBinding: previous.previousBinding, timestamp: meta.timestamp } });
        });
        return receipt(state);
    };
    return Object.freeze({ read, activate, rollback, paths });
}
