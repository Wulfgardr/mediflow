/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, test } from 'node:test';
import Database from 'better-sqlite3';

import { createFullPortProjectionOwnerFactory } from '../../security/server-session-projection-owner.ts';
import { clearAllSessions } from '../../security/server-session.ts';

const DATA_DIRECTORY = mkdtempSync(path.join(os.tmpdir(), 'mediflow-ds-operation-'));
process.env.MEDIFLOW_DATA_DIR = DATA_DIRECTORY;
const bootstrap = new Database(path.join(DATA_DIRECTORY, 'medical.db'));
for (const file of readdirSync(path.resolve('drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    bootstrap.exec(readFileSync(path.join(path.resolve('drizzle'), file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
bootstrap.close();
const {
    createDocumentSynthesisProductionOperationForTest,
    resolveDocumentSynthesisAnyDocProjection,
} = await import('./document-synthesis-production-operation.ts');
const { composeAnyDocCurrentSelectionExtraction } = await import('../../domain/documents/anydoc-current-source-composition.ts');
const { serverSessionProjectionOwnerRegistry } = await import('../../security/server-session-projection-owner-production.ts');

import { issueSyntheticWebSession, issueSyntheticWebSessionContext, retireSyntheticWebSession } from '../../security/web-auth-lifecycle-owner-test-fixture.ts';
import { resolve, retire } from '../../security/web-auth-lifecycle-owner-adapter.ts';
const webSessions: ReturnType<typeof issueSyntheticWebSession>[] = [];

const USER = Object.freeze({ id: 'user.synthetic.document.synthesis', username: 'clinician.synthetic', role: 'clinician' as const });
const PAIR = Object.freeze({ patientId: 'patient.synthetic.document.synthesis', ambulatoryId: 'ambulatory.synthetic.document.synthesis' });
const CURRENT: Readonly<{ documentSourceRef: string; documentRevision: number; documentFreshnessEpoch: number }> = Object.freeze({
    documentSourceRef: 'a'.repeat(64),
    documentRevision: 7,
    documentFreshnessEpoch: 11,
});

function extracted(attachmentId: string, markdown = 'Fonte sintetica.') {
    const markdownSha256 = createHash('sha256').update(markdown).digest('hex');
    return Object.freeze({
        schemaVersion: 'mediflow.anydoc_local_extraction.v1',
        provenance: Object.freeze({ attachmentId, sourceSha256: 'b'.repeat(64), byteLength: 24 }),
        receipt: Object.freeze({
            receiptId: 'c'.repeat(64), parser: 'anydoc-local', outcome: 'extracted', sourceSha256: 'b'.repeat(64),
            sourceByteLength: 24, markdownSha256, markdownByteLength: Buffer.byteLength(markdown),
        }),
        review: 'required', writes: 0, apply: 'none', status: 'extracted', markdown, candidateUse: 'review_only',
    });
}

function unsupported(attachmentId: string) {
    return Object.freeze({
        schemaVersion: 'mediflow.anydoc_local_extraction.v1' as const,
        provenance: Object.freeze({ attachmentId, sourceSha256: 'b'.repeat(64), byteLength: 24 }),
        receipt: Object.freeze({
            receiptId: 'd'.repeat(64), parser: 'anydoc-local' as const, outcome: 'review_required:image_or_scan' as const,
            sourceSha256: 'b'.repeat(64), sourceByteLength: 24, markdownByteLength: 0,
        }),
        review: 'required' as const, writes: 0 as const, apply: 'none' as const,
        status: 'review_required' as const, reason: 'unsupported_local_extraction' as const,
        detail: 'image_or_scan' as const, markdown: '' as const, candidateUse: 'blocked' as const,
    });
}

function extractedWithAppleVision(attachmentId: string, markdown = 'Fonte sintetica OCR.') {
    const value = extracted(attachmentId, markdown);
    return Object.freeze({
        ...value,
        receipt: Object.freeze({
            ...value.receipt,
            ocrProvenance: Object.freeze({
                schemaVersion: 'mediflow.anydoc_local_ocr_provenance.v1' as const,
                engine: 'apple_vision' as const,
                scriptSha256: 'e'.repeat(64),
                pageCount: 2,
                ocrPageCount: 1,
                receiptSetSha256: 'f'.repeat(64),
            }),
        }),
    });
}

afterEach(() => { for (const session of webSessions.splice(0)) retireSyntheticWebSession(session); clearAllSessions(); });
after(() => rmSync(DATA_DIRECTORY, { recursive: true, force: true }));

function context(registry = createFullPortProjectionOwnerFactory({
        clock: () => Date.now(),
        entropy: () => Uint8Array.from({ length: 16 }, (_, index) => index + 1),
        resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }),
    })) {
    const web = issueSyntheticWebSessionContext(USER, `document-synthesis-${webSessions.length}`);
    const session = web.session;
    webSessions.push(session);
    const owner = registry.acquire(session);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    let previous = session;
    const resolveContext = () => {
        const resolution = resolve(session.id, web.controlId);
        assert.equal(resolution.status, 'active');
        if (resolution.status !== 'active') throw new Error('Synthetic Web projection unavailable');
        const current = resolution.projection;
        assert.notEqual(current, previous);
        assert.equal(current.id, session.id);
        previous = current;
        const currentOwner = registry.acquire(current);
        assert.equal(currentOwner, owner);
        return Object.freeze({ session: current, owner: currentOwner });
    };
    return Object.freeze({ session, owner, web, resolveContext });
}

test('preserves the confirmed selection through real AnyDoc composition and DS preview', async () => {
    const attachmentId = 'attachment.synthetic.document';
    const bytes = Buffer.from('{\\rtf1\\ansi Fonte sintetica da composizione reale.}');
    const database = new Database(path.join(DATA_DIRECTORY, 'medical.db'));
    try {
        database.prepare('INSERT INTO ambulatories (id, name, type) VALUES (?, ?, ?)')
            .run(PAIR.ambulatoryId, 'Ambulatorio sintetico', 'test');
        database.prepare('INSERT INTO patients (id, first_name, last_name, tax_code, version) VALUES (?, ?, ?, ?, 1)')
            .run(PAIR.patientId, 'Persona', 'Sintetica', 'SYNTHETICDS000001');
        database.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)')
            .run(PAIR.patientId, PAIR.ambulatoryId);
        database.prepare('INSERT INTO attachments (id, patient_id, name, type, size, path, data, document_source_ref, document_revision, document_freshness_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(attachmentId, PAIR.patientId, 'synthetic.rtf', 'application/rtf', bytes.length, 'synthetic.rtf', bytes.toString('base64'),
                CURRENT.documentSourceRef, CURRENT.documentRevision, CURRENT.documentFreshnessEpoch);
    } finally { database.close(); }
    const selected = context(serverSessionProjectionOwnerRegistry);
    const epochs = () => [selected.owner.snapshotSelectionEpoch(selected.session), selected.owner.snapshotReviewContextEpoch(selected.session)];
    assert.deepEqual(epochs(), [1, 1]);
    let entropy = 0; let executions = 0;
    const factory = createDocumentSynthesisProductionOperationForTest({
        acquireContext: async () => selected.resolveContext(),
        readCurrentness: () => CURRENT,
        readLaneEnabled: () => true,
        extract: (session, id) => composeAnyDocCurrentSelectionExtraction(session, { attachmentId: id }),
        execute: async () => { executions++; return Object.freeze({ publication: 'synthetic' }); },
        entropy: () => Uint8Array.from({ length: 16 }, () => ++entropy),
    });
    const acquire = async () => { const operation = await factory.acquire(); assert.ok(operation); return operation; };
    const captured = await (await acquire()).capture({ attachmentId });
    assert.equal(captured.status, 'available');
    const ingested = await (await acquire()).ingest({ captureHandle: captured.captureHandle });
    assert.equal(ingested.code, null);
    assert.equal(ingested.status, 'available');
    assert.deepEqual(epochs(), [1, 1]);
    assert.deepEqual(await (await acquire()).preview({ previewHandle: ingested.previewHandle }),
        { status: 'available', code: null, publication: { publication: 'synthetic' } });
    assert.deepEqual(epochs(), [1, 1]);
    assert.equal((await (await acquire()).ingest({ captureHandle: captured.captureHandle })).code, 'capture_consumed');
    assert.equal((await (await acquire()).preview({ previewHandle: ingested.previewHandle })).code, 'preview_consumed');
    assert.equal(executions, 1);
});

