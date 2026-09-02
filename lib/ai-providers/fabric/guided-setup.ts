/* @Codex */
import { Buffer } from 'node:buffer';
import { types } from 'node:util';
import {
    FABRIC_BINDING_CANDIDATE_SCHEMA_V1,
    GUIDED_FABRIC_CAPABILITIES,
    type FabricBindingCandidateV1,
    type FabricBindingTransitionReceiptV1,
    type GuidedFabricCapability,
} from './capability-binding-store';

export const FABRIC_SETUP_PROFILE_TIERS = Object.freeze(['light', 'balanced', 'quality'] as const);
export const FABRIC_DOCUMENT_OCR_ROUTING_V1 = Object.freeze({
    schemaVersion: 'mediflow.ai.document-ocr-routing.v1', firstPass: 'anydoc',
    ocrEligibility: 'needsOcr_only', malformedDisposition: 'denied', deepSeekOcr2: 'optional_adapter',
} as const);
export type FabricSetupProfileTier = typeof FABRIC_SETUP_PROFILE_TIERS[number];
export type FabricGuidedSetupErrorCode = 'input_invalid' | 'inventory_unavailable' | 'selection_unavailable'
    | 'download_confirmation_required' | 'download_failed' | 'smoke_failed' | 'timeout' | 'replay';
export class FabricGuidedSetupError extends Error {
    constructor(public readonly code: FabricGuidedSetupErrorCode) {
        super(`Fabric guided setup rejected: ${code}`); this.name = 'FabricGuidedSetupError';
    }
}

type Candidate = Readonly<{
    candidateRef: string; capability: GuidedFabricCapability; profileId: string; profileTier: FabricSetupProfileTier;
    optionalAdapter: boolean; installation: 'ready' | 'download_required'; compatibility: 'compatible' | 'incompatible';
    provider: string; engine: string; runtimeRef: string; model: string; modelVersion: string; modelDigest: string;
    venue: 'local_process'; credentialRef: null; egressProfileId: 'local_only';
    dataPolicy: 'clinical_local_only'; recipeId: string; fallback: 'none'; downloadBytes: number;
}>;
type Store = Readonly<{
    activate: (value: unknown) => FabricBindingTransitionReceiptV1;
    rollback: (value: unknown) => FabricBindingTransitionReceiptV1;
}>;
type Sources = Readonly<{
    detectHostCandidates: () => unknown; installProfile: (candidate: Candidate, signal: AbortSignal) => unknown;
    runSyntheticSmoke: (request: unknown, signal: AbortSignal) => unknown; bindingStore: Store;
}>;
type Prepared = { binding: FabricBindingCandidateV1; generation: number; used: boolean };
const SOURCE_KEYS = ['detectHostCandidates', 'installProfile', 'runSyntheticSmoke', 'bindingStore'] as const;
const INVENTORY_KEYS = ['schemaVersion', 'platform', 'architecture', 'memoryMiB', 'freeDiskMiB', 'accelerators',
    'candidates'] as const;
const CANDIDATE_KEYS = ['candidateRef', 'capability', 'profileId', 'profileTier', 'optionalAdapter', 'installation',
    'compatibility', 'provider', 'engine', 'runtimeRef', 'model', 'modelVersion', 'modelDigest', 'venue',
    'credentialRef', 'egressProfileId', 'dataPolicy', 'recipeId', 'fallback', 'downloadBytes'] as const;
const INSTALL_KEYS = [...CANDIDATE_KEYS, 'schemaVersion', 'outcome', 'downloadReceiptRef'] as const;
const SMOKE_KEYS = ['schemaVersion', 'outcome', 'candidateRef', 'capability', 'smokeReceiptRef', 'provenanceRef',
    'fixture', 'egress', 'writesPerformed'] as const;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,127}$/u;
