/* @Codex */
import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { sql } from 'drizzle-orm';

import { AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY, isAiDocumentSynthesisEnabledValue } from '@/lib/ai-document-synthesis-kill-switch';
import { dbServer } from '@/lib/db-server';
import { acquireAuthenticatedWebSessionProjectionOwnerContext, type AuthenticatedWebSessionProjectionOwnerContext } from '@/lib/security/server-auth';
import { isServerSessionProjectionOwner } from '@/lib/security/server-session-projection-owner';
import { registerServerSessionResource } from '@/lib/security/server-session';
import type { ServerSession } from '@/lib/security/server-session';
import { composeAnyDocCurrentSourceExtraction } from '@/lib/domain/documents/anydoc-current-source-composition';
import {
    ANYDOC_LOCAL_OCR_PROVENANCE_SCHEMA_VERSION,
    type LocalExtractionReceipt,
    type LocalExtractionResult,
} from '@/lib/domain/documents/anydoc-local-extraction-contract';
import { createDocumentSynthesisFabricProductionComposition } from './document-synthesis-fabric-production-composition';
import { resolveDocumentSynthesisHostProjection } from './document-synthesis-host-projection';
import { captureDocumentSynthesisSourceSet } from './document-synthesis-source-set-contract';
import { createDocumentSynthesisSourceSetCurrentnessOwner } from './document-synthesis-source-set-currentness-owner';

type Currentness = Readonly<{ documentSourceRef: string; documentRevision: number; documentFreshnessEpoch: number }>;
type Pair = Readonly<{ patientId: string; ambulatoryId: string }>;
type Capture = Readonly<{ attachmentId: string; pair: Pair; currentness: Currentness; selectionEpoch: number; reviewContextEpoch: number }>;
type Preview = Capture & Readonly<{ sourceText: string; sourceSetEpoch: bigint }>;
type Broker = { captures: Map<string, Capture>; previews: Map<string, Preview>; handles: Set<string>; nextEpoch: bigint; dispose(): void };

type DenialCode = 'input_invalid' | 'operation_unavailable' | 'capture_consumed' | 'preview_consumed'
    | 'selection_changed' | 'currentness_mismatch' | 'lane_disabled' | 'unsupported_local_extraction';
type CaptureResult = Readonly<{ status: 'available'; code: null; captureHandle: string }>
    | Readonly<{ status: 'denied'; code: DenialCode; captureHandle: null }>;
type IngestResult = Readonly<{ status: 'available'; code: null; previewHandle: string }>
    | Readonly<{ status: 'denied'; code: DenialCode; previewHandle: null }>;
type PreviewResult = Readonly<{ status: 'available'; code: null; publication: unknown }>
    | Readonly<{ status: 'denied'; code: DenialCode; publication: null }>;
export type DocumentSynthesisProductionOperation = Readonly<{
    capture(input: unknown): Promise<CaptureResult>;
    ingest(input: unknown): Promise<IngestResult>;
    preview(input: unknown): Promise<PreviewResult>;
}>;

type Dependencies = Readonly<{
    acquireContext(): Promise<AuthenticatedWebSessionProjectionOwnerContext | null>;
    readCurrentness(attachmentId: string, patientId: string, ambulatoryId: string): unknown;
    readLaneEnabled(): unknown;
    extract(session: ServerSession, attachmentId: string): Promise<LocalExtractionResult>;
    execute(configuration: unknown): Promise<unknown>;
    entropy(): unknown;
    registerResource(context: AuthenticatedWebSessionProjectionOwnerContext, dispose: () => void): (() => void) | null;
}>;

const CAPTURE_HANDLE = /^dsc_[0-9a-f]{32}$/u; const PREVIEW_HANDLE = /^dsp_[0-9a-f]{32}$/u; const SOURCE_REF = /^[a-f0-9]{64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_U64 = BigInt('18446744073709551615');
const MAX_SESSION_HANDLES = 256;
const TEST_HARNESS = process.execArgv.some((argument) => argument === '--test' || argument.startsWith('--test=') || argument.startsWith('--test-'));
const brokers = new WeakMap<object, WeakMap<object, Broker>>();

function captureDenied(code: DenialCode): CaptureResult { return Object.freeze({ status: 'denied', code, captureHandle: null }); }
function ingestDenied(code: DenialCode): IngestResult { return Object.freeze({ status: 'denied', code, previewHandle: null }); }
function previewDenied(code: DenialCode): PreviewResult { return Object.freeze({ status: 'denied', code, publication: null }); }

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const own = Reflect.ownKeys(value); if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const output: Record<string, unknown> = {};
        for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null; output[key] = descriptor.value; }
        return output;
    } catch { return null; }
}

