/* @Codex */
import 'server-only';

import { types } from 'node:util';
import type { ServerSession } from '../../security/server-session';
import { bindAttachmentExtractionSelection } from './attachment-extraction-selection-binding';
import { createAttachmentExtractionSourceAuthority, createNativeAttachmentExtractionSourceAuthority } from './attachment-extraction-source-authority';
import { continueAnyDocImageOrScanWithLocalOcr } from './anydoc-apple-vision-ocr-composition';
import {
    buildAnyDocLocalExtraction,
    type LocalAttachmentByteSource,
    type LocalExtractionOcrProvenance,
    type LocalExtractionReceipt,
    type LocalExtractionResult,
} from './anydoc-local-extraction-contract';
import { extractAnyDocLocalBytes } from './anydoc-local-extraction-runner';
import { claimAttachmentExtractionProjection } from './attachment-extraction-projection-broker';
import { readAttachmentExtractionProjectionBytes } from './attachment-extraction-projection-transport';
import { ATTACHMENT_EXTRACTION_PROJECTION_SCHEMA } from './attachment-extraction-projection-protocol';

const create = Object.create;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const getDescriptor = Object.getOwnPropertyDescriptor;
const getPrototype = Object.getPrototypeOf;
const ownKeys = Reflect.ownKeys;
const isProxy = types.isProxy;

type Field = readonly [key: string, value: unknown];

function frozenRecord<T extends object>(fields: readonly Field[]): T {
    const record = create(null) as Record<string, unknown>;
    for (let index = 0; index < fields.length; index += 1) {
        const field = fields[index]!;
        defineProperty(record, field[0], { value: field[1], enumerable: true });
    }
    return freeze(record) as T;
}

function publishedProvenance(value: LocalAttachmentByteSource): LocalAttachmentByteSource {
    return frozenRecord([
        ['attachmentId', value.attachmentId], ['sourceSha256', value.sourceSha256], ['byteLength', value.byteLength],
    ]);
}

function publishedOcrProvenance(value: LocalExtractionOcrProvenance): LocalExtractionOcrProvenance {
    return frozenRecord([
        ['schemaVersion', value.schemaVersion], ['engine', value.engine], ['scriptSha256', value.scriptSha256],
        ['pageCount', value.pageCount], ['ocrPageCount', value.ocrPageCount],
        ['receiptSetSha256', value.receiptSetSha256],
    ]);
}

function publishedReceipt(value: LocalExtractionReceipt): LocalExtractionReceipt {
    const fields: Field[] = [
        ['receiptId', value.receiptId], ['parser', value.parser], ['outcome', value.outcome],
        ['sourceSha256', value.sourceSha256], ['sourceByteLength', value.sourceByteLength],
    ];
    const markdownSha256 = getDescriptor(value, 'markdownSha256');
    if (markdownSha256 && 'value' in markdownSha256) fields.push(['markdownSha256', markdownSha256.value]);
    fields.push(['markdownByteLength', value.markdownByteLength]);
    const ocrProvenance = getDescriptor(value, 'ocrProvenance');
    if (ocrProvenance && 'value' in ocrProvenance)
        fields.push(['ocrProvenance', publishedOcrProvenance(ocrProvenance.value as LocalExtractionOcrProvenance)]);
    return frozenRecord(fields);
}

function publishFinalizedResult(result: LocalExtractionResult): LocalExtractionResult {
    if (result.status === 'denied') return frozenRecord([
        ['schemaVersion', result.schemaVersion], ['status', result.status], ['reason', result.reason], ['field', result.field],
        ['review', result.review], ['writes', result.writes], ['apply', result.apply], ['candidateUse', result.candidateUse],
    ]);
    const base: Field[] = [
        ['schemaVersion', result.schemaVersion], ['provenance', publishedProvenance(result.provenance)],
        ['receipt', publishedReceipt(result.receipt)], ['review', result.review], ['writes', result.writes], ['apply', result.apply],
    ];
    if (result.status === 'extracted') return frozenRecord([...base,
        ['status', result.status], ['markdown', result.markdown], ['candidateUse', result.candidateUse],
    ]);
    return frozenRecord([...base, ['status', result.status], ['reason', result.reason], ['detail', result.detail],
        ['markdown', result.markdown], ['candidateUse', result.candidateUse]]);
}

function attachmentId(value: unknown): string | null {
    if (!value || typeof value !== 'object' || isProxy(value) || getPrototype(value) !== Object.prototype) return null;
    const keys = ownKeys(value); if (keys.length !== 1 || keys[0] !== 'attachmentId') return null;
    const descriptor = getDescriptor(value, 'attachmentId');
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true || typeof descriptor.value !== 'string') return null;
    const id = descriptor.value;
    return id.length > 0 && id.length <= 200 && id.trim() === id ? id : null;
}