test('shares DS handles across fresh authentic projections only within their canonical owner', async () => {
    const selected = context(); const other = context();
    assert.notEqual(selected.owner, other.owner);
    let active = selected; let entropy = 0; let extractions = 0; let executions = 0;
    const factory = createDocumentSynthesisProductionOperationForTest({
        acquireContext: async () => active.resolveContext(),
        readCurrentness: () => CURRENT,
        readLaneEnabled: () => true,
        extract: async (session, attachmentId) => {
            assert.notEqual(session, selected.session);
            assert.equal(session.id, selected.session.id);
            extractions++;
            return extracted(attachmentId);
        },
        execute: async () => { executions++; return Object.freeze({ publication: 'synthetic' }); },
        entropy: () => Uint8Array.from({ length: 16 }, () => ++entropy),
    });
    const acquire = async () => { const operation = await factory.acquire(); assert.ok(operation); return operation; };
    const captureOperation = await acquire();
    const captured = await captureOperation.capture({ attachmentId: 'attachment.synthetic.document' });
    assert.equal(captured.status, 'available');

    active = other;
    assert.equal((await (await acquire()).ingest({ captureHandle: captured.captureHandle })).code, 'capture_consumed');
    assert.equal(extractions, 0);
    active = selected;
    const ingested = await (await acquire()).ingest({ captureHandle: captured.captureHandle });
    assert.equal(ingested.status, 'available');
    assert.equal((await captureOperation.ingest({ captureHandle: captured.captureHandle })).code, 'capture_consumed');

    active = other;
    assert.equal((await (await acquire()).preview({ previewHandle: ingested.previewHandle })).code, 'preview_consumed');
    assert.equal(executions, 0);
    active = selected;
    assert.deepEqual(await (await acquire()).preview({ previewHandle: ingested.previewHandle }),
        { status: 'available', code: null, publication: { publication: 'synthetic' } });
    assert.equal((await (await acquire()).preview({ previewHandle: ingested.previewHandle })).code, 'preview_consumed');
    assert.equal(extractions, 1); assert.equal(executions, 1);
});

