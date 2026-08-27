/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { sql } from 'drizzle-orm';

import { dbServer } from '../../db-server';
import { resolveDocumentSynthesisHostProjection } from './document-synthesis-host-projection';
import { acquireAuthenticatedWebSessionProjectionOwnerContext } from '../../security/server-auth';
import { registerServerSessionResource } from '../../security/server-session';
import type {
    DocumentSynthesisAttachmentCaptureCapability,
    DocumentSynthesisAttachmentIngestGrant,
    DocumentSynthesisAttachmentCapturePort,
    DocumentSynthesisProjectionEvidenceCapability,
    DocumentSynthesisSourceSetSealCapability,
} from '../../security/server-session-projection-owner';

type Currentness = Readonly<{ documentSourceRef: string; documentRevision: number; documentFreshnessEpoch: number }>;
type CaptureRecord = Readonly<{
    selected: true; currentness: Currentness; selectionEpoch: number; reviewContextEpoch: number;
    scope: 'document_synthesis_attachment_capture'; revocationGeneration: number;
    attachmentCapturePort: DocumentSynthesisAttachmentCapturePort;
    attachmentCaptureCapability: DocumentSynthesisAttachmentCaptureCapability;
}>;
type ProjectionRecord = Readonly<{ selected: true; scope: 'document_synthesis_attachment_projection'; evidence: DocumentSynthesisProjectionEvidenceCapability;
    attachmentCapturePort: DocumentSynthesisAttachmentCapturePort }>;
type SourceSetSealRecord = Readonly<{ selected: true; scope: 'document_synthesis_attachment_source_set_seal'; seal: DocumentSynthesisSourceSetSealCapability }>;
type PreparedProjectionPublication = Readonly<{ projectionHandle: string; state: ProjectionRecord; result: ProjectionResult }>;
type PreparedSourceSetSealPublication = Readonly<{ sourceSetSealHandle: string; state: SourceSetSealRecord; result: SourceSetSealResult }>;
type RecordState = CaptureRecord | ProjectionRecord | SourceSetSealRecord;
type Broker = { records: Map<string, RecordState>; dispose: () => void; publish: (handle: string, state: RecordState) => boolean };
type Result = Readonly<{ status: 'available' | 'denied'; code: null | 'input_invalid' | 'unavailable'; captureHandle: string | null; reviewOnly: true; writesPerformed: 0; applyPolicy: 'none' }>;
type ProjectionResult = Readonly<{ status: 'available' | 'denied'; code: null | 'input_invalid' | 'unavailable'; projectionHandle: string | null; reviewOnly: true; writesPerformed: 0; applyPolicy: 'none' }>;
type SourceSetSealResult = Readonly<{ status: 'available' | 'denied'; code: null | 'input_invalid' | 'unavailable'; sourceSetSealHandle: string | null }>;