function denied(): LocalExtractionResult { return publishFinalizedResult(buildAnyDocLocalExtraction(null, '')); }

/** Runs one current host-owned attachment through the fixed local parser and publishes only after final currentness. */
export async function composeAnyDocCurrentSourceExtraction(session: ServerSession, selector: unknown): Promise<LocalExtractionResult> {
    const id = attachmentId(selector); if (!id) return denied();
    if (!bindAttachmentExtractionSelection(session, id)) return denied();
    return extractSelectedSource(session, selector, id);
}

/** Uses the active canonical selection; missing or stale authority remains denied. */
export async function composeAnyDocCurrentSelectionExtraction(session: ServerSession, selector: unknown): Promise<LocalExtractionResult> {
    const id = attachmentId(selector); if (!id) return denied();
    return extractSelectedSource(session, selector, id);
}

async function extractSelectedSource(session: ServerSession, selector: unknown, id: string): Promise<LocalExtractionResult> {
    let authority: ReturnType<typeof createAttachmentExtractionSourceAuthority>;
    try { authority = session.authChannel === 'native'
        ? createNativeAttachmentExtractionSourceAuthority(session) : createAttachmentExtractionSourceAuthority(session); }
    catch { return denied(); }
    let operation: object | null = null;
    try {
        const locator = authority.issue(selector); if (!locator) return denied();
        const begun = authority.consume(locator); if (begun.status !== 'begun') return denied();
        operation = begun.operation;
        let result: LocalExtractionResult;
        try {
            if (!authority.checkpoint(operation)) return denied();
            result = await extractAnyDocLocalBytes(id, begun.bytes);
            if (!authority.checkpoint(operation)) return denied();
            if (result.status === 'review_required' && result.detail === 'image_or_scan') {
                result = await continueAnyDocImageOrScanWithLocalOcr(id, begun.bytes, result);
                if (!authority.checkpoint(operation)) return denied();
            }
        }
        catch { authority.abort(operation); operation = null; return denied(); }
        const final = authority.finalize(operation); operation = null;
        return final.status === 'spent' && final.evidenceAdmissible ? publishFinalizedResult(result) : denied();
    } catch {
        if (operation) authority.abort(operation);
        return denied();
    } finally { authority.dispose(); }
}


/** HTTP publication is constructed synchronously after the last authority check; no await follows finalize. */
export async function composeAnyDocClientProjectionExtraction(
    session: ServerSession, selector: unknown, grantId: unknown, request: Request,
): Promise<Response> {
    const unavailable = () => Response.json({ error: 'Local extraction unavailable' },
        { status: 409, headers: { 'Cache-Control': 'no-store' } });
    const id = attachmentId(selector); if (!id || request.signal.aborted) return unavailable();
    const use = claimAttachmentExtractionProjection(session, id, grantId); if (!use) return unavailable();
    const cancel = () => use.cancel();
    request.signal.addEventListener('abort', cancel, { once: true });
    let bytes: Uint8Array | null = null;
    try {
        if (request.signal.aborted || !use.current()) return unavailable();
        bytes = await readAttachmentExtractionProjectionBytes(request, use);
        if (!bytes || request.signal.aborted || !use.current()) return unavailable();
        const begun = use.consume(bytes);
        bytes.fill(0); bytes = null;
        if (!begun || request.signal.aborted || !use.current()) return unavailable();
        let result = await extractAnyDocLocalBytes(id, begun.bytes);
        if (request.signal.aborted || !use.current()) return unavailable();
        if (result.status === 'review_required' && result.detail === 'image_or_scan') {
            result = await continueAnyDocImageOrScanWithLocalOcr(id, begun.bytes, result);
            if (request.signal.aborted || !use.current()) return unavailable();
        }
        if (result.status === 'denied' || request.signal.aborted || !use.finalize()) return unavailable();
        return Response.json({
            schemaVersion: ATTACHMENT_EXTRACTION_PROJECTION_SCHEMA,
            grantId: use.grant.grantId,
            acquisition: { origin: 'authenticated_client_decryption', ciphertextEquality: 'not_attested',
                canonicalSource: use.grant.canonicalSource },
            extraction: publishFinalizedResult(result),
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch { return unavailable(); }
    finally { bytes?.fill(0); request.signal.removeEventListener('abort', cancel); use.dispose(); }
}