test('classifies Apple Vision AnyDoc evidence as OCR text and keeps native extraction distinct', () => {
    const native = resolveDocumentSynthesisAnyDocProjection(extracted('attachment.synthetic.document'),
        'attachment.synthetic.document');
    const ocr = resolveDocumentSynthesisAnyDocProjection(extractedWithAppleVision('attachment.synthetic.document'),
        'attachment.synthetic.document');
    assert.deepEqual([native?.sourceKind, native?.rationale], ['native_text', 'native_text_normalized']);
    assert.deepEqual([ocr?.sourceKind, ocr?.rationale], ['ocr_text', 'ocr_text_normalized']);

    const malformed = extractedWithAppleVision('attachment.synthetic.document');
    assert.equal(resolveDocumentSynthesisAnyDocProjection({
        ...malformed,
        receipt: { ...malformed.receipt, ocrProvenance: { ...malformed.receipt.ocrProvenance, ocrPageCount: 3 } },
    }, 'attachment.synthetic.document'), null);
});

test('binds one attachment intent and one host-owned AnyDoc result to currentness', async () => {
    const selected = context(); let entropy = 0; let reads = 0; let extractions = 0; let executions = 0;
    const factory = createDocumentSynthesisProductionOperationForTest(Object.freeze({
        acquireContext: async () => selected,
        readCurrentness: (attachmentId: string, patientId: string, ambulatoryId: string) => {
            reads += 1; assert.equal(attachmentId, 'attachment.synthetic.document'); assert.deepEqual({ patientId, ambulatoryId }, PAIR); return CURRENT;
        },
        readLaneEnabled: () => true,
        extract: async (session: unknown, attachmentId: string) => { extractions += 1; assert.equal(session, selected.session); return extracted(attachmentId); },
        execute: async (configuration: unknown) => { executions += 1; assert.ok(configuration); return Object.freeze({ publication: 'synthetic' }); },
        entropy: () => Uint8Array.from({ length: 16 }, () => ++entropy),
        registerResource: () => () => undefined,
    }));
    const operation = await factory.acquire(); assert.ok(operation);
    const captured = await operation.capture({ attachmentId: 'attachment.synthetic.document' });
    assert.equal(captured.status, 'available'); assert.match(captured.captureHandle!, /^dsc_[0-9a-f]{32}$/u);
    const ingested = await operation.ingest({ captureHandle: captured.captureHandle });
    assert.equal(ingested.status, 'available'); assert.match(ingested.previewHandle!, /^dsp_[0-9a-f]{32}$/u);
    assert.equal((await operation.ingest({ captureHandle: captured.captureHandle })).code, 'capture_consumed');
    const preview = await operation.preview({ previewHandle: ingested.previewHandle });
    assert.deepEqual(preview, { status: 'available', code: null, publication: { publication: 'synthetic' } });
    assert.equal((await operation.preview({ previewHandle: ingested.previewHandle })).code, 'preview_consumed');
    assert.equal(executions, 1); assert.equal(extractions, 1); assert.equal(reads, 5);
});

