/* @Codex */
'use client';

import type { TreatmentReasoningContextInput } from '../../treatment-reasoning-context';
import { createSmartImportContextProposalBrowserAdapter, type SmartImportContextProposal } from '../../security/smart-import-context-proposal-browser-adapter';
import { createSmartImportSelectionBrowserAdapter } from '../../security/smart-import-selection-browser-adapter';
import { EGRESS_PROFILE_VERSION } from './contract';
import { buildTreatmentReasoningProjectionAttachment } from './treatment-reasoning-projection';

export const TREATMENT_REASONING_PUBLICATION_SCHEMA_VERSION = 'mediflow.ai.treatment-reasoning-publication.v1' as const;
type RefList = readonly string[];
export type TreatmentReasoningPublicationSourceBinding = Readonly<{ claimPath: string; claim: string; evidenceRefs: RefList }>;
export type TreatmentReasoningPublicationAttestation = Readonly<{ schema: 'mediflow.ai.treatment-reasoning-athena-attestation.v1'; readiness: 'available_unqualified'; provider: 'athena_mlx'; venue: 'local_process'; egress: 'none'; receiptRef: string; provenanceRef: string }>;
export type TreatmentReasoningPublicationFabricReceipt = Readonly<{ schemaVersion: 'mediflow.ai.fabric-resolution.v1'; capability: 'treatment_reasoning'; class: 'generative'; venue: 'local_process'; egressProfile: Readonly<{ id: 'local_only'; version: typeof EGRESS_PROFILE_VERSION; egress: 'none' }>; provider: 'athena_mlx'; model: null; providerReceipt: null; fallbackCount: 0 }>;
type KeyEvidence = Readonly<{ id: string; statement: string; evidenceRefs: RefList }>;
type SafetyFlag = Readonly<{ id: string; severity: 'info' | 'caution' | 'urgent_review'; label: string; rationale: string; evidenceRefs: RefList }>;
type SuggestedAction = Readonly<{ id: string; intent: 'no_action' | 'review_only' | 'open_therapy_form_prefill' | 'open_monitoring_form_prefill' | 'open_diagnosis_review'; label: string; rationale: string; writePolicy: 'no_write' | 'review_only' | 'form_prefill_only'; evidenceRefs: RefList }>;
export type TreatmentReasoningPublicationValue = Readonly<{ schemaVersion: 'mediflow.treatment_reasoning.v1'; task: 'treatment_reasoning'; summary: string; data: Readonly<{ recommendation: string; keyEvidence: readonly KeyEvidence[]; reasoning: readonly string[]; caveats: readonly string[]; safetyFlags: readonly SafetyFlag[]; suggestedActions: readonly SuggestedAction[]; trace: Readonly<{ mode: 'local_model'; toolsUsed: RefList; limitations: readonly string[] }> }> }>;
export type TreatmentReasoningPublication = Readonly<{
    schemaVersion: typeof TREATMENT_REASONING_PUBLICATION_SCHEMA_VERSION; capability: 'treatment_reasoning'; stage: 'preview'; review: 'required'; status: 'available';
    value: TreatmentReasoningPublicationValue; sourceBindings: readonly TreatmentReasoningPublicationSourceBinding[]; attestation: TreatmentReasoningPublicationAttestation;
    fabricReceipt: TreatmentReasoningPublicationFabricReceipt; provenance: Readonly<{ schemaVersion: 'mediflow.ai.fabric-provenance.v1'; capability: 'treatment_reasoning'; venue: 'local_process'; provider: 'athena_mlx'; model: null; preprocessing: readonly ['context_minimization', 'envelope_validation']; receipt: TreatmentReasoningPublicationFabricReceipt }>;
    sourceRevision: string; capturedAt: string; writesPerformed: 0; applyPolicy: 'none';
}>;