const REF = /^[a-z][a-z0-9._-]{15,127}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const TIER_RANK: Readonly<Record<FabricSetupProfileTier, number>> = Object.freeze({ balanced: 0, light: 1, quality: 2 });
const MAX_CANDIDATES = 24, MAX_ACCELERATORS = 8, DOWNLOAD_TIMEOUT_MS = 15 * 60_000, SMOKE_TIMEOUT_MS = 30_000;

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)) {
        throw new FabricGuidedSetupError('input_invalid');
    }
    let own: (string | symbol)[]; let descriptors: Record<string, PropertyDescriptor>; let prototype: object | null;
    try { own = Reflect.ownKeys(value); descriptors = Object.getOwnPropertyDescriptors(value);
        prototype = Object.getPrototypeOf(value); } catch { throw new FabricGuidedSetupError('input_invalid'); }
    if ((prototype !== Object.prototype && prototype !== null) || own.length !== keys.length
        || own.some((key) => typeof key !== 'string' || !keys.includes(key))) throw new FabricGuidedSetupError('input_invalid');
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
            throw new FabricGuidedSetupError('input_invalid');
        }
        output[key] = descriptor.value;
    }
    return output;
}
function boundedArray(value: unknown, maximum: number): unknown[] {
    if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype
        || value.length > maximum) throw new FabricGuidedSetupError('input_invalid');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) throw new FabricGuidedSetupError('input_invalid');
    return Array.from({ length: value.length }, (_unused, index) => {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
            throw new FabricGuidedSetupError('input_invalid');
        }
        return descriptor.value;
    });
}
function token(value: unknown): value is string {
    return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 128 && TOKEN.test(value);
}
function capability(value: unknown): value is GuidedFabricCapability {
    return typeof value === 'string' && (GUIDED_FABRIC_CAPABILITIES as readonly string[]).includes(value);
}
function candidate(value: unknown): Candidate {
    const input = exact(value, CANDIDATE_KEYS);
    if (typeof input.candidateRef !== 'string' || !REF.test(input.candidateRef) || !capability(input.capability)
        || !token(input.profileId) || !(FABRIC_SETUP_PROFILE_TIERS as readonly unknown[]).includes(input.profileTier)
        || typeof input.optionalAdapter !== 'boolean' || (input.optionalAdapter && input.capability !== 'ocr')
        || (input.installation !== 'ready' && input.installation !== 'download_required')
        || (input.compatibility !== 'compatible' && input.compatibility !== 'incompatible')
        || ![input.provider, input.engine, input.runtimeRef, input.model, input.modelVersion, input.recipeId].every(token)
        || typeof input.modelDigest !== 'string' || !DIGEST.test(input.modelDigest) || input.venue !== 'local_process'
        || input.credentialRef !== null
        || input.egressProfileId !== 'local_only' || input.dataPolicy !== 'clinical_local_only'
        || input.fallback !== 'none' || !Number.isSafeInteger(input.downloadBytes) || (input.downloadBytes as number) < 0
        || (input.installation === 'ready' ? input.downloadBytes !== 0 : input.downloadBytes === 0)) {
        throw new FabricGuidedSetupError('input_invalid');
    }
    return Object.freeze({ ...input }) as Candidate;
}
function sources(value: unknown): Sources {
    const input = exact(value, SOURCE_KEYS); const store = exact(input.bindingStore, ['activate', 'rollback']);
    if (![input.detectHostCandidates, input.installProfile, input.runSyntheticSmoke, store.activate, store.rollback]
        .every((entry) => typeof entry === 'function' && !types.isProxy(entry))) throw new FabricGuidedSetupError('input_invalid');
    return Object.freeze({ detectHostCandidates: input.detectHostCandidates as Sources['detectHostCandidates'],
        installProfile: input.installProfile as Sources['installProfile'],
        runSyntheticSmoke: input.runSyntheticSmoke as Sources['runSyntheticSmoke'],
        bindingStore: Object.freeze({ activate: store.activate as Store['activate'], rollback: store.rollback as Store['rollback'] }) });
}
async function nativeCall(source: () => unknown, signal: AbortSignal, timeoutMs: number,
    failure: FabricGuidedSetupErrorCode): Promise<unknown> {
    const deadline = performance.now() + timeoutMs;
    let value: unknown;
    try { value = source(); } catch { throw new FabricGuidedSetupError(failure); }
    if (!types.isPromise(value) || types.isProxy(value)) throw new FabricGuidedSetupError(failure);
    if (signal.aborted || performance.now() >= deadline) {
        void Promise.prototype.then.call(value, undefined, () => undefined); throw new FabricGuidedSetupError('timeout');
    }
    const timeout = new Promise<never>((_resolve, reject) => signal.addEventListener('abort',
        () => reject(new FabricGuidedSetupError('timeout')), { once: true }));
    try {
        const result = await Promise.race([Promise.prototype.then.call(value, (item) => item), timeout]);
        if (signal.aborted || performance.now() >= deadline) throw new FabricGuidedSetupError('timeout');
        return result;
    }
    catch (error) { throw error instanceof FabricGuidedSetupError ? error : new FabricGuidedSetupError(failure); }
}