test('suppresses drift and denies caller source injection, unsupported extraction, and a disabled lane', async () => {
    const selected = context(); let current = CURRENT; let executions = 0; let entropy = 0; let enabled = true; let extractionAvailable = true;
    const factory = createDocumentSynthesisProductionOperationForTest(Object.freeze({
        acquireContext: async () => selected,
        readCurrentness: () => current,
        readLaneEnabled: () => enabled,
        extract: async (_session: unknown, attachmentId: string) => extractionAvailable
            ? extracted(attachmentId)
            : unsupported(attachmentId),
        execute: async () => { executions += 1; current = Object.freeze({ ...CURRENT, documentRevision: 8 }); return Object.freeze({ forbidden: 'late' }); },
        entropy: () => Uint8Array.from({ length: 16 }, () => ++entropy),
        registerResource: () => () => undefined,
    }));
    const operation = await factory.acquire(); assert.ok(operation);
    const first = await operation.capture({ attachmentId: 'attachment.synthetic.document' });
    assert.equal((await operation.ingest({ captureHandle: first.captureHandle, projection: { sourceKind: 'native_text', sourceText: 'Caller.' } })).code, 'input_invalid');
    const ingested = await operation.ingest({ captureHandle: first.captureHandle });
    const denied = await operation.preview({ previewHandle: ingested.previewHandle });
    assert.deepEqual(denied, { status: 'denied', code: 'currentness_mismatch', publication: null });
    assert.equal(executions, 1);
    current = CURRENT; extractionAvailable = false;
    const second = await operation.capture({ attachmentId: 'attachment.synthetic.document' });
    assert.equal((await operation.ingest({ captureHandle: second.captureHandle })).code, 'unsupported_local_extraction');
    enabled = false;
    const third = await operation.capture({ attachmentId: 'attachment.synthetic.document' });
    assert.equal(third.code, 'lane_disabled');
    assert.equal(executions, 1);
});

/* @Codex */
test('production registration completes Web retirement and disposes capture and preview handles', async () => {
    for (const reason of ['dispose', 'lock', 'delete'] as const) {
        const selected = context(); let entropy = 0; let extractions = 0;
        const factory = createDocumentSynthesisProductionOperationForTest({
            acquireContext: async () => selected.resolveContext(),
            readCurrentness: () => CURRENT,
            readLaneEnabled: () => true,
            extract: async (_session, attachmentId) => { extractions++; return extracted(attachmentId); },
            execute: async () => null,
            entropy: () => Uint8Array.from({ length: 16 }, () => ++entropy),
        });
        const operation = await factory.acquire();
        assert.ok(operation, 'production DS registration must accept the authentic Web projection');
        const captured = await operation.capture({ attachmentId: 'attachment.synthetic.document' });
        assert.equal(captured.status, 'available');
        const ingested = await operation.ingest({ captureHandle: captured.captureHandle });
        assert.equal(ingested.status, 'available');
        const pending = await operation.capture({ attachmentId: 'attachment.synthetic.document' });
        assert.equal(pending.status, 'available');
        const retired = retire(selected.resolveContext().session, reason,
            reason === 'lock' ? { controlId: selected.web.controlId, ifMatch: selected.web.etag, idempotencyKey: 'synthetic-ds-lock' } : undefined);
        assert.equal(retired.outcome, 'completed', reason);
        assert.equal((await operation.ingest({ captureHandle: pending.captureHandle })).code, 'capture_consumed');
        assert.equal((await operation.preview({ previewHandle: ingested.previewHandle })).code, 'preview_consumed');
        assert.equal(extractions, 1);
        assert.equal(await factory.acquire(), null);
    }
});
