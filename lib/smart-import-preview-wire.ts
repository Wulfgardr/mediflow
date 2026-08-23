/* @Codex */
import {
    parsePatientSmartImportProposalWire,
    serializePatientSmartImportProposalWire,
    type SmartImportProposalWireV1,
} from './smart-import-proposal-wire';
import {
    snapshotSmartImportFabricProvenance,
    snapshotSmartImportFabricResolutionReceipt,
    type SmartImportFabricProvenanceWire,
    type SmartImportFabricResolutionReceiptWire,
} from './smart-import-fabric-wire';

type DenialCode = 'input_invalid' | 'kill_switch_disabled' | 'kill_switch_unavailable' | 'projection_unavailable' | 'lifecycle_missing' | 'lifecycle_corrupt' | 'lifecycle_unavailable' | 'provider_binding_denied' | 'provider_unready' | 'model_unavailable' | 'fabric_denied' | 'source_invalid';
type FailureCode = 'provider_failed' | 'proposal_invalid';
type Common = Readonly<{ writesPerformed: 0; apply: 'denied' }>;
export type SmartImportPreviewWire =
    | (Common & Readonly<{ status: 'available'; code: null; proposal: SmartImportProposalWireV1; receipt: SmartImportFabricResolutionReceiptWire; provenance: SmartImportFabricProvenanceWire; reviewRef: string }>)
    | (Common & Readonly<{ status: 'denied'; code: DenialCode; proposal: null; receipt: null; provenance: null; reviewRef: null }>)
    | (Common & Readonly<{ status: 'failed'; code: FailureCode; proposal: null; receipt: SmartImportFabricResolutionReceiptWire; provenance: SmartImportFabricProvenanceWire; reviewRef: null }>);
export type SmartImportPreviewWireRoot = Readonly<{ preview: SmartImportPreviewWire }>;

const DENIAL_CODES: readonly DenialCode[] = ['input_invalid', 'kill_switch_disabled', 'kill_switch_unavailable', 'projection_unavailable', 'lifecycle_missing', 'lifecycle_corrupt', 'lifecycle_unavailable', 'provider_binding_denied', 'provider_unready', 'model_unavailable', 'fabric_denied', 'source_invalid'];
const FAILURE_CODES: readonly FailureCode[] = ['provider_failed', 'proposal_invalid'];
const KEYS = ['writesPerformed', 'apply', 'status', 'code', 'proposal', 'receipt', 'provenance', 'reviewRef'];

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const own = Reflect.ownKeys(value); if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const output: Record<string, unknown> = {}; for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !('value' in descriptor)) return null; output[key] = descriptor.value; }
        return output;
    } catch { return null; }
}
function code<T extends string>(value: unknown, values: readonly T[]): T | null { return typeof value === 'string' && values.includes(value as T) ? value as T : null; }
function metadata(input: Record<string, unknown>): Readonly<{ receipt: SmartImportFabricResolutionReceiptWire; provenance: SmartImportFabricProvenanceWire }> | null {
    const receipt = snapshotSmartImportFabricResolutionReceipt(input.receipt); const provenance = receipt && snapshotSmartImportFabricProvenance(input.provenance, receipt);
    return receipt && provenance ? Object.freeze({ receipt, provenance }) : null;
}
function preview(value: unknown, proposal: (value: unknown) => SmartImportProposalWireV1 | null): SmartImportPreviewWire | null {
    const input = record(value, KEYS); if (!input || input.writesPerformed !== 0 || input.apply !== 'denied') return null;
    if (input.status === 'available') {
        const parsedProposal = proposal(input.proposal); const fabric = metadata(input);
        return !parsedProposal || !fabric || input.code !== null || typeof input.reviewRef !== 'string' || !/^review_[0-9a-f]{32}$/u.test(input.reviewRef) ? null : Object.freeze({ writesPerformed: 0, apply: 'denied', status: 'available', code: null, proposal: parsedProposal, ...fabric, reviewRef: input.reviewRef });
    }
    if (input.status === 'denied') {
        const parsedCode = code(input.code, DENIAL_CODES);
        return !parsedCode || input.proposal !== null || input.receipt !== null || input.provenance !== null || input.reviewRef !== null ? null : Object.freeze({ writesPerformed: 0, apply: 'denied', status: 'denied', code: parsedCode, proposal: null, receipt: null, provenance: null, reviewRef: null });
    }
    if (input.status === 'failed') {
        const parsedCode = code(input.code, FAILURE_CODES); const fabric = metadata(input);
        return !parsedCode || !fabric || input.proposal !== null || input.reviewRef !== null ? null : Object.freeze({ writesPerformed: 0, apply: 'denied', status: 'failed', code: parsedCode, proposal: null, ...fabric, reviewRef: null });
    }
    return null;
}
function root(value: unknown, parser: (value: unknown) => SmartImportPreviewWire | null): SmartImportPreviewWireRoot | null {
    const input = record(value, ['preview']); const parsed = input && parser(input.preview); return parsed ? Object.freeze({ preview: parsed }) : null;
}

/** Converts a host-domain preview result into a detached JSON-wire snapshot. */
export function serializeSmartImportPreviewWire(value: unknown): SmartImportPreviewWire | null { return preview(value, serializePatientSmartImportProposalWire); }
/** Parses a strict Smart Import preview wire snapshot without retaining caller objects. */
export function parseSmartImportPreviewWire(value: unknown): SmartImportPreviewWire | null { return preview(value, parsePatientSmartImportProposalWire); }
export function serializeSmartImportPreviewWireRoot(value: unknown): SmartImportPreviewWireRoot | null { return root(value, serializeSmartImportPreviewWire); }
export function parseSmartImportPreviewWireRoot(value: unknown): SmartImportPreviewWireRoot | null { return root(value, parseSmartImportPreviewWire); }