const OBJECT = Object.prototype; const KEYS = ['attachmentId'] as const; const PROJECTION_KEYS = ['sourceKind', 'sourceText'] as const; const ROW_KEYS = ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch'] as const;
const HANDLE = /^dsc_[a-f0-9]{32}$/u; const PROJECTION_HANDLE = /^dsp_[a-f0-9]{32}$/u; const SOURCE_SET_SEAL_HANDLE = /^dss_[a-f0-9]{32}$/u; const SOURCE_REF = /^[0-9a-f]{64}$/u; const MAX_ID = 256;
const ObjectCreate = Object.create; const ObjectFreeze = Object.freeze; const ObjectAssign = Object.assign; const ObjectHasOwn = Object.hasOwn;
const ObjectGetPrototypeOf = Object.getPrototypeOf; const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor; const ObjectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const ReflectOwnKeys = Reflect.ownKeys; const ArrayIsArray = Array.isArray; const NumberIsSafeInteger = Number.isSafeInteger; const Uint8ArrayConstructor = Uint8Array;
const StringTrim = Function.call.bind(String.prototype.trim) as (value: string) => string; const RegExpTest = Function.call.bind(RegExp.prototype.test) as (expression: RegExp, value: string) => boolean;
const MapConstructor = Map; const WeakMapConstructor = WeakMap; const mapGet = Function.call.bind(Map.prototype.get) as <T>(map: Map<string, T>, key: string) => T | undefined; const mapHas = Function.call.bind(Map.prototype.has) as (map: Map<string, unknown>, key: string) => boolean; const mapSet = Function.call.bind(Map.prototype.set) as (map: Map<string, unknown>, key: string, value: unknown) => Map<string, unknown>; const mapDelete = Function.call.bind(Map.prototype.delete) as (map: Map<string, unknown>, key: string) => boolean; const mapClear = Function.call.bind(Map.prototype.clear) as (map: Map<string, unknown>) => void;
const weakMapGet = Function.call.bind(WeakMap.prototype.get) as <T>(map: WeakMap<object, T>, key: object) => T | undefined; const weakMapSet = Function.call.bind(WeakMap.prototype.set) as <T>(map: WeakMap<object, T>, key: object, value: T) => WeakMap<object, T>; const weakMapDelete = Function.call.bind(WeakMap.prototype.delete) as <T>(map: WeakMap<object, T>, key: object) => boolean;
const IsProxy = types.isProxy; const IsPromise = types.isPromise; const DbGet = dbServer.get.bind(dbServer); const Entropy = randomBytes;