function extractionSourceKind(receipt: LocalExtractionReceipt): 'native_text' | 'ocr_text' | null {
    try {
        const descriptor = Object.getOwnPropertyDescriptor(receipt, 'ocrProvenance');
        if (!descriptor) return 'native_text';
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
        const value = descriptor.value;
        if (typeof value !== 'object' || value === null || types.isProxy(value)) return null;
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) return null;
        const keys = ['schemaVersion', 'engine', 'scriptSha256', 'pageCount', 'ocrPageCount', 'receiptSetSha256'];
        const own = Reflect.ownKeys(value); const fields = Object.getOwnPropertyDescriptors(value);
        if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        for (const key of keys) if (!fields[key]?.enumerable || !Object.hasOwn(fields[key]!, 'value')) return null;
        const schemaVersion = fields.schemaVersion!.value; const engine = fields.engine!.value;
        const scriptSha256 = fields.scriptSha256!.value; const receiptSetSha256 = fields.receiptSetSha256!.value;
        const pageCount = fields.pageCount!.value; const ocrPageCount = fields.ocrPageCount!.value;
        return schemaVersion === ANYDOC_LOCAL_OCR_PROVENANCE_SCHEMA_VERSION && engine === 'apple_vision'
            && typeof scriptSha256 === 'string' && SHA256.test(scriptSha256)
            && typeof receiptSetSha256 === 'string' && SHA256.test(receiptSetSha256)
            && Number.isSafeInteger(pageCount) && pageCount >= 1 && pageCount <= 500
            && Number.isSafeInteger(ocrPageCount) && ocrPageCount >= 1 && ocrPageCount <= pageCount
            ? 'ocr_text' : null;
    } catch { return null; }
}