const ROOT_KEYS = ['schemaVersion', 'capability', 'stage', 'review', 'status', 'value', 'sourceBindings', 'attestation', 'fabricReceipt', 'provenance', 'sourceRevision', 'capturedAt', 'writesPerformed', 'applyPolicy'] as const;
const REFERENCE = /^[A-Za-z][A-Za-z0-9._:-]{2,159}$/u;
const REQUEST_ID = /^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u;
const RAW_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PATIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const own = Reflect.ownKeys(value); if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const output: Record<string, unknown> = {};
        for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null; output[key] = descriptor.value; }
        return output;
    } catch { return null; }
}
function array(value: unknown, maximum: number): readonly unknown[] | null {
    try {
        if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return null;
        if (Reflect.ownKeys(value).length !== value.length + 1) return null;
        const output: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null; output.push(descriptor.value); }
        return Object.freeze(output);
    } catch { return null; }
}
function text(value: unknown, maximum: number): string | null {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum && value.trim() === value && !CONTROL.test(value) ? value : null;
}
function ref(value: unknown): string | null { return typeof value === 'string' && REFERENCE.test(value) ? value : null; }
function iso(value: unknown): string | null { try { return typeof value === 'string' && new Date(value).toISOString() === value ? value : null; } catch { return null; } }
function refs(value: unknown, required = false): RefList | null {
    const input = array(value, 16); if (!input || (required && input.length === 0)) return null;
    const output: string[] = [];
    for (const item of input) { const parsed = ref(item); if (!parsed || output.includes(parsed)) return null; output.push(parsed); }
    return Object.freeze(output);
}
function strings(value: unknown, maximum: number, characters: number): readonly string[] | null {
    const input = array(value, maximum); if (!input) return null; const output: string[] = [];
    for (const item of input) { const parsed = text(item, characters); if (!parsed) return null; output.push(parsed); }
    return Object.freeze(output);
}
function keyEvidence(value: unknown): readonly KeyEvidence[] | null {
    const input = array(value, 10); if (!input) return null; const output: KeyEvidence[] = []; const seen = new Set<string>();
    for (const candidate of input) { const item = record(candidate, ['id', 'statement', 'evidenceRefs']); const id = item && ref(item.id); const statement = item && text(item.statement, 400); const evidenceRefs = item && refs(item.evidenceRefs, true); if (!item || !id || !statement || !evidenceRefs || seen.has(id)) return null; seen.add(id); output.push(Object.freeze({ id, statement, evidenceRefs })); }
    return Object.freeze(output);
}
function safetyFlags(value: unknown): readonly SafetyFlag[] | null {
    const input = array(value, 8); if (!input) return null; const output: SafetyFlag[] = []; const seen = new Set<string>();
    for (const candidate of input) { const item = record(candidate, ['id', 'severity', 'label', 'rationale', 'evidenceRefs']); const id = item && ref(item.id); const label = item && text(item.label, 180); const rationale = item && text(item.rationale, 400); const evidenceRefs = item && refs(item.evidenceRefs, true); if (!item || !id || !label || !rationale || !evidenceRefs || !['info', 'caution', 'urgent_review'].includes(item.severity as string) || seen.has(id)) return null; seen.add(id); output.push(Object.freeze({ id, severity: item.severity as SafetyFlag['severity'], label, rationale, evidenceRefs })); }
    return Object.freeze(output);
}
function actions(value: unknown): readonly SuggestedAction[] | null {
    const input = array(value, 8); if (!input) return null; const output: SuggestedAction[] = []; const seen = new Set<string>();
    const intents = ['no_action', 'review_only', 'open_therapy_form_prefill', 'open_monitoring_form_prefill', 'open_diagnosis_review']; const policies = ['no_write', 'review_only', 'form_prefill_only'];
    for (const candidate of input) { const item = record(candidate, ['id', 'intent', 'label', 'rationale', 'writePolicy', 'evidenceRefs']); const id = item && ref(item.id); const label = item && text(item.label, 180); const rationale = item && text(item.rationale, 400); const evidenceRefs = item && refs(item.evidenceRefs, true); if (!item || !id || !label || !rationale || !evidenceRefs || !intents.includes(item.intent as string) || !policies.includes(item.writePolicy as string) || seen.has(id)) return null; seen.add(id); output.push(Object.freeze({ id, intent: item.intent as SuggestedAction['intent'], label, rationale, writePolicy: item.writePolicy as SuggestedAction['writePolicy'], evidenceRefs })); }
    return Object.freeze(output);
}
function publicationValue(value: unknown): TreatmentReasoningPublicationValue | null {
    const root = record(value, ['schemaVersion', 'task', 'summary', 'data']); const summary = root && text(root.summary, 480);
    const data = root && record(root.data, ['recommendation', 'keyEvidence', 'reasoning', 'caveats', 'safetyFlags', 'suggestedActions', 'trace']); const recommendation = data && text(data.recommendation, 900);
    const evidence = data && keyEvidence(data.keyEvidence); const reasoning = data && strings(data.reasoning, 8, 400); const caveats = data && strings(data.caveats, 8, 400); const flags = data && safetyFlags(data.safetyFlags); const suggested = data && actions(data.suggestedActions);
    const trace = data && record(data.trace, ['mode', 'toolsUsed', 'limitations']); const tools = trace && refs(trace.toolsUsed); const limitations = trace && strings(trace.limitations, 8, 180);
    if (!root || root.schemaVersion !== 'mediflow.treatment_reasoning.v1' || root.task !== 'treatment_reasoning' || !summary || !data || !recommendation || !evidence || !reasoning || !caveats || !flags || !suggested || !trace || trace.mode !== 'local_model' || !tools || !limitations) return null;
    return Object.freeze({ schemaVersion: root.schemaVersion, task: root.task, summary, data: Object.freeze({ recommendation, keyEvidence: evidence, reasoning, caveats, safetyFlags: flags, suggestedActions: suggested, trace: Object.freeze({ mode: 'local_model' as const, toolsUsed: tools, limitations }) }) }) as TreatmentReasoningPublicationValue;
}
function sourceBindings(value: unknown, publication: TreatmentReasoningPublicationValue): readonly TreatmentReasoningPublicationSourceBinding[] | null {
    const claims = [{ claimPath: 'summary', claim: publication.summary }, { claimPath: 'data.recommendation', claim: publication.data.recommendation }, ...publication.data.reasoning.map((claim, index) => ({ claimPath: `data.reasoning.${index}`, claim })), ...publication.data.caveats.map((claim, index) => ({ claimPath: `data.caveats.${index}`, claim }))];
    const input = array(value, 18); if (!input || input.length !== claims.length) return null; const output: TreatmentReasoningPublicationSourceBinding[] = [];
    for (let index = 0; index < input.length; index += 1) { const item = record(input[index], ['claimPath', 'claim', 'evidenceRefs']); const expected = claims[index]; const evidenceRefs = item && refs(item.evidenceRefs, true); if (!item || !expected || item.claimPath !== expected.claimPath || item.claim !== expected.claim || !evidenceRefs) return null; output.push(Object.freeze({ claimPath: expected.claimPath, claim: expected.claim, evidenceRefs })); }
    return Object.freeze(output);
}
function attestation(value: unknown): TreatmentReasoningPublicationAttestation | null {
    const item = record(value, ['schema', 'readiness', 'provider', 'venue', 'egress', 'receiptRef', 'provenanceRef']); const receiptRef = item && ref(item.receiptRef); const provenanceRef = item && ref(item.provenanceRef);
    return item && item.schema === 'mediflow.ai.treatment-reasoning-athena-attestation.v1' && item.readiness === 'available_unqualified' && item.provider === 'athena_mlx' && item.venue === 'local_process' && item.egress === 'none' && receiptRef && provenanceRef ? Object.freeze({ schema: item.schema, readiness: item.readiness, provider: item.provider, venue: item.venue, egress: item.egress, receiptRef, provenanceRef }) as TreatmentReasoningPublicationAttestation : null;
}
function fabricReceipt(value: unknown): TreatmentReasoningPublicationFabricReceipt | null {
    const item = record(value, ['schemaVersion', 'capability', 'class', 'venue', 'egressProfile', 'provider', 'model', 'providerReceipt', 'fallbackCount']); const profile = item && record(item.egressProfile, ['id', 'version', 'egress']);
    if (!item || !profile || item.schemaVersion !== 'mediflow.ai.fabric-resolution.v1' || item.capability !== 'treatment_reasoning' || item.class !== 'generative' || item.venue !== 'local_process' || profile.id !== 'local_only' || profile.version !== EGRESS_PROFILE_VERSION || profile.egress !== 'none' || item.provider !== 'athena_mlx' || item.model !== null || item.providerReceipt !== null || item.fallbackCount !== 0) return null;
    return Object.freeze({ schemaVersion: item.schemaVersion, capability: item.capability, class: item.class, venue: item.venue, egressProfile: Object.freeze({ id: profile.id, version: profile.version, egress: profile.egress }), provider: item.provider, model: null, providerReceipt: null, fallbackCount: 0 }) as TreatmentReasoningPublicationFabricReceipt;
}
function receiptMatches(left: TreatmentReasoningPublicationFabricReceipt, right: TreatmentReasoningPublicationFabricReceipt): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function publicationUsesOnly(value: TreatmentReasoningPublication, allowedRefs: readonly string[]): boolean {
    const allowed = new Set(allowedRefs); const groups = [
        ...value.value.data.keyEvidence.map((item) => item.evidenceRefs),
        ...value.value.data.safetyFlags.map((item) => item.evidenceRefs),
        ...value.value.data.suggestedActions.map((item) => item.evidenceRefs),
        ...value.sourceBindings.map((item) => item.evidenceRefs),
    ];
    return groups.every((group) => group.every((item) => allowed.has(item)));
}