function sealed<T extends Record<string, unknown>>(value: T): Readonly<T> { return ObjectFreeze(ObjectAssign(ObjectCreate(null) as T, value)); }
function denied(code: 'input_invalid' | 'unavailable'): Result { return sealed({ status: 'denied' as const, code, captureHandle: null, reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const }); }
function available(captureHandle: string): Result { return sealed({ status: 'available' as const, code: null, captureHandle, reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const }); }
function projectionDenied(code: 'input_invalid' | 'unavailable'): ProjectionResult { return sealed({ status: 'denied' as const, code, projectionHandle: null, reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const }); }
function projectionAvailable(projectionHandle: string): ProjectionResult { return sealed({ status: 'available' as const, code: null, projectionHandle, reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const }); }
function sourceSetSealDenied(code: 'input_invalid' | 'unavailable'): SourceSetSealResult { return sealed({ status: 'denied' as const, code, sourceSetSealHandle: null }); }
function sourceSetSealAvailable(sourceSetSealHandle: string): SourceSetSealResult { return sealed({ status: 'available' as const, code: null, sourceSetSealHandle }); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null { try { if (typeof value !== 'object' || value === null || IsProxy(value) || ArrayIsArray(value) || ObjectGetPrototypeOf(value) !== OBJECT || ReflectOwnKeys(value).length !== keys.length) return null; const descriptors = ObjectGetOwnPropertyDescriptors(value); const output = ObjectCreate(null) as Record<string, unknown>; for (const key of keys) { const descriptor = ObjectGetOwnPropertyDescriptor(descriptors, key); if (!descriptor || !ObjectHasOwn(descriptor, 'value')) return null; const field = descriptor.value as PropertyDescriptor; if (!field || field.enumerable !== true || !ObjectHasOwn(field, 'value')) return null; output[key] = field.value; } return output; } catch { return null; } }
function intent(value: unknown): string | null { const id = exact(value, KEYS)?.attachmentId; return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID && id === StringTrim(id) ? id : null; }
function currentness(value: unknown): Currentness | null { const row = IsPromise(value) ? null : exact(value, ROW_KEYS); if (!row || typeof row.documentSourceRef !== 'string' || !RegExpTest(SOURCE_REF, row.documentSourceRef) || typeof row.documentRevision !== 'number' || !NumberIsSafeInteger(row.documentRevision) || row.documentRevision < 1 || typeof row.documentFreshnessEpoch !== 'number' || !NumberIsSafeInteger(row.documentFreshnessEpoch) || row.documentFreshnessEpoch < 1) return null; return sealed({ documentSourceRef: row.documentSourceRef, documentRevision: row.documentRevision, documentFreshnessEpoch: row.documentFreshnessEpoch }); }
function ownerCurrentness(value: Currentness): Readonly<{ documentSourceRef: string; documentRevision: number; documentFreshnessEpoch: number }> { return ObjectFreeze({ documentSourceRef: value.documentSourceRef, documentRevision: value.documentRevision, documentFreshnessEpoch: value.documentFreshnessEpoch }); }
function sameCurrentness(left: Currentness, right: Currentness): boolean { return left.documentSourceRef === right.documentSourceRef && left.documentRevision === right.documentRevision && left.documentFreshnessEpoch === right.documentFreshnessEpoch; }
function mint(bytes: unknown, prefix: 'dsc_' | 'dsp_' | 'dss_'): string | null { if (!(bytes instanceof Uint8ArrayConstructor) || IsProxy(bytes) || bytes.length !== 16) return null; let value = prefix; for (let index = 0; index < 16; index += 1) { const byte = bytes[index]; if (typeof byte !== 'number' || !NumberIsSafeInteger(byte) || byte < 0 || byte > 255) return null; value += '0123456789abcdef'[byte >>> 4]! + '0123456789abcdef'[byte & 15]!; } return RegExpTest(prefix === 'dsc_' ? HANDLE : prefix === 'dsp_' ? PROJECTION_HANDLE : SOURCE_SET_SEAL_HANDLE, value) ? value : null; }
function projectionCandidate(value: unknown): Readonly<{ sourceKind: 'native_text' | 'ocr_text'; sourceText: string }> | null { const input = exact(value, PROJECTION_KEYS); if (!input) return null; try { const normalized = resolveDocumentSynthesisHostProjection(ObjectFreeze({ sourceKind: input.sourceKind, sourceText: input.sourceText })); return ObjectFreeze({ sourceKind: normalized.sourceKind, sourceText: normalized.sourceText }); } catch { return null; } }
function revoke(port: DocumentSynthesisAttachmentCapturePort, value: unknown): void { try { port.observeRevocation(value); } catch { /* denial remains terminal */ } }

const ownerBrokers = new WeakMapConstructor<object, WeakMap<object, Broker>>();
function brokerFor(context: NonNullable<Awaited<ReturnType<typeof acquireAuthenticatedWebSessionProjectionOwnerContext>>>): Broker {
    let sessions = weakMapGet(ownerBrokers, context.owner); if (!sessions) { sessions = new WeakMapConstructor<object, Broker>(); weakMapSet(ownerBrokers, context.owner, sessions); }
    const prior = weakMapGet(sessions, context.session); if (prior) return prior;
    const records = new MapConstructor<string, RecordState>(); let disposed = false; let unregister: (() => void) | null = null;
    const dispose = () => { if (disposed) return; disposed = true; mapClear(records); try { unregister?.(); } catch { /* disposal remains final */ } unregister = null; weakMapDelete(sessions!, context.session); };
    const broker: Broker = { records, dispose, publish(handle, state) { if (disposed || mapHas(records, handle)) return false; let registered: (() => void) | null; try { registered = unregister ?? registerServerSessionResource(context.session.id, dispose); } catch { return false; } if (!registered || disposed || mapHas(records, handle)) return false; unregister = registered; mapSet(records, handle, state); return true; } };
    weakMapSet(sessions, context.session, broker); return broker;
}

/** Fixed server-only I1b boundary: accepts the sole own-data attachment intent and returns an opaque capture handle. */
export async function captureDocumentSynthesisAuthenticatedAttachment(input: unknown): Promise<Result> {
    const attachmentId = intent(input); if (!attachmentId) return denied('input_invalid');
    let context: Awaited<ReturnType<typeof acquireAuthenticatedWebSessionProjectionOwnerContext>>;
    try { context = await acquireAuthenticatedWebSessionProjectionOwnerContext(); } catch { return denied('unavailable'); }
    if (!context) return denied('unavailable');
    try { const broker = brokerFor(context); const attachmentCapturePort = context.owner.mintDocumentSynthesisAttachmentCapturePort(context.session); return context.owner.withLeaseCriticalSection(context.session, (selection) => { const tuple = currentness(DbGet(sql`SELECT a.document_source_ref AS documentSourceRef, a.document_revision AS documentRevision, a.document_freshness_epoch AS documentFreshnessEpoch FROM attachments AS a INNER JOIN patients_to_ambulatories AS pta ON pta.patient_id = a.patient_id WHERE a.id = ${attachmentId} AND a.patient_id = ${selection.patientId} AND pta.ambulatory_id = ${selection.ambulatoryId} LIMIT 1`)); if (!tuple) return denied('unavailable'); const attachmentCaptureCapability = attachmentCapturePort.observeCurrentness(ownerCurrentness(tuple)); if (!attachmentCaptureCapability) return denied('unavailable'); const captureHandle = mint(Entropy(16), 'dsc_'); if (!captureHandle) return denied('unavailable'); const state = sealed<CaptureRecord>({ selected: true, currentness: tuple, selectionEpoch: context.owner.snapshotSelectionEpoch(context.session), reviewContextEpoch: context.owner.snapshotReviewContextEpoch(context.session), scope: 'document_synthesis_attachment_capture', revocationGeneration: 0, attachmentCapturePort, attachmentCaptureCapability }); return broker.publish(captureHandle, state) ? available(captureHandle) : denied('unavailable'); }); } catch { return denied('unavailable'); }
}

/** Fixed server-only I1b2 boundary: burns a capture before pure projection normalization and retains only owner-bound evidence. */
export async function ingestDocumentSynthesisAuthenticatedAttachmentProjection(captureHandle: unknown, projection: unknown): Promise<ProjectionResult> {
    if (typeof captureHandle !== 'string' || !RegExpTest(HANDLE, captureHandle)) return projectionDenied('input_invalid');
    let context: Awaited<ReturnType<typeof acquireAuthenticatedWebSessionProjectionOwnerContext>>;
    try { context = await acquireAuthenticatedWebSessionProjectionOwnerContext(); } catch { return projectionDenied('unavailable'); }
    if (!context) return projectionDenied('unavailable');
    let captured: CaptureRecord | null = null; let grant: DocumentSynthesisAttachmentIngestGrant | null = null; let evidence: DocumentSynthesisProjectionEvidenceCapability | null = null; let failureCode: 'input_invalid' | 'unavailable' = 'unavailable';
    try {
        const broker = brokerFor(context); const record = mapGet(broker.records, captureHandle);
        if (!record || record.scope !== 'document_synthesis_attachment_capture' || !mapDelete(broker.records, captureHandle)) return projectionDenied('unavailable');
        captured = record;
        const prepared = context.owner.withLeaseCriticalSection(context.session, (selection): PreparedProjectionPublication | null => {
            if (context.owner.snapshotSelectionEpoch(context.session) !== captured!.selectionEpoch
                || context.owner.snapshotReviewContextEpoch(context.session) !== captured!.reviewContextEpoch) return null;
            const candidate = projectionCandidate(projection);
            if (!candidate) { failureCode = 'input_invalid'; return null; }
            const latest = currentness(DbGet(sql`SELECT a.document_source_ref AS documentSourceRef, a.document_revision AS documentRevision, a.document_freshness_epoch AS documentFreshnessEpoch FROM attachments AS a INNER JOIN patients_to_ambulatories AS pta ON pta.patient_id = a.patient_id WHERE a.document_source_ref = ${captured!.currentness.documentSourceRef} AND a.document_revision = ${captured!.currentness.documentRevision} AND a.document_freshness_epoch = ${captured!.currentness.documentFreshnessEpoch} AND a.patient_id = ${selection.patientId} AND pta.ambulatory_id = ${selection.ambulatoryId} LIMIT 1`));
            if (!latest || !sameCurrentness(captured!.currentness, latest)) return null;
            grant = captured!.attachmentCapturePort.begin(captured!.attachmentCaptureCapability);
            if (!grant) return null;
            evidence = captured!.attachmentCapturePort.retain(ObjectFreeze({ grant, observedCurrentness: ownerCurrentness(latest), projection: candidate }));
            if (!evidence) return null;
            const projectionHandle = mint(Entropy(16), 'dsp_');
            if (!projectionHandle) return null;
            return sealed<PreparedProjectionPublication>({ projectionHandle, state: sealed<ProjectionRecord>({ selected: true, scope: 'document_synthesis_attachment_projection', evidence, attachmentCapturePort: captured!.attachmentCapturePort }), result: projectionAvailable(projectionHandle) });
        });
        if (!prepared) { revoke(captured.attachmentCapturePort, evidence ?? grant ?? captured.attachmentCaptureCapability); return projectionDenied(failureCode); }
        if (!broker.publish(prepared.projectionHandle, prepared.state)) { revoke(captured.attachmentCapturePort, prepared.state.evidence); return projectionDenied('unavailable'); }
        return prepared.result;
    } catch { if (captured) revoke(captured.attachmentCapturePort, evidence ?? grant ?? captured.attachmentCaptureCapability); return projectionDenied('unavailable'); }
}

/** Fixed server-only A1b2 boundary: burns a projection handle, then publishes an opaque owner-private source-set seal. */
export async function sealDocumentSynthesisAuthenticatedAttachmentSourceSet(projectionHandle: unknown): Promise<SourceSetSealResult> {
    if (typeof projectionHandle !== 'string' || !RegExpTest(PROJECTION_HANDLE, projectionHandle)) return sourceSetSealDenied('input_invalid');
    const unpublished: { seal: DocumentSynthesisSourceSetSealCapability | null; port: DocumentSynthesisAttachmentCapturePort | null } = { seal: null, port: null };
    try {
        const context = await acquireAuthenticatedWebSessionProjectionOwnerContext();
        if (!context) return sourceSetSealDenied('unavailable');
        const broker = brokerFor(context); const record = mapGet(broker.records, projectionHandle);
        if (!record || record.scope !== 'document_synthesis_attachment_projection' || !mapDelete(broker.records, projectionHandle)) return sourceSetSealDenied('unavailable');
        const prepared = context.owner.withLeaseCriticalSection(context.session, (): PreparedSourceSetSealPublication | null => {
            const seal = record.attachmentCapturePort.sealRetainedProjection(record.evidence);
            if (!seal) return null;
            unpublished.seal = seal;
            unpublished.port = record.attachmentCapturePort;
            const sourceSetSealHandle = mint(Entropy(16), 'dss_');
            if (!sourceSetSealHandle) { revoke(record.attachmentCapturePort, seal); unpublished.seal = null; unpublished.port = null; return null; }
            const value = sealed<PreparedSourceSetSealPublication>({ sourceSetSealHandle,
                state: sealed<SourceSetSealRecord>({ selected: true, scope: 'document_synthesis_attachment_source_set_seal', seal }),
                result: sourceSetSealAvailable(sourceSetSealHandle) });
            return value;
        });
        if (!prepared) return sourceSetSealDenied('unavailable');
        if (!broker.publish(prepared.sourceSetSealHandle, prepared.state)) {
            revoke(record.attachmentCapturePort, prepared.state.seal); unpublished.seal = null; unpublished.port = null;
            return sourceSetSealDenied('unavailable');
        }
        unpublished.seal = null;
        unpublished.port = null;
        return prepared.result;
    } catch {
        if (unpublished.seal && unpublished.port) revoke(unpublished.port, unpublished.seal);
        return sourceSetSealDenied('unavailable');
    }
}