function parseCurrentness(value: unknown): Currentness | null {
    const input = exact(value, ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch']);
    return input && typeof input.documentSourceRef === 'string' && SOURCE_REF.test(input.documentSourceRef)
        && Number.isSafeInteger(input.documentRevision) && (input.documentRevision as number) >= 1
        && Number.isSafeInteger(input.documentFreshnessEpoch) && (input.documentFreshnessEpoch as number) >= 1
        ? Object.freeze({ documentSourceRef: input.documentSourceRef, documentRevision: input.documentRevision as number, documentFreshnessEpoch: input.documentFreshnessEpoch as number }) : null;
}

function sameCurrentness(left: Currentness, right: Currentness | null): boolean {
    return !!right && left.documentSourceRef === right.documentSourceRef && left.documentRevision === right.documentRevision
        && left.documentFreshnessEpoch === right.documentFreshnessEpoch;
}

export function resolveDocumentSynthesisAnyDocProjection(
    result: LocalExtractionResult, attachmentId: string,
): ReturnType<typeof resolveDocumentSynthesisHostProjection> | null {
    try {
        if (result.status !== 'extracted' || result.provenance.attachmentId !== attachmentId || result.review !== 'required'
            || result.writes !== 0 || result.apply !== 'none' || result.candidateUse !== 'review_only'
            || result.receipt.parser !== 'anydoc-local' || result.receipt.outcome !== 'extracted'
            || result.receipt.sourceSha256 !== result.provenance.sourceSha256
            || result.receipt.sourceByteLength !== result.provenance.byteLength
            || typeof result.receipt.markdownSha256 !== 'string'
            || result.receipt.markdownByteLength !== Buffer.byteLength(result.markdown, 'utf8')
            || createHash('sha256').update(result.markdown, 'utf8').digest('hex') !== result.receipt.markdownSha256) return null;
        const sourceKind = extractionSourceKind(result.receipt);
        return sourceKind ? resolveDocumentSynthesisHostProjection({ sourceKind, sourceText: result.markdown }) : null;
    } catch { return null; }
}

function mint(prefix: 'dsc_' | 'dsp_', value: unknown): string | null {
    if (!(value instanceof Uint8Array) || types.isProxy(value) || value.length !== 16) return null;
    let output = prefix;
    for (let index = 0; index < value.length; index += 1) { const byte = value[index]; if (!Number.isSafeInteger(byte) || byte < 0 || byte > 255) return null; output += byte.toString(16).padStart(2, '0'); }
    return (prefix === 'dsc_' ? CAPTURE_HANDLE : PREVIEW_HANDLE).test(output) ? output : null;
}

function brokerFor(context: AuthenticatedWebSessionProjectionOwnerContext, dependencies: Dependencies): Broker | null {
    let sessions = brokers.get(context.owner); if (!sessions) { sessions = new WeakMap<object, Broker>(); brokers.set(context.owner, sessions); }
    const existing = sessions.get(context.session); if (existing) return existing;
    const broker: Broker = {
        captures: new Map(), previews: new Map(), handles: new Set(), nextEpoch: BigInt(0),
        dispose() { broker.captures.clear(); broker.previews.clear(); broker.handles.clear(); sessions!.delete(context.session); },
    };
    let unregister: (() => void) | null;
    try { unregister = dependencies.registerResource(context, broker.dispose); } catch { return null; }
    if (!unregister) return null;
    sessions.set(context.session, broker);
    return broker;
}

function selectionAgrees(context: AuthenticatedWebSessionProjectionOwnerContext, record: Capture, pair: Pair): boolean {
    return pair.patientId === record.pair.patientId && pair.ambulatoryId === record.pair.ambulatoryId
        && context.owner.snapshotSelectionEpoch(context.session) === record.selectionEpoch
        && context.owner.snapshotReviewContextEpoch(context.session) === record.reviewContextEpoch;
}

function createOperation(context: AuthenticatedWebSessionProjectionOwnerContext, dependencies: Dependencies, broker: Broker): DocumentSynthesisProductionOperation {
    const read = (record: Capture) => parseCurrentness(dependencies.readCurrentness(record.attachmentId, record.pair.patientId, record.pair.ambulatoryId));
    const operation: DocumentSynthesisProductionOperation = Object.freeze({
        async capture(input: unknown): Promise<CaptureResult> {
            const parsed = exact(input, ['attachmentId']); const attachmentId = parsed?.attachmentId;
            if (typeof attachmentId !== 'string' || attachmentId.length < 1 || attachmentId.length > 200 || /[\u0000-\u001f\u007f]/u.test(attachmentId)) return captureDenied('input_invalid');
            if (dependencies.readLaneEnabled() !== true) return captureDenied('lane_disabled');
            try {
                return context.owner.withLeaseCriticalSection(context.session, (selection) => {
                    const currentness = parseCurrentness(dependencies.readCurrentness(attachmentId, selection.patientId, selection.ambulatoryId));
                    const captureHandle = currentness && mint('dsc_', dependencies.entropy());
                    if (!currentness || !captureHandle || broker.handles.size >= MAX_SESSION_HANDLES || broker.handles.has(captureHandle)) return captureDenied('operation_unavailable');
                    broker.handles.add(captureHandle);
                    broker.captures.set(captureHandle, Object.freeze({ attachmentId, pair: Object.freeze({ patientId: selection.patientId, ambulatoryId: selection.ambulatoryId }), currentness, selectionEpoch: context.owner.snapshotSelectionEpoch(context.session), reviewContextEpoch: context.owner.snapshotReviewContextEpoch(context.session) }));
                    return Object.freeze({ status: 'available' as const, code: null, captureHandle });
                });
            } catch { return captureDenied('operation_unavailable'); }
        },
        async ingest(input: unknown): Promise<IngestResult> {
            const parsed = exact(input, ['captureHandle']); const handle = parsed?.captureHandle;
            if (typeof handle !== 'string' || !CAPTURE_HANDLE.test(handle)) return ingestDenied('input_invalid');
            const capture = broker.captures.get(handle); if (!capture) return ingestDenied('capture_consumed');
            broker.captures.delete(handle);
            if (dependencies.readLaneEnabled() !== true) return ingestDenied('lane_disabled');
            let preflight: DenialCode | null;
            try {
                preflight = context.owner.withLeaseCriticalSection(context.session, (selection) => {
                    if (!selectionAgrees(context, capture, selection)) return 'selection_changed';
                    return sameCurrentness(capture.currentness, read(capture)) ? null : 'currentness_mismatch';
                });
            } catch { return ingestDenied('operation_unavailable'); }
            if (preflight) return ingestDenied(preflight);
            let extraction: LocalExtractionResult;
            try { extraction = await dependencies.extract(context.session, capture.attachmentId); }
            catch { return ingestDenied('operation_unavailable'); }
            if (extraction.status === 'review_required' && extraction.reason === 'unsupported_local_extraction') return ingestDenied('unsupported_local_extraction');
            const projection = resolveDocumentSynthesisAnyDocProjection(extraction, capture.attachmentId);
            if (!projection) return ingestDenied('operation_unavailable');
            try {
                return context.owner.withLeaseCriticalSection(context.session, (selection) => {
                    if (!selectionAgrees(context, capture, selection)) return ingestDenied('selection_changed');
                    if (!sameCurrentness(capture.currentness, read(capture))) return ingestDenied('currentness_mismatch');
                    if (broker.nextEpoch >= MAX_U64 || broker.handles.size >= MAX_SESSION_HANDLES) return ingestDenied('operation_unavailable');
                    const previewHandle = mint('dsp_', dependencies.entropy());
                    if (!previewHandle || broker.handles.has(previewHandle)) return ingestDenied('operation_unavailable');
                    broker.nextEpoch += BigInt(1);
                    broker.handles.add(previewHandle);
                    broker.previews.set(previewHandle, Object.freeze({ ...capture, sourceText: projection.sourceText, sourceSetEpoch: broker.nextEpoch }));
                    return Object.freeze({ status: 'available' as const, code: null, previewHandle });
                });
            } catch { return ingestDenied('operation_unavailable'); }
        },
        async preview(input: unknown): Promise<PreviewResult> {
            const parsed = exact(input, ['previewHandle']); const handle = parsed?.previewHandle;
            if (typeof handle !== 'string' || !PREVIEW_HANDLE.test(handle)) return previewDenied('input_invalid');
            const preview = broker.previews.get(handle); if (!preview) return previewDenied('preview_consumed');
            broker.previews.delete(handle);
            if (dependencies.readLaneEnabled() !== true) return previewDenied('lane_disabled');
            let capsule: ReturnType<typeof createDocumentSynthesisSourceSetCurrentnessOwner> | null = null;
            try {
                const sourceSet = context.owner.withLeaseCriticalSection(context.session, (selection) => {
                    if (!selectionAgrees(context, preview, selection) || !sameCurrentness(preview.currentness, read(preview))) return null;
                    const captured = captureDocumentSynthesisSourceSet({ sourceSetEpoch: preview.sourceSetEpoch, revocationGeneration: BigInt(0), sources: [{ documentSourceRef: preview.currentness.documentSourceRef, documentRevision: BigInt(preview.currentness.documentRevision), documentFreshnessEpoch: BigInt(preview.currentness.documentFreshnessEpoch), sourceText: preview.sourceText }] });
                    return captured.status === 'available' ? captured.sourceSet : null;
                });
                if (!sourceSet) return previewDenied('currentness_mismatch');
                capsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: context.owner, session: context.session, sourceSet }));
                const configuration = Object.freeze({ owner: context.owner, session: context.session, capsule });
                const publication = await dependencies.execute(configuration);
                if (!publication) return previewDenied('operation_unavailable');
                const current = context.owner.withLeaseCriticalSection(context.session, (selection) => selectionAgrees(context, preview, selection) && sameCurrentness(preview.currentness, read(preview)));
                if (!current) return previewDenied('currentness_mismatch');
                return Object.freeze({ status: 'available' as const, code: null, publication });
            } catch { return previewDenied('operation_unavailable'); }
            finally { try { capsule?.dispose(); } catch { /* terminal cleanup is best effort */ } }
        },
    });
    return operation;
}