/** Strict client projection of the only review-only Treatment Reasoning success wire. */
export function parseTreatmentReasoningPublication(value: unknown): TreatmentReasoningPublication | null {
    const root = record(value, ROOT_KEYS); const parsedValue = root && publicationValue(root.value); const bindings = root && parsedValue && sourceBindings(root.sourceBindings, parsedValue); const hostAttestation = root && attestation(root.attestation); const receipt = root && fabricReceipt(root.fabricReceipt);
    const provenance = root && record(root.provenance, ['schemaVersion', 'capability', 'venue', 'provider', 'model', 'preprocessing', 'receipt']); const preprocessing = provenance && array(provenance.preprocessing, 2); const provenanceReceipt = provenance && fabricReceipt(provenance.receipt); const sourceRevision = root && ref(root.sourceRevision); const capturedAt = root && iso(root.capturedAt);
    if (!root || root.schemaVersion !== TREATMENT_REASONING_PUBLICATION_SCHEMA_VERSION || root.capability !== 'treatment_reasoning' || root.stage !== 'preview' || root.review !== 'required' || root.status !== 'available' || !parsedValue || !bindings || !hostAttestation || !receipt || !provenance || provenance.schemaVersion !== 'mediflow.ai.fabric-provenance.v1' || provenance.capability !== 'treatment_reasoning' || provenance.venue !== 'local_process' || provenance.provider !== 'athena_mlx' || provenance.model !== null || !preprocessing || preprocessing[0] !== 'context_minimization' || preprocessing[1] !== 'envelope_validation' || !provenanceReceipt || !receiptMatches(receipt, provenanceReceipt) || !sourceRevision || !capturedAt || root.writesPerformed !== 0 || root.applyPolicy !== 'none') return null;
    return Object.freeze({ schemaVersion: root.schemaVersion, capability: root.capability, stage: root.stage, review: root.review, status: root.status, value: parsedValue, sourceBindings: bindings, attestation: hostAttestation, fabricReceipt: receipt, provenance: Object.freeze({ schemaVersion: provenance.schemaVersion, capability: provenance.capability, venue: provenance.venue, provider: provenance.provider, model: null, preprocessing: Object.freeze(['context_minimization', 'envelope_validation'] as const), receipt: provenanceReceipt }), sourceRevision, capturedAt, writesPerformed: 0, applyPolicy: 'none' }) as TreatmentReasoningPublication;
}

