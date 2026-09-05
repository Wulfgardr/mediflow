/* @Codex */
import { EGRESS_PROFILE_VERSION } from './ai-providers/fabric/contract';
import { assertLocalOllamaModelReference } from './ai-providers/ollama-locality';

type ProviderReceipt = Readonly<{ schemaVersion: 'mediflow.ai.provider-selection.v1'; authorityPlane: 'clinical_application'; task: 'clinical'; provider: 'ollama'; model: string; execution: 'local'; endpointClass: 'loopback'; egress: 'none'; runtimeReadiness: 'required'; fallbackCount: 0 }>;
export type SmartImportFabricResolutionReceiptWire = Readonly<{ schemaVersion: 'mediflow.ai.fabric-resolution.v1'; capability: 'smart_import'; class: 'generative'; venue: 'local_process'; egressProfile: Readonly<{ id: 'local_only'; version: typeof EGRESS_PROFILE_VERSION; egress: 'none' }>; provider: 'ollama'; model: string; providerReceipt: ProviderReceipt; fallbackCount: 0 }>;
export type SmartImportFabricProvenanceWire = Readonly<{ schemaVersion: 'mediflow.ai.fabric-provenance.v1'; capability: 'smart_import'; venue: 'local_process'; provider: 'ollama'; model: string; preprocessing: readonly ['context_minimization', 'envelope_validation']; receipt: SmartImportFabricResolutionReceiptWire }>;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const own = Reflect.ownKeys(value); if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const output: Record<string, unknown> = {}; for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !('value' in descriptor)) return null; output[key] = descriptor.value; }
        return output;
    } catch { return null; }
}
function model(value: unknown): string | null {
    try { assertLocalOllamaModelReference(value); return value.trim() === value ? value : null; } catch { return null; }
}
/** Browser-safe snapshot of the closed clinical Ollama provider receipt. */
export function snapshotSmartImportProviderSelectionReceipt(value: unknown): ProviderReceipt | null {
    const input = record(value, ['schemaVersion', 'authorityPlane', 'task', 'provider', 'model', 'execution', 'endpointClass', 'egress', 'runtimeReadiness', 'fallbackCount']); const parsedModel = input ? model(input.model) : null;
    return !input || !parsedModel || input.schemaVersion !== 'mediflow.ai.provider-selection.v1' || input.authorityPlane !== 'clinical_application' || input.task !== 'clinical' || input.provider !== 'ollama' || input.execution !== 'local' || input.endpointClass !== 'loopback' || input.egress !== 'none' || input.runtimeReadiness !== 'required' || input.fallbackCount !== 0 ? null : Object.freeze({ schemaVersion: 'mediflow.ai.provider-selection.v1', authorityPlane: 'clinical_application', task: 'clinical', provider: 'ollama', model: parsedModel, execution: 'local', endpointClass: 'loopback', egress: 'none', runtimeReadiness: 'required', fallbackCount: 0 });
}
function sameReceipt(left: SmartImportFabricResolutionReceiptWire, right: SmartImportFabricResolutionReceiptWire): boolean {
    const a = left.providerReceipt; const b = right.providerReceipt;
    return left.schemaVersion === right.schemaVersion && left.capability === right.capability && left.class === right.class && left.venue === right.venue && left.egressProfile.id === right.egressProfile.id && left.egressProfile.version === right.egressProfile.version && left.egressProfile.egress === right.egressProfile.egress && left.provider === right.provider && left.model === right.model && left.fallbackCount === right.fallbackCount && a.schemaVersion === b.schemaVersion && a.authorityPlane === b.authorityPlane && a.task === b.task && a.provider === b.provider && a.model === b.model && a.execution === b.execution && a.endpointClass === b.endpointClass && a.egress === b.egress && a.runtimeReadiness === b.runtimeReadiness && a.fallbackCount === b.fallbackCount;
}

/** Browser-safe snapshot of the closed Smart Import Fabric receipt. */
export function snapshotSmartImportFabricResolutionReceipt(value: unknown): SmartImportFabricResolutionReceiptWire | null {
    const input = record(value, ['schemaVersion', 'capability', 'class', 'venue', 'egressProfile', 'provider', 'model', 'providerReceipt', 'fallbackCount']); const profile = input && record(input.egressProfile, ['id', 'version', 'egress']); const parsedModel = input ? model(input.model) : null; const nested = input ? snapshotSmartImportProviderSelectionReceipt(input.providerReceipt) : null;
    return !input || !profile || !parsedModel || !nested || input.schemaVersion !== 'mediflow.ai.fabric-resolution.v1' || input.capability !== 'smart_import' || input.class !== 'generative' || input.venue !== 'local_process' || profile.id !== 'local_only' || profile.version !== EGRESS_PROFILE_VERSION || profile.egress !== 'none' || input.provider !== 'ollama' || nested.model !== parsedModel || input.fallbackCount !== 0 ? null : Object.freeze({ schemaVersion: 'mediflow.ai.fabric-resolution.v1', capability: 'smart_import', class: 'generative', venue: 'local_process', egressProfile: Object.freeze({ id: 'local_only', version: EGRESS_PROFILE_VERSION, egress: 'none' }), provider: 'ollama', model: parsedModel, providerReceipt: nested, fallbackCount: 0 });
}

/** Browser-safe snapshot of Smart Import provenance bound to a receipt snapshot. */
export function snapshotSmartImportFabricProvenance(value: unknown, receipt: SmartImportFabricResolutionReceiptWire): SmartImportFabricProvenanceWire | null {
    try {
        const expected = snapshotSmartImportFabricResolutionReceipt(receipt); const input = record(value, ['schemaVersion', 'capability', 'venue', 'provider', 'model', 'preprocessing', 'receipt']); const labels = input && Array.isArray(input.preprocessing) && Object.getPrototypeOf(input.preprocessing) === Array.prototype && Reflect.ownKeys(input.preprocessing).length === 3 ? input.preprocessing : null; const nested = input ? snapshotSmartImportFabricResolutionReceipt(input.receipt) : null;
        if (!expected || !input || !labels || !nested || !sameReceipt(nested, expected) || input.schemaVersion !== 'mediflow.ai.fabric-provenance.v1' || input.capability !== 'smart_import' || input.venue !== 'local_process' || input.provider !== 'ollama' || input.model !== expected.model) return null;
        const first = Object.getOwnPropertyDescriptor(labels, '0'); const second = Object.getOwnPropertyDescriptor(labels, '1'); if (!first || !second || !('value' in first) || !('value' in second) || first.value !== 'context_minimization' || second.value !== 'envelope_validation') return null;
        return Object.freeze({ schemaVersion: 'mediflow.ai.fabric-provenance.v1', capability: 'smart_import', venue: 'local_process', provider: 'ollama', model: expected.model, preprocessing: Object.freeze(['context_minimization', 'envelope_validation']) as ['context_minimization', 'envelope_validation'], receipt: expected });
    } catch { return null; }
}