function factory(dependencies: Dependencies) {
    return Object.freeze({
        async acquire(): Promise<DocumentSynthesisProductionOperation | null> {
            let context: AuthenticatedWebSessionProjectionOwnerContext | null;
            try { context = await dependencies.acquireContext(); } catch { return null; }
            if (!context || !isServerSessionProjectionOwner(context.owner)) return null;
            const broker = brokerFor(context, dependencies);
            return broker ? createOperation(context, dependencies, broker) : null;
        },
    });
}

function readProductionCurrentness(attachmentId: string, patientId: string, ambulatoryId: string): unknown {
    return dbServer.get(sql`SELECT a.document_source_ref AS documentSourceRef, a.document_revision AS documentRevision, a.document_freshness_epoch AS documentFreshnessEpoch FROM attachments AS a INNER JOIN patients_to_ambulatories AS pta ON pta.patient_id = a.patient_id WHERE a.id = ${attachmentId} AND a.patient_id = ${patientId} AND pta.ambulatory_id = ${ambulatoryId} LIMIT 1`);
}
function readProductionLaneEnabled(): boolean {
    const row = dbServer.get(sql`SELECT value FROM settings WHERE key = ${AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY} LIMIT 1`) as { value?: unknown } | undefined;
    return isAiDocumentSynthesisEnabledValue(row?.value);
}
const production = factory(Object.freeze({
    acquireContext: acquireAuthenticatedWebSessionProjectionOwnerContext,
    readCurrentness: readProductionCurrentness,
    readLaneEnabled: readProductionLaneEnabled,
    extract: (session: ServerSession, attachmentId: string) => composeAnyDocCurrentSourceExtraction(session, { attachmentId }),
    async execute(configuration: unknown) { return (await createDocumentSynthesisFabricProductionComposition(configuration)?.execute()) ?? null; },
    entropy: () => randomBytes(16),
    registerResource: (context: AuthenticatedWebSessionProjectionOwnerContext, dispose: () => void) => registerServerSessionResource(context.session.id, dispose),
}));

export const acquireDocumentSynthesisProductionOperation = (): Promise<DocumentSynthesisProductionOperation | null> => production.acquire();

export function createDocumentSynthesisProductionOperationForTest(dependencies: Dependencies) {
    if (!TEST_HARNESS) return Object.freeze({ acquire: async () => null });
    return factory(dependencies);
}
