/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, test } from 'node:test';
import Database from 'better-sqlite3';

import { createServerSessionProjectionOwnerRegistry } from '../../security/server-session-projection-owner.ts';
import { clearAllSessions, createSession } from '../../security/server-session.ts';

const DATA_DIRECTORY = mkdtempSync(path.join(os.tmpdir(), 'mediflow-ds-operation-'));
process.env.MEDIFLOW_DATA_DIR = DATA_DIRECTORY;
const bootstrap = new Database(path.join(DATA_DIRECTORY, 'medical.db'));
for (const file of readdirSync(path.resolve('drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    bootstrap.exec(readFileSync(path.join(path.resolve('drizzle'), file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
bootstrap.close();
const { createDocumentSynthesisProductionOperationForTest } = await import('./document-synthesis-production-operation.ts');

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

afterEach(() => clearAllSessions());
after(() => rmSync(DATA_DIRECTORY, { recursive: true, force: true }));

function context() {
    const registry = createServerSessionProjectionOwnerRegistry({
        clock: () => 1_000,
        entropy: () => Uint8Array.from({ length: 16 }, (_, index) => index + 1),
        resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }),
    });
    const session = createSession(USER, 'web');
    const owner = registry.acquire(session);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    return Object.freeze({ session, owner });
}

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