type Sources = Readonly<{ fetch?: typeof fetch; clock?: () => Date; requestId?: () => unknown }>;
export type TreatmentReasoningBrowserControllerErrorCode = 'confirmation_required' | 'input_invalid' | 'proposal_stale' | 'selection_invalid' | 'operation_superseded' | 'ingest_unavailable' | 'ingest_outcome_unknown' | 'preview_unavailable' | 'preview_outcome_unknown' | 'response_invalid';
export class TreatmentReasoningBrowserControllerError extends Error { constructor(readonly code: TreatmentReasoningBrowserControllerErrorCode) { super('Treatment Reasoning preview non disponibile.'); this.name = 'TreatmentReasoningBrowserControllerError'; } }
function fail(code: TreatmentReasoningBrowserControllerErrorCode): never { throw new TreatmentReasoningBrowserControllerError(code); }
function identifier(): string { const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes); return `req_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`; }
function inputContext(value: unknown, patientId: string): TreatmentReasoningContextInput | null {
    try {
        if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const allowed = ['patient', 'entries', 'therapies', 'observations', 'attachments']; const keys = Reflect.ownKeys(value);
        if (keys.some((key) => typeof key !== 'string' || !allowed.includes(key)) || !keys.includes('patient')) return null;
        const output: Record<string, unknown> = {};
        for (const key of keys as string[]) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null; output[key] = descriptor.value; }
        const patient = record(output.patient, Reflect.ownKeys(output.patient as object).filter((key): key is string => typeof key === 'string'));
        if (!patient || patient.id !== patientId) return null;
        return output as unknown as TreatmentReasoningContextInput;
    } catch { return null; }
}
async function post(request: typeof fetch, path: string, body: unknown, unknownCode: TreatmentReasoningBrowserControllerErrorCode, unavailableCode: TreatmentReasoningBrowserControllerErrorCode): Promise<Response> {
    try { const response = await request(path, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return response.ok ? response : fail(unavailableCode); }
    catch (error) { if (error instanceof TreatmentReasoningBrowserControllerError) throw error; return fail(unknownCode); }
}

/** Manual browser flow; selection is confirmed before the minimized projection is captured. */
export function createTreatmentReasoningBrowserController(sources: Sources = {}) {
    const request = sources.fetch ?? globalThis.fetch; const clock = sources.clock ?? (() => new Date()); const nextId = sources.requestId ?? identifier;
    const context = createSmartImportContextProposalBrowserAdapter({ fetch: request }); const selection = createSmartImportSelectionBrowserAdapter({ fetch: request });
    let proposal: SmartImportContextProposal | null = null; let generation = 0; let operation = 0; let readOperation = 0;
    const reset = () => { generation += 1; operation += 1; readOperation += 1; proposal = null; selection.reset(); };
    return Object.freeze({
        reset,
        async readProposal(): Promise<SmartImportContextProposal> {
            proposal = null; const token = generation; const currentRead = ++readOperation;
            try { const value = await context.read(); if (token !== generation || currentRead !== readOperation) return fail('operation_superseded'); proposal = value; return value; }
            catch (error) { if (token !== generation || currentRead !== readOperation) return fail('operation_superseded'); throw error; }
        },
        async run(value: unknown, confirmed: true): Promise<TreatmentReasoningPublication> {
            if (confirmed !== true) return fail('confirmation_required'); const input = record(value, ['patientId', 'proposal', 'contextInput']);
            if (!input || typeof input.patientId !== 'string' || !PATIENT_ID.test(input.patientId)) return fail('input_invalid');
            if (proposal === null || input.proposal !== proposal) return fail('proposal_stale'); const selectedProposal = proposal; proposal = null; readOperation += 1;
            const clinicalContext = inputContext(input.contextInput, input.patientId); if (!clinicalContext) return fail('input_invalid');
            const token = generation; const currentOperation = ++operation; let selected: unknown = null;
            const current = () => { if (token !== generation || currentOperation !== operation) return fail('operation_superseded'); if (selected && !selection.isCurrent(selected)) return fail('selection_invalid'); };
            try {
                await selection.initialize(); current(); selected = await selection.select({ patientId: input.patientId, ambulatoryId: selectedProposal.ambulatoryId }, true); current();
                let now: Date; try { now = clock(); if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return fail('input_invalid'); } catch { return fail('input_invalid'); }
                let projection: ReturnType<typeof buildTreatmentReasoningProjectionAttachment>; try { projection = buildTreatmentReasoningProjectionAttachment({ ...clinicalContext, now }); } catch { return fail('input_invalid'); } current();
                let ingestId: unknown; let previewId: unknown; try { ingestId = nextId(); previewId = nextId(); } catch { return fail('input_invalid'); }
                if (typeof ingestId !== 'string' || typeof previewId !== 'string' || ingestId === previewId || RAW_UUID.test(ingestId) || RAW_UUID.test(previewId) || !REQUEST_ID.test(ingestId) || !REQUEST_ID.test(previewId)) return fail('input_invalid');
                const ingestResponse = await post(request, '/api/ai/treatment-reasoning/ingest', { projection, requestId: ingestId }, 'ingest_outcome_unknown', 'ingest_unavailable'); current();
                let ingestBody: unknown; try { ingestBody = await ingestResponse.json(); } catch { return fail('response_invalid'); } current();
                const ingested = record(ingestBody, ['handle']); if (!ingested || typeof ingested.handle !== 'string' || !/^trp_[0-9a-f]{32}$/u.test(ingested.handle)) return fail('response_invalid');
                const previewResponse = await post(request, '/api/ai/treatment-reasoning/preview', { handle: ingested.handle, requestId: previewId }, 'preview_outcome_unknown', 'preview_unavailable'); current();
                let previewBody: unknown; try { previewBody = await previewResponse.json(); } catch { return fail('response_invalid'); } current();
                const publication = parseTreatmentReasoningPublication(previewBody); if (!publication || publication.sourceRevision !== projection.sourceRevision || publication.capturedAt !== projection.capturedAt || !publicationUsesOnly(publication, projection.evidenceRefs)) return fail('response_invalid'); current(); return publication;
            } catch (error) { current(); throw error; }
        },
    });
}