export function createFabricGuidedSetupService(sourceValue: unknown) {
    const host = sources(sourceValue); let generation = 0;
    let choices = new Map<string, Candidate>(); let recommended = new Map<GuidedFabricCapability, string>();
    const prepared = new WeakMap<object, Prepared>();
    const discover = () => {
        let raw: unknown;
        try { raw = host.detectHostCandidates(); } catch { throw new FabricGuidedSetupError('inventory_unavailable'); }
        if (types.isPromise(raw) || types.isProxy(raw)) throw new FabricGuidedSetupError('inventory_unavailable');
        let input: Record<string, unknown>;
        try { input = exact(raw, INVENTORY_KEYS); } catch { throw new FabricGuidedSetupError('inventory_unavailable'); }
        if (input.schemaVersion !== 'mediflow.ai.fabric-host-inventory.v1'
            || !['darwin', 'win32', 'linux'].includes(input.platform as string)
            || !['arm64', 'x64'].includes(input.architecture as string)
            || !Number.isSafeInteger(input.memoryMiB) || (input.memoryMiB as number) < 1
            || !Number.isSafeInteger(input.freeDiskMiB) || (input.freeDiskMiB as number) < 0) {
            throw new FabricGuidedSetupError('inventory_unavailable');
        }
        let accelerators: string[]; let detected: Candidate[];
        try {
            accelerators = boundedArray(input.accelerators, MAX_ACCELERATORS).map((item) => {
                if (!token(item)) throw new FabricGuidedSetupError('input_invalid'); return item;
            });
            detected = boundedArray(input.candidates, MAX_CANDIDATES).map(candidate);
        } catch { throw new FabricGuidedSetupError('inventory_unavailable'); }
        const nextGeneration = generation + 1;
        if (!Number.isSafeInteger(nextGeneration)) throw new FabricGuidedSetupError('inventory_unavailable');
        const nextChoices = new Map<string, Candidate>();
        const nextRecommended = new Map<GuidedFabricCapability, string>();
        const compatible = detected.filter((item) => item.compatibility === 'compatible');
        for (const item of compatible) {
            const key = `${item.capability}\0${item.profileId}`;
            if (nextChoices.has(key)) throw new FabricGuidedSetupError('inventory_unavailable');
            nextChoices.set(key, item);
        }
        const capabilities = GUIDED_FABRIC_CAPABILITIES.map((id) => {
            const options = compatible.filter((item) => item.capability === id).sort((left, right) =>
                Number(left.installation !== 'ready') - Number(right.installation !== 'ready')
                || TIER_RANK[left.profileTier] - TIER_RANK[right.profileTier] || left.profileId.localeCompare(right.profileId));
            const selected = options[0] ?? null; if (selected) nextRecommended.set(id, selected.profileId);
            return Object.freeze({ capability: id, status: selected?.installation ?? 'unavailable',
                recommendedProfileId: selected?.profileId ?? null, options: Object.freeze(options.map((item) => Object.freeze({
                    profileId: item.profileId, profileTier: item.profileTier, provider: item.provider, engine: item.engine,
                    model: item.model, modelVersion: item.modelVersion, modelDigest: item.modelDigest,
                    installation: item.installation, downloadBytes: item.downloadBytes,
                    advancedOnly: selected !== item, optionalAdapter: item.optionalAdapter,
                }))) });
        });
        const discovery = Object.freeze({ schemaVersion: 'mediflow.ai.fabric-guided-discovery.v1',
            generation: nextGeneration,
            host: Object.freeze({ platform: input.platform, architecture: input.architecture, memoryMiB: input.memoryMiB,
                freeDiskMiB: input.freeDiskMiB, accelerators: Object.freeze(accelerators) }),
            ocrRouting: FABRIC_DOCUMENT_OCR_ROUTING_V1, capabilities: Object.freeze(capabilities) });
        generation = nextGeneration; choices = nextChoices; recommended = nextRecommended;
        return discovery;
    };
    const prepare = async (value: unknown) => {
        const input = exact(value, ['generation', 'capability', 'profileId', 'mode', 'download']);
        if (input.generation !== generation || !capability(input.capability) || !token(input.profileId)
            || (input.mode !== 'recommended' && input.mode !== 'advanced')
            || (input.download !== 'confirmed' && input.download !== 'not_required')) {
            throw new FabricGuidedSetupError('selection_unavailable');
        }
        const selected = choices.get(`${input.capability}\0${input.profileId}`);
        if (!selected || (input.mode === 'recommended' && recommended.get(input.capability) !== input.profileId)) {
            throw new FabricGuidedSetupError('selection_unavailable');
        }
        if (selected.installation === 'download_required' && input.download !== 'confirmed') {
            throw new FabricGuidedSetupError('download_confirmation_required');
        }
        if (selected.installation === 'ready' && input.download !== 'not_required') {
            throw new FabricGuidedSetupError('selection_unavailable');
        }
        const selectedGeneration = generation;
        let ready = selected; let downloadReceiptRef: string | null = null;
        if (selected.installation === 'download_required') {
            const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
            try {
                const result = exact(await nativeCall(() => host.installProfile(selected, controller.signal), controller.signal,
                    DOWNLOAD_TIMEOUT_MS, 'download_failed'), INSTALL_KEYS);
                const installed = candidate(Object.fromEntries(CANDIDATE_KEYS.map((key) => [key,
                    key === 'installation' ? 'ready' : key === 'downloadBytes' ? 0 : result[key]])));
                if (result.schemaVersion !== 'mediflow.ai.fabric-profile-install.v1' || result.outcome !== 'installed'
                    || result.candidateRef !== selected.candidateRef || installed.capability !== selected.capability
                    || installed.profileId !== selected.profileId || typeof result.downloadReceiptRef !== 'string'
                    || !REF.test(result.downloadReceiptRef)
                    || CANDIDATE_KEYS.some((key) => key !== 'installation' && key !== 'downloadBytes'
                        && installed[key] !== selected[key])) throw new FabricGuidedSetupError('download_failed');
                ready = installed; downloadReceiptRef = result.downloadReceiptRef;
            } catch (error) { throw error instanceof FabricGuidedSetupError ? error : new FabricGuidedSetupError('download_failed'); }
            finally { clearTimeout(timer); }
        }
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), SMOKE_TIMEOUT_MS);
        let smoke: Record<string, unknown>;
        try {
            const request = Object.freeze({ schemaVersion: 'mediflow.ai.fabric-synthetic-smoke.input.v1',
                fixture: 'mediflow.synthetic.fabric-setup.v1', candidateRef: ready.candidateRef,
                capability: ready.capability });
            smoke = exact(await nativeCall(() => host.runSyntheticSmoke(request, controller.signal), controller.signal,
                SMOKE_TIMEOUT_MS, 'smoke_failed'), SMOKE_KEYS);
            if (smoke.schemaVersion !== 'mediflow.ai.fabric-synthetic-smoke.result.v1' || smoke.outcome !== 'passed'
                || smoke.candidateRef !== ready.candidateRef || smoke.capability !== ready.capability
                || smoke.fixture !== request.fixture || smoke.egress !== 'none' || smoke.writesPerformed !== 0
                || typeof smoke.smokeReceiptRef !== 'string' || !REF.test(smoke.smokeReceiptRef)
                || typeof smoke.provenanceRef !== 'string' || !REF.test(smoke.provenanceRef)) {
                throw new FabricGuidedSetupError('smoke_failed');
            }
        } catch (error) { throw error instanceof FabricGuidedSetupError ? error : new FabricGuidedSetupError('smoke_failed'); }
        finally { clearTimeout(timer); }
        if (generation !== selectedGeneration) throw new FabricGuidedSetupError('selection_unavailable');
        const handle = Object.freeze(Object.create(null));
        prepared.set(handle, { used: false, generation: selectedGeneration,
            binding: Object.freeze({ schemaVersion: FABRIC_BINDING_CANDIDATE_SCHEMA_V1,
            capability: ready.capability, profileId: ready.profileId, provider: ready.provider, engine: ready.engine,
            runtimeRef: ready.runtimeRef, model: ready.model, modelVersion: ready.modelVersion,
            modelDigest: ready.modelDigest, venue: ready.venue, credentialRef: ready.credentialRef,
            egressProfileId: ready.egressProfileId, dataPolicy: ready.dataPolicy, recipeId: ready.recipeId,
            readiness: 'synthetic_smoke_passed', smokeReceiptRef: smoke.smokeReceiptRef as string,
            provenanceRef: smoke.provenanceRef as string, fallback: 'none' }) });
        return Object.freeze({ candidate: handle, receipt: Object.freeze({
            schemaVersion: 'mediflow.ai.fabric-guided-setup-receipt.v1', capability: ready.capability,
            profileId: ready.profileId, mode: input.mode,
            selectionDisposition: input.mode === 'advanced' ? 'advanced_override' : 'recommended',
            download: downloadReceiptRef ? 'performed' : 'not_required',
            downloadReceiptRef, smoke: 'passed', smokeReceiptRef: smoke.smokeReceiptRef,
            provenanceRef: smoke.provenanceRef, egress: 'none', writesPerformed: 0, fallback: 'none' }) });
    };
    const activate = (value: unknown) => {
        const input = exact(value, ['candidate', 'expectedVersion']);
        if (!input.candidate || typeof input.candidate !== 'object' || types.isProxy(input.candidate)) {
            throw new FabricGuidedSetupError('replay');
        }
        const staged = prepared.get(input.candidate as object);
        if (!staged || staged.used) throw new FabricGuidedSetupError('replay');
        if (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 0) {
            throw new FabricGuidedSetupError('input_invalid');
        }
        if (staged.generation !== generation) throw new FabricGuidedSetupError('selection_unavailable');
        const result = host.bindingStore.activate({ expectedVersion: input.expectedVersion, binding: staged.binding });
        staged.used = true; return result;
    };
    const rollback = (value: unknown) => host.bindingStore.rollback(exact(value, ['expectedVersion', 'transitionRef']));
    return Object.freeze({ discover, prepare, activate, rollback });
}
