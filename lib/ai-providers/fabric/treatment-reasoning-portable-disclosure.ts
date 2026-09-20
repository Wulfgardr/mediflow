/* @Codex: capability-local v2. Browser-safe; never widen generic Fabric v1 unions. */
import { ATHENA_R1_QWEN3_8B_MODEL_ID } from '../../athena-model-identity';
import type { PortableStatus, PortableHardwareReport } from './treatment-reasoning-portable-provisioning';
import type { FabricStatusSnapshot } from './status';
export const PORTABLE_DISCLOSURE_SCHEMA = 'mediflow.ai.treatment-reasoning-disclosure.v2' as const;
export const FABRIC_STATUS_VERSION_HEADER = 'x-mediflow-fabric-status';
const STATES = ['NEEDS_CONTEXT', 'platform_unsupported', 'manifest_invalid', 'license_missing', 'model_not_provisioned',
    'needs_activation', 'admitted', 'revoked', 'artifact_tampered', 'consent_required', 'cancelled', 'busy', 'interrupted', 'unavailable'] as const;
const PLATFORMS = ['linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64'] as const;
const LABEL = 'ATHENA · Transformers · BF16 CPU locale';
export type TreatmentReasoningPortableDisclosure = Readonly<{
    schemaVersion: typeof PORTABLE_DISCLOSURE_SCHEMA; capability: 'treatment_reasoning';
    provider: 'athena_transformers'; model: typeof ATHENA_R1_QWEN3_8B_MODEL_ID; label: typeof LABEL;
    state: PortableStatus['state']; selected: boolean; releaseDigest: string | null; admissionRevision: number;
    configurationDisposition: 'admitted_unqualified' | 'blocked'; runtimeObservation: 'not_observed';
    declaredVenue: 'local_process'; declaredEgress: 'none'; review: 'required';
    prerequisites: readonly string[]; hardware: PortableHardwareReport | null; writesPerformed: 0; applyPolicy: 'none';
}>;
export type PortableFabricStatusSnapshot = Readonly<{
    schemaVersion: 'mediflow.ai.fabric-status.v2'; legacy: FabricStatusSnapshot;
    treatmentReasoning: TreatmentReasoningPortableDisclosure;
}>;
const invalid = (): never => { throw new Error('portable_disclosure_invalid'); };
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
        || Reflect.ownKeys(value).length !== keys.length) return invalid();
    const result: Record<string, unknown> = {};
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
        result[key] = descriptor.value;
    }
    return result;
}
function codes(value: unknown): readonly string[] {
    if (!Array.isArray(value) || value.length > 16 || new Set(value).size !== value.length
        || !value.every(code => typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,159}$/u.test(code))) return invalid();
    return Object.freeze([...value]);
}
function parseHardware(value: unknown): PortableHardwareReport | null {
    if (value === null) return null;
    const row = record(value, ['schemaVersion', 'targetPlatform', 'nodeArchitecture', 'machineArchitecture', 'totalMemoryBytes',
        'availableMemoryBytes', 'logicalCpus', 'threads', 'weightBytes', 'kvCacheBudgetBytes', 'minimumProcessMemoryBytes',
        'processMemoryLimitBytes', 'minimumHostMemoryBytes', 'policy', 'qualification', 'blockers']);
    if (row.schemaVersion !== 'mediflow.treatment-portable-hardware.v1' || row.policy !== 'bf16_cpu_conservative_v1'
        || row.qualification !== 'not_observed' || !(row.targetPlatform === null || PLATFORMS.some(value => value === row.targetPlatform))) return invalid();
    for (const name of ['nodeArchitecture', 'machineArchitecture']) {
        if (typeof row[name] !== 'string' || !/^[A-Za-z0-9_ -]{1,40}$/u.test(row[name])) return invalid();
    }
    const number = (name: string): number => {
        const value = row[name]; if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid(); return value;
    };
    const totalMemoryBytes = number('totalMemoryBytes'); const availableMemoryBytes = number('availableMemoryBytes');
    const logicalCpus = number('logicalCpus'); const threads = number('threads');
    const processMemoryLimitBytes = number('processMemoryLimitBytes'); const minimumHostMemoryBytes = number('minimumHostMemoryBytes');
    if (availableMemoryBytes > totalMemoryBytes || logicalCpus < 1 || logicalCpus > 65_536 || threads < 1 || threads > 4
        || minimumHostMemoryBytes !== processMemoryLimitBytes + 4 * 1024 ** 3) return invalid();
    const targetPlatform = PLATFORMS.find(value => value === row.targetPlatform) ?? null;
    return Object.freeze({ schemaVersion: 'mediflow.treatment-portable-hardware.v1', targetPlatform,
        nodeArchitecture: row.nodeArchitecture as string, machineArchitecture: row.machineArchitecture as string,
        totalMemoryBytes, availableMemoryBytes, logicalCpus, threads, weightBytes: number('weightBytes'),
        kvCacheBudgetBytes: number('kvCacheBudgetBytes'), minimumProcessMemoryBytes: number('minimumProcessMemoryBytes'),
        processMemoryLimitBytes, minimumHostMemoryBytes, policy: 'bf16_cpu_conservative_v1', qualification: 'not_observed', blockers: codes(row.blockers) });
}
export function parseTreatmentReasoningPortableDisclosure(value: unknown): TreatmentReasoningPortableDisclosure {
    const row = record(value, ['schemaVersion', 'capability', 'provider', 'model', 'label', 'state', 'selected', 'releaseDigest',
        'admissionRevision', 'configurationDisposition', 'runtimeObservation', 'declaredVenue', 'declaredEgress', 'review',
        'prerequisites', 'hardware', 'writesPerformed', 'applyPolicy']);
    const state = STATES.find(value => value === row.state); const prerequisites = codes(row.prerequisites); const hardware = parseHardware(row.hardware);
    if (row.schemaVersion !== PORTABLE_DISCLOSURE_SCHEMA || row.capability !== 'treatment_reasoning' || row.provider !== 'athena_transformers'
        || row.model !== ATHENA_R1_QWEN3_8B_MODEL_ID || row.label !== LABEL || !state || typeof row.selected !== 'boolean'
        || !(row.releaseDigest === null || (typeof row.releaseDigest === 'string' && /^[0-9a-f]{64}$/u.test(row.releaseDigest)))
        || typeof row.admissionRevision !== 'number' || !Number.isSafeInteger(row.admissionRevision) || row.admissionRevision < 0
        || row.runtimeObservation !== 'not_observed' || row.declaredVenue !== 'local_process' || row.declaredEgress !== 'none'
        || row.review !== 'required' || row.writesPerformed !== 0 || row.applyPolicy !== 'none'
        || (row.selected && row.releaseDigest === null)) return invalid();
    if (state === 'admitted' && (!row.selected || row.admissionRevision < 1 || prerequisites.length || !hardware || hardware.blockers.length)) return invalid();
    const configurationDisposition = state === 'admitted' ? 'admitted_unqualified' : 'blocked';
    if (row.configurationDisposition !== configurationDisposition) return invalid();
    return Object.freeze({ schemaVersion: PORTABLE_DISCLOSURE_SCHEMA, capability: 'treatment_reasoning', provider: 'athena_transformers',
        model: ATHENA_R1_QWEN3_8B_MODEL_ID, label: LABEL, state, selected: row.selected, releaseDigest: row.releaseDigest,
        admissionRevision: row.admissionRevision, configurationDisposition, runtimeObservation: 'not_observed',
        declaredVenue: 'local_process', declaredEgress: 'none', review: 'required', prerequisites, hardware, writesPerformed: 0, applyPolicy: 'none' });
}
/** Read configuration only. No launch, account, clinical database or provisioning side effect. */
export function buildTreatmentReasoningPortableDisclosure(readStatus: () => unknown, readHardware: () => unknown): TreatmentReasoningPortableDisclosure {
    const common = { schemaVersion: PORTABLE_DISCLOSURE_SCHEMA, capability: 'treatment_reasoning', provider: 'athena_transformers',
        model: ATHENA_R1_QWEN3_8B_MODEL_ID, label: LABEL, runtimeObservation: 'not_observed',
        declaredVenue: 'local_process', declaredEgress: 'none', review: 'required', writesPerformed: 0, applyPolicy: 'none' };
    try {
        const status = record(readStatus(), ['schemaVersion', 'provider', 'model', 'state', 'selected', 'releaseDigest', 'revision', 'prerequisites', 'writesPerformed', 'applyPolicy']);
        if (status.schemaVersion !== 'mediflow.treatment-portable-status.v1' || status.provider !== 'athena_transformers'
            || status.model !== ATHENA_R1_QWEN3_8B_MODEL_ID || status.writesPerformed !== 0 || status.applyPolicy !== 'none') return invalid();
        return parseTreatmentReasoningPortableDisclosure({ ...common, state: status.state, selected: status.selected,
            releaseDigest: status.releaseDigest, admissionRevision: status.revision, prerequisites: status.prerequisites,
            configurationDisposition: status.state === 'admitted' ? 'admitted_unqualified' : 'blocked', hardware: readHardware() });
    } catch {
        return parseTreatmentReasoningPortableDisclosure({ ...common, state: 'unavailable', selected: false, releaseDigest: null,
            admissionRevision: 0, prerequisites: ['portable_status_unavailable'], configurationDisposition: 'blocked', hardware: null });
    }
}
/** The caller MUST validate `legacy` with the existing v1 parser. No generic union cast. */
export function parsePortableFabricStatusEnvelope(value: unknown): Readonly<{ legacy: unknown; treatmentReasoning: TreatmentReasoningPortableDisclosure | null }> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
    const schema = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
    if (!schema || !('value' in schema)) return invalid();
    if (schema.value === 'mediflow.ai.fabric-status.v1') return Object.freeze({ legacy: value, treatmentReasoning: null });
    const row = record(value, ['schemaVersion', 'legacy', 'treatmentReasoning']);
    if (row.schemaVersion !== 'mediflow.ai.fabric-status.v2') return invalid();
    return Object.freeze({ legacy: row.legacy, treatmentReasoning: parseTreatmentReasoningPortableDisclosure(row.treatmentReasoning) });
}
export const portablePrerequisiteText = (code: string): string => ({
    host_release_manifest: 'Manifest di rilascio locale completo', immutable_model_revision_and_checksums: 'Revisione e checksum dei pesi verificati sui byte locali',
    approved_model_and_runtime_licenses: 'Documenti di licenza e approvazione dell’operatore', pinned_self_contained_python_transformers_torch_runtime: 'Runtime Python, Transformers e torch completo, versionato e offline',
    explicit_offline_import: 'Importazione offline esplicita', explicit_host_admission: 'Ammissione esplicita dell’host',
    native_platform_or_runtime_architecture_unverified: 'Architettura nativa del runtime da verificare; Node emulato non è una prova',
    process_memory_budget_below_bf16_policy: 'Limite di memoria del processo inferiore alla politica BF16',
    physical_memory_below_bf16_policy: 'RAM della macchina insufficiente per la politica BF16',
    available_memory_below_process_budget: 'Memoria libera insufficiente al momento della richiesta',
    configured_threads_exceed_available_cpus: 'Numero di thread superiore alle CPU disponibili',
    portable_status_unavailable: 'Stato non verificabile: esecuzione bloccata',
} as Readonly<Record<string, string>>)[code] ?? code;
