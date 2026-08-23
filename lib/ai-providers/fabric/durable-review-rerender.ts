/* @Codex */
import {
    snapshotSmartImportFabricProvenance,
    snapshotSmartImportFabricResolutionReceipt,
    type SmartImportFabricProvenanceWire,
    type SmartImportFabricResolutionReceiptWire,
} from '../../smart-import-fabric-wire';
import {
    parsePatientSmartImportProposalWire,
    type SmartImportProposalWireV1,
} from '../../smart-import-proposal-wire';

export const DURABLE_REVIEW_RERENDER_ENVELOPE_VERSION =
    'mediflow.ai.durable-review-envelope.v1' as const;
export const DURABLE_REVIEW_RERENDER_PRESENTATION_VERSION =
    'mediflow.ai.durable-review.presentation.v1' as const;

export type DurableReviewRerenderModel = Readonly<{
    presentationVersion: typeof DURABLE_REVIEW_RERENDER_PRESENTATION_VERSION;
    reviewId: string;
    reviewRevision: number;
    receiptRef: string;
    provenanceRef: string;
    proposal: SmartImportProposalWireV1;
    receipt: SmartImportFabricResolutionReceiptWire;
    provenance: SmartImportFabricProvenanceWire;
}>;
export type DurableReviewRerender = Readonly<{
    presentationVersion: typeof DURABLE_REVIEW_RERENDER_PRESENTATION_VERSION;
    model: DurableReviewRerenderModel;
    dom: string;
}>;
export type DurableReviewUnsealBoundary = (sealedCiphertext: string) => unknown;

export class DurableReviewRerenderError extends Error {
    readonly code = 'invalid_review' as const;
    constructor() { super('Durable review re-render rejected: invalid_review'); }
}

type DurableRecord = Readonly<{
    recordId: string;
    patientRef: string;
    reviewId: string;
    reviewRevision: number;
    receiptRef: string;
    provenanceRef: string;
    receiptBinding: string;
    provenanceBinding: string;
    presentationVersion: typeof DURABLE_REVIEW_RERENDER_PRESENTATION_VERSION;
    sealedCiphertext: string;
    sealedDigest: string;
}>;

const REVIEW = /^review_[0-9a-f]{32}$/u;
const PATIENT = /^ptr_[0-9a-f]{32}$/u;
const RECEIPT = /^receipt_[0-9a-f]{32}$/u;
const PROVENANCE = /^provenance_[0-9a-f]{32}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SEALED = /^ENC:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/u;
const RECORD_KEYS = ['recordId', 'patientRef', 'reviewId', 'reviewRevision', 'receiptRef', 'provenanceRef', 'receiptBinding', 'provenanceBinding', 'presentationVersion', 'sealedCiphertext', 'sealedDigest'] as const;
const ENVELOPE_KEYS = ['schemaVersion', 'presentationVersion', 'reviewId', 'reviewRevision', 'receiptRef', 'provenanceRef', 'proposal', 'receipt', 'provenance'] as const;

async function digest(value: string): Promise<string> {
    try {
        const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch { throw new DurableReviewRerenderError(); }
}

function closedRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const own = Reflect.ownKeys(value);
        if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const result: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return null;
            result[key] = descriptor.value;
        }
        return result;
    } catch { return null; }
}

async function record(value: unknown): Promise<DurableRecord | null> {
    const input = closedRecord(value, RECORD_KEYS);
    if (!input
        || typeof input.recordId !== 'string' || !REVIEW.test(input.recordId)
        || typeof input.patientRef !== 'string' || !PATIENT.test(input.patientRef)
        || typeof input.reviewId !== 'string' || !REVIEW.test(input.reviewId) || input.recordId !== input.reviewId
        || typeof input.reviewRevision !== 'number' || !Number.isSafeInteger(input.reviewRevision) || input.reviewRevision < 1
        || typeof input.receiptRef !== 'string' || !RECEIPT.test(input.receiptRef)
        || typeof input.provenanceRef !== 'string' || !PROVENANCE.test(input.provenanceRef)
        || typeof input.receiptBinding !== 'string' || !SHA256.test(input.receiptBinding) || input.receiptBinding !== await digest(`${input.patientRef}\0${input.reviewId}\0${input.receiptRef}`)
        || typeof input.provenanceBinding !== 'string' || !SHA256.test(input.provenanceBinding) || input.provenanceBinding !== await digest(`${input.patientRef}\0${input.reviewId}\0${input.provenanceRef}`)
        || input.presentationVersion !== DURABLE_REVIEW_RERENDER_PRESENTATION_VERSION
        || typeof input.sealedCiphertext !== 'string' || !SEALED.test(input.sealedCiphertext)
        || typeof input.sealedDigest !== 'string' || !SHA256.test(input.sealedDigest) || input.sealedDigest !== await digest(input.sealedCiphertext)) return null;
    return Object.freeze(input) as DurableRecord;
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function renderDom(model: DurableReviewRerenderModel): string {
    return `<article data-durable-review-version="${model.presentationVersion}"><h2>Review proposal</h2><p>${escapeHtml(model.proposal.summary)}</p><dl><dt>Review</dt><dd>${model.reviewId}</dd><dt>Revision</dt><dd>${model.reviewRevision}</dd><dt>Receipt</dt><dd>${model.receiptRef} · ${model.receipt.provider} · ${model.receipt.model ?? 'none'}</dd><dt>Provenance</dt><dd>${model.provenanceRef} · ${model.provenance.venue} · ${model.provenance.preprocessing.join(', ')}</dd><dt>Presentation</dt><dd>${model.presentationVersion}</dd></dl></article>`;
}

async function rerender(value: unknown, unseal: DurableReviewUnsealBoundary): Promise<DurableReviewRerender> {
    const stored = await record(value);
    if (!stored) throw new DurableReviewRerenderError();
    let opened: unknown;
    try { opened = unseal(stored.sealedCiphertext); } catch { throw new DurableReviewRerenderError(); }
    const envelope = closedRecord(opened, ENVELOPE_KEYS);
    if (!envelope
        || envelope.schemaVersion !== DURABLE_REVIEW_RERENDER_ENVELOPE_VERSION
        || envelope.presentationVersion !== stored.presentationVersion
        || envelope.reviewId !== stored.reviewId
        || envelope.reviewRevision !== stored.reviewRevision
        || envelope.receiptRef !== stored.receiptRef
        || envelope.provenanceRef !== stored.provenanceRef) throw new DurableReviewRerenderError();
    const proposal = parsePatientSmartImportProposalWire(envelope.proposal);
    const receipt = snapshotSmartImportFabricResolutionReceipt(envelope.receipt);
    const provenance = receipt && snapshotSmartImportFabricProvenance(envelope.provenance, receipt);
    if (!proposal || !receipt || !provenance) throw new DurableReviewRerenderError();
    const model = Object.freeze({
        presentationVersion: DURABLE_REVIEW_RERENDER_PRESENTATION_VERSION,
        reviewId: stored.reviewId,
        reviewRevision: stored.reviewRevision,
        receiptRef: stored.receiptRef,
        provenanceRef: stored.provenanceRef,
        proposal,
        receipt,
        provenance,
    });
    return Object.freeze({ presentationVersion: DURABLE_REVIEW_RERENDER_PRESENTATION_VERSION, model, dom: renderDom(model) });
}

/** Client-owned read-only boundary for presenting an already sealed durable review. */
export function createDurableReviewRerender(unseal: DurableReviewUnsealBoundary) {
    return Object.freeze({ rerender: (value: unknown): Promise<DurableReviewRerender> => rerender(value, unseal) });
}
