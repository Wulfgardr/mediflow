/* @Codex */
/* Native DS composition regression, synthetic data only.
 * ORIGINAL implementations: native issuer/owner, prepare/project, source authority and final witness,
 * DS operation implementation, binary transport, pinned AnyDoc worker, canonical
 * OCR routing/materialization/rendering, original DS preview and ordinary flow.
 * CONTROLLED: in-memory rows, DS factory's context/lane dependencies, governance,
 * OCR recognizer UNAVAILABLE, and the product-attempt consent boundary. The latter
 * is an orchestration seam, NOT proof of the omitted consent/egress engine.
 * No parser result, OCR text or provider success is manufactured. No Swift,
 * Apple Vision recognition, platform qualification or final model proposal claim.
 * Run with the canonical Node24 dependency tree and an explicit synthetic
 * MEDIFLOW_DATA_DIR; missing prerequisites FAIL, never skip or fall back.
 */
'use strict';
const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const { createHash, randomBytes, randomUUID, createCipheriv, createDecipheriv } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const realSpawn = childProcess.spawn;
assert.equal(Number(process.versions.node.split('.')[0]), 24, 'NODE24_REQUIRED: no alternative-runtime PASS');
const f = require('../security/native-ordinary-host.test-support.cjs');
const { ProductError } = require('./product-contract.ts');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const FUNCTION = 'document_synthesis';
const RTF_TEXT = 'Synthetic local composition document. No clinical content.';
const RTF = Buffer.from(`{\\rtf1\\ansi ${RTF_TEXT}}`);
const GOVERNANCE_SEAM = Object.freeze({ syntheticOnly: true });
const PLATFORM_SEAM = Object.freeze({ syntheticOnly: true });
const localSignal = () => new AbortController().signal;
let events, counts, workerResults, extractionResults, ownedBytes, session, state, afterWorker, tamperWorkerResult, nativeCapture;
let pendingPreviews = [], workerExitCodes = [];

/* @Codex — only the unavailable execution boundary is controlled. Real flow owns
 * attempt lookup, native/application currentness, disclosure publication, command
 * routing and disposal. The seam never generates a successful provider result. */
f.replace('lib/chatgpt-execution/ordinary-governance.ts', {
    async readOrdinaryGovernance(functionId) {
        assert.equal(functionId, FUNCTION);
        events.push('governance');
        return { configuration: GOVERNANCE_SEAM };
    },
});
f.replace('lib/chatgpt-execution/execution-mac-product.ts', {
    createSharedMacProductPlatform() { return PLATFORM_SEAM; },
    reportMacProductPreparationDiagnostic() {},
});
f.replace('lib/chatgpt-execution/ordinary-product-attempt.ts', {
    async createOrdinaryProductAttempt(activeSession, platform, current) {
        assert.equal(activeSession, session);
        assert.equal(platform, PLATFORM_SEAM);
        assert.equal(current(), true);
        counts.attempts++;
        const revision = randomUUID();
        let phase = 'empty';
        const guard = () => {
            if (phase === 'closed' || !current()) throw new ProductError('revoked');
        };
        return Object.freeze({
            snapshot() { guard(); return { state: phase, expiresAt: activeSession.expiresAt }; },
            async prepare(_profile, _contextRevision, configuration, signal) {
                guard();
                assert.equal(phase, 'empty');
                assert.equal(configuration, GOVERNANCE_SEAM);
                assert.equal(signal.aborted, false);
                assert.equal(extractionResults.at(-1)?.status, 'extracted');
                events.push('attempt.prepare');
                phase = 'needs_consent';
                // Deliberately NOT a qualified disclosure or fake egress receipt.
                return Object.freeze({ revision, operation: FUNCTION, syntheticBoundaryOnly: true });
            },
            async consent(input) {
                guard();
                if (phase !== 'needs_consent' || input.operation !== FUNCTION
                    || input.expectedDisclosureRevision !== revision) throw new ProductError('invalid_request');
                counts.consents++;
                events.push('attempt.consent');
                phase = 'needs_login';
            },
            async generate() {
                guard();
                counts.generateCalls++;
                if (phase !== 'needs_login') throw new ProductError('invalid_state');
                // This is an observed dispatch INTENT, not a provider call or success.
                events.push('attempt.unqualified');
                throw new ProductError('unqualified_boundary');
            },
            isCurrent() { return false; },
            async dispose() { phase = 'closed'; counts.disposals++; return { cleanupConfirmed: true }; },
        });
    },
});

/* @Codex — pass-through observers always invoke the supplied real runner. */
const runner = require('../domain/documents/anydoc-local-extraction-runner.ts');
f.replace('lib/domain/documents/anydoc-local-extraction-runner.ts', {
    ...runner,
    async extractAnyDocLocalBytes(id, bytes) {
        counts.workers++;
        ownedBytes.push(bytes);
        const digest = sha256(bytes);
        events.push('worker.start');
        const processCount = counts.workerProcesses;
        const result = await runner.extractAnyDocLocalBytes(id, bytes);
        assert.equal(counts.workerProcesses, processCount + 1, 'real extraction must spawn the pinned worker');
        workerResults.push(result);
        assert.equal(result.provenance?.sourceSha256, digest);
        events.push(`worker.${result.status}`);
        afterWorker?.();
        return tamperWorkerResult ? tamperWorkerResult(result) : result;
    },
    async extractAnyDocPageRoutingBytes(bytes) {
        counts.routingWorkers++;
        const processCount = counts.workerProcesses;
        const result = await runner.extractAnyDocPageRoutingBytes(bytes);
        assert.equal(counts.workerProcesses, processCount + 1, 'real routing must re-run the pinned worker');
        assert.deepEqual(result, { schemaVersion: 'mediflow.anydoc_page_routing.v1', pages: [1], pageCount: 1 });
        events.push('worker.routing');
        return result;
    },
});

/* @Codex — canonical continuation stays real, including page processing. Only
 * the final OS recognizer returns an explicit denial. No platform impersonation,
 * OCR success fixture, recognized text or success receipt is introduced. */
function unavailableRecognizer(engine) {
    return async pages => {
        assert.equal(pages.length, 1);
        assert.equal(Buffer.from(pages[0]).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        counts.ocrBoundaries++;
        events.push(`ocr.unavailable.${engine}`);
        return Object.freeze({
            schemaVersion: engine === 'apple_vision'
                ? 'mediflow.anydoc_apple_vision_ocr_document.v1' : 'mediflow.anydoc_tesseract_document.v1',
            status: 'review_required', reason: 'engine_unavailable', review: 'required', writes: 0, apply: 'none',
        });
    };
}
const vision = require('../domain/documents/anydoc-apple-vision-ocr.ts');
f.replace('lib/domain/documents/anydoc-apple-vision-ocr.ts', {
    ...vision, extractAnyDocAppleVisionDocument: unavailableRecognizer('apple_vision'),
});
const pageOwner = require('../domain/documents/anydoc-pdf-child-process-owner.ts');
f.replace('lib/domain/documents/anydoc-pdf-child-process-owner.ts', {
    ...pageOwner, runAnyDocTesseractDocument: unavailableRecognizer('tesseract_wasm'),
});
const continuation = require('../domain/documents/anydoc-apple-vision-ocr-composition.ts');
f.replace('lib/domain/documents/anydoc-apple-vision-ocr-composition.ts', {
    ...continuation,
    async continueAnyDocImageOrScanWithLocalOcr(id, bytes, initial) {
        assert.equal(initial, workerResults.at(-1));
        assert.equal(initial.status, 'review_required');
        assert.equal(initial.detail, 'image_or_scan');
        assert.equal(initial.receipt.outcome, 'review_required:image_or_scan');
        events.push('ocr.continue');
        return continuation.continueAnyDocImageOrScanWithLocalOcr(id, bytes, initial);
    },
});
const currentSource = require('../domain/documents/anydoc-current-source-composition.ts');
f.replace('lib/domain/documents/anydoc-current-source-composition.ts', {
    ...currentSource,
    async composeAnyDocCurrentSelectionClientProjectionExtraction(...args) {
        const context = nativeComposition.getNativeOrdinaryApplicationContext();
        assert.equal(context?.session, session);
        assert.equal(context?.request.input.attachmentId, 'synthetic-attachment-1');
        nativeCapture = context.sources;
        assert.equal(source.nativeOrdinaryHostSourcesAreCurrent(nativeCapture), true);
        events.push('extraction.begin');
        const result = await currentSource.composeAnyDocCurrentSelectionClientProjectionExtraction(...args);
        extractionResults.push(result);
        events.push(`extraction.${result.status}`);
        return result;
    },
});
const nativeComposition = require('./native-ordinary-composition.ts');
const source = require('../security/server-session-clinical-context-native-sources.ts');
const flow = require('./ordinary-flow.ts');
const operationModule = require('../ai-providers/fabric/document-synthesis-production-operation.ts');
const { parseOrdinaryStoredSettings } = require('./ordinary-settings.ts');
const { NATIVE_PROJECTION_HEADER } = require('./native-ordinary-projection-wire.ts');
const { composeAnyDocCurrentSelectionClientProjectionExtraction } = require('../domain/documents/anydoc-current-source-composition.ts');

/* @Codex — use the exported test constructor of the REAL production operation.
 * This supplies the host lane/read dependencies, not an ingest implementation.
 * registerResource, capture, ingest, preview, discard and currentness stay real. */
const operations = operationModule.createDocumentSynthesisProductionOperationForTest({
    acquireContext: async () => nativeComposition.getNativeOrdinaryApplicationContext(),
    readCurrentness(id, patientId, ambulatoryId) {
        const row = f.rows.attachments.find(row => row.id === id && row.patientId === patientId);
        return row && f.rows.patientsToAmbulatories.some(row => row.patientId === patientId && row.ambulatoryId === ambulatoryId)
            ? { documentSourceRef: row.documentSourceRef, documentRevision: row.documentRevision,
                documentFreshnessEpoch: row.documentFreshnessEpoch } : null;
    },
    readLaneEnabled: () => true,
    extract: (activeSession, id, request) => composeAnyDocCurrentSelectionClientProjectionExtraction(activeSession, { attachmentId: id }, request),
    execute: async () => { f.counters.provider++; throw Error('NO_ALTERNATIVE_PROVIDER'); },
    entropy: () => randomBytes(16),
});
f.replace('lib/ai-providers/fabric/document-synthesis-production-operation.ts', {
    ...operationModule,
    async acquireDocumentSynthesisProductionOperation() {
        counts.acquisitions++;
        const operation = await operations.acquire();
        assert.ok(operation, 'real production operation must acquire the native context');
        // Preserve identity for the real private discard broker; do not wrap it.
        return operation;
    },
});

/* @Codex — observe the real preview handler so teardown awaits its cancellation. */
const previewHttp = require('../ai-providers/fabric/document-synthesis-production-http.ts');
f.replace('lib/ai-providers/fabric/document-synthesis-production-http.ts', {
    ...previewHttp,
    createDocumentSynthesisPreviewHttpHandler(dependencies) {
        const handler = previewHttp.createDocumentSynthesisPreviewHttpHandler(dependencies);
        return request => {
            events.push('preview.begin');
            const pending = handler(request);
            pendingPreviews.push(pending);
            return pending;
        };
    },
});

beforeEach(t => {
    f.reset();
    for (const table of ['entries', 'therapies', 'observations']) f.rows[table] = [];
    Object.assign(f.rows.patients[0], { notes: '', diagnoses: '[]' });
    Object.assign(f.rows.attachments[0], { name: 'synthetic-document', summarySnapshot: null });
    events = []; workerResults = []; extractionResults = []; ownedBytes = []; pendingPreviews = []; workerExitCodes = [];
    state = null; afterWorker = null; tamperWorkerResult = null; nativeCapture = null;
    counts = { acquisitions: 0, workers: 0, routingWorkers: 0, ocrBoundaries: 0,
        attempts: 0, consents: 0, generateCalls: 0, disposals: 0, freshReads: 0, network: 0, workerProcesses: 0 };
    f.setSetting('ai.fabric.chatgptOrdinary', JSON.stringify({ ...parseOrdinaryStoredSettings(), enabled: true }));
    session = f.issue();
    t.mock.method(globalThis, 'fetch', async () => { counts.network++; throw Error('NO_NETWORK'); });
    for (const verb of ['run', 'exec']) {
        if (!(verb in f.db.dbServer)) Object.defineProperty(f.db.dbServer, verb, { value() {}, configurable: true, writable: true });
        t.mock.method(f.db.dbServer, verb, () => { f.counters.clinicalWrites++; throw Error('NO_CLINICAL_WRITER'); });
    }
    const workerPath = path.join(f.root, 'scripts/anydoc-local-extraction-worker.mjs');
    // Observe and delegate: a parsed-text fixture cannot satisfy a real child exit.
    t.mock.method(childProcess, 'spawn', (command, args, options) => {
        const child = realSpawn(command, args, options);
        if (args?.[0] === workerPath) {
            assert.equal(command, process.execPath);
            counts.workerProcesses++;
            child.once('close', code => workerExitCodes.push(code));
        }
        return child;
    });
    const worker = readFileSync(workerPath);
    assert.equal(sha256(worker), '5d6e2e60f1d71f3fd45065961258a7debe8a96e017abdcee92823986c8f08c67');
});
afterEach(async () => {
    try {
        // Cancel precedes the currentness guard; querying stale status would throw.
        if (state?.attemptId) {
            try { await flow.ordinaryFunctionCommand(session, 'cancel', { attemptId: state.attemptId }, localSignal()); }
            catch (error) { assert.equal(error.code, 'invalid_state', 'only an already-closed attempt is tolerated'); }
        }
        flow.cancelOrdinaryGeneration();
        const settled = await Promise.allSettled(pendingPreviews);
        assert.ok(settled.every(result => result.status === 'fulfilled'), 'real preview handler settles on cancellation');
        assert.equal(f.counters.provider, 0);
        assert.equal(f.counters.clinicalWrites, 0);
        assert.equal(counts.network, 0);
        assert.equal(workerExitCodes.length, counts.workerProcesses, 'all observed real worker children closed');
        for (const bytes of ownedBytes) assert.ok(bytes.every(byte => byte === 0), 'source-owned byte copy must be wiped');
        assert.equal(counts.disposals, counts.attempts, 'every acquired product attempt must be disposed');
    } finally { flow.cancelOrdinaryGeneration(); f.reset(); }
});

/* @Codex — real AES-GCM in a synthetic NODE client, not Swift or HTTP proof.
 * The server never receives the key, and equality remains explicitly un-attested. */
function encryptedAttachment(bytes) {
    const key = randomBytes(32), iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const plaintext = `data:application/octet-stream;base64,${bytes.toString('base64')}`;
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    f.rows.attachments[0].data = `ENC:${iv.toString('base64')}:${ciphertext.toString('base64')}`;
    const stored = f.rows.attachments[0].data;
    return {
        stored,
        freshBytes(plan) {
            assert.deepEqual(plan.roster, [{ entity: 'attachment_bytes', id: 'synthetic-attachment-1', fields: ['data'] }]);
            counts.freshReads++;
            const row = f.rows.attachments.find(row => row.id === plan.roster[0].id);
            assert.ok(row);
            const [prefix, ivBase64, sealedBase64] = row.data.split(':');
            assert.equal(prefix, 'ENC');
            const sealed = Buffer.from(sealedBase64, 'base64');
            const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivBase64, 'base64'));
            decipher.setAuthTag(sealed.subarray(-16));
            const clear = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
            try { return Buffer.from(clear.toString('utf8').split(',')[1], 'base64'); }
            finally { clear.fill(0); }
        },
        dispose() { key.fill(0); },
    };
}
async function prepare() {
    const input = f.preparation(FUNCTION);
    const request = new Request('http://localhost/api/v1/network/ai/chatgpt/ordinary/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    // Exercise the actual composition with an already consumed ingress body.
    const response = await nativeComposition.prepareNativeOrdinary(request, session, await request.json());
    assert.equal(response.status, 202);
    const plan = await response.json();
    assert.equal(plan.phase, 'needs_source_projection');
    assert.equal(plan.functionId, FUNCTION);
    assert.equal(counts.acquisitions, 1);
    assert.equal(counts.workers, 0);
    assert.equal(counts.attempts, 0);
    assert.doesNotMatch(JSON.stringify(plan), /ENC:|Synthetic local|sourceText|markdown|captureHandle|previewHandle/);
    return plan.sourceProjection;
}
function project(plan, bytes, type = 'application/octet-stream') {
    return nativeComposition.projectNativeOrdinary(new Request('http://localhost/api/v1/network/ai/chatgpt/ordinary/project', {
        method: 'POST', headers: { 'Content-Type': type, [NATIVE_PROJECTION_HEADER]: plan.grantId }, body: bytes,
    }), session);
}
async function consentState(plan, client) {
    const response = await project(plan, client.freshBytes(plan));
    assert.equal(response.status, 202);
    state = await response.json();
    assert.equal(state.phase, 'needs_consent');
    assert.equal(state.functionId, FUNCTION);
    assert.deepEqual(state.acquisition, { origin: 'authenticated_client_decryption', ciphertextEquality: 'not_attested' });
    assert.equal(counts.attempts, 1);
    assert.equal(counts.consents, 0);
    assert.equal(counts.generateCalls, 0);
    assert.equal(counts.network, 0);
    assert.equal(pendingPreviews.length, 1, 'real original preview handler remains pending at consent');
    assert.equal(source.nativeOrdinaryHostSourcesAreCurrent(nativeCapture), true, 'final witness outlives source-byte finalization');
    for (const bytes of ownedBytes) assert.ok(bytes.every(byte => byte === 0));
    return state;
}
function assertExtracted(bytes) {
    assert.equal(workerResults.length, 1);
    const result = extractionResults.at(-1);
    assert.equal(result.status, 'extracted');
    assert.equal(result.markdown, RTF_TEXT);
    assert.equal(result.provenance.sourceSha256, sha256(bytes));
    assert.equal(result.receipt.parser, 'anydoc-local');
    assert.equal(result.receipt.outcome, 'extracted');
    assert.equal(result.receipt.markdownSha256, sha256(RTF_TEXT));
    assert.equal(result.receipt.sourceByteLength, bytes.length);
    assert.deepEqual([result.review, result.writes, result.apply, result.candidateUse], ['required', 0, 'none', 'review_only']);
    assert.equal(Object.hasOwn(result.receipt, 'ocrProvenance'), false);
    assert.equal(Object.getPrototypeOf(result), null);
    assert.equal(Object.isFrozen(result), true);
}

function replaceOwnValue(record, key, value) {
    const descriptors = Object.getOwnPropertyDescriptors(record);
    assert.ok(descriptors[key] && 'value' in descriptors[key]);
    descriptors[key] = { ...descriptors[key], value };
    return Object.freeze(Object.create(Object.getPrototypeOf(record), descriptors));
}

function corruptClosedLineage(result, target) {
    assert.equal(result.status, 'extracted');
    if (target === 'provenance.attachmentId') {
        return replaceOwnValue(result, 'provenance', replaceOwnValue(result.provenance, 'attachmentId', 'foreign-attachment'));
    }
    assert.equal(target, 'receipt.sourceSha256');
    return replaceOwnValue(result, 'receipt', replaceOwnValue(result.receipt, 'sourceSha256', 'f'.repeat(64)));
}

/* @Codex — single-page scan derived from the existing AnyDoc runner fixture.
 * It contains only a gray raster; no invented OCR text can make this test pass. */
function scannedPdf() {
    const content = 'q 468 0 0 648 72 72 cm /Im1 Do Q';
    const objects = [
        Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
        Buffer.from('<< /Type /Pages /Kids [4 0 R] /Count 1 >>'),
        Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n'), Buffer.from([0x80]), Buffer.from('\nendstream')]),
        Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 3 0 R >> >> /Contents 5 0 R >>'),
        Buffer.from(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`),
    ];
    const parts = [Buffer.from('%PDF-1.4\n')], offsets = [];
    for (const [index, object] of objects.entries()) {
        offsets.push(parts.reduce((length, part) => length + part.length, 0));
        parts.push(Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n'));
    }
    const start = parts.reduce((length, part) => length + part.length, 0);
    const xref = offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    parts.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${xref}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`));
    return Buffer.concat(parts);
}

test('native ENC full composition: real AnyDoc/DS preview reaches consent, never dispatches during preparation', async t => {
    const client = encryptedAttachment(RTF); t.after(() => client.dispose());
    const plan = await prepare();
    const disclosure = await consentState(plan, client);
    assertExtracted(RTF);
    assert.equal(counts.freshReads, 1);
    assert.equal(counts.workers, 1);
    assert.deepEqual(workerExitCodes, [0], 'the real AnyDoc worker exited successfully');
    assert.equal(counts.ocrBoundaries, 0);
    assert.ok(events.indexOf('extraction.extracted') < events.indexOf('attempt.prepare'));
    assert.equal(f.rows.attachments[0].data, client.stored);
    await assert.rejects(project(plan, client.freshBytes(plan)), { code: 'revoked' });
    assert.equal(counts.workers, 1, 'successful grant is not replayable');
    const consent = await flow.ordinaryFunctionCommand(session, 'consent', {
        attemptId: disclosure.attemptId, expectedDisclosureRevision: disclosure.disclosure.revision,
    }, localSignal());
    assert.equal((await consent.json()).phase, 'needs_login');
    assert.equal(counts.consents, 1);
    assert.equal(counts.generateCalls, 0, 'consent alone is not dispatch');
    await assert.rejects(flow.ordinaryFunctionCommand(session, 'generate', {
        attemptId: disclosure.attemptId, modelOptionId: 'synthetic-unqualified', expectedCatalogRevision: 'synthetic-unqualified',
    }, localSignal()), { code: 'unqualified_boundary' });
    assert.equal(counts.generateCalls, 1, 'explicit command reaches only the deny-only execution seam');
    assert.equal(f.rows.attachments[0].data, client.stored);
});

test('native scanned ENC reaches canonical OCR continuation; unavailable recognizer never fabricates ingest or a proposal', async t => {
    const client = encryptedAttachment(scannedPdf()); t.after(() => client.dispose());
    const plan = await prepare();
    await assert.rejects(project(plan, client.freshBytes(plan)), { code: 'invalid_state' });
    assert.equal(workerResults[0].detail, 'image_or_scan');
    assert.equal(counts.routingWorkers, 1);
    assert.equal(workerExitCodes[0], 21, 'the real AnyDoc process requested OCR');
    assert.ok(workerExitCodes.filter(code => code === 21).length >= 2, 'real routing re-read also requested OCR');
    assert.equal(counts.ocrBoundaries, 1);
    assert.ok(events.includes(`ocr.unavailable.${process.platform === 'darwin' ? 'apple_vision' : 'tesseract_wasm'}`));
    const result = extractionResults.at(-1);
    assert.equal(result.status, 'review_required');
    assert.equal(result.detail, 'io_failure');
    assert.equal(result.markdown, '');
    assert.equal(result.candidateUse, 'blocked');
    assert.deepEqual([result.review, result.writes, result.apply], ['required', 0, 'none']);
    assert.equal(Object.hasOwn(result.receipt, 'ocrProvenance'), false);
    assert.equal(counts.attempts, 0);
    assert.equal(f.rows.attachments[0].data, client.stored);
});

test('native prepare rejects forged text/source metadata before operation acquisition', async () => {
    for (const extra of [{ sourceText: 'FORGED' }, { sourceSha256: 'b'.repeat(64) }, { bytes: [1, 2, 3] }]) {
        const input = f.preparation(FUNCTION); input.input = { ...input.input, ...extra };
        await assert.rejects(nativeComposition.prepareNativeOrdinary(new Request('http://localhost/synthetic'), session, input), { code: 'invalid_request' });
    }
    assert.equal(counts.acquisitions, 0);
    assert.equal(counts.workers, 0);
    assert.equal(counts.attempts, 0);
});

test('native project rejects JSON text instead of the grant-owned binary source', async t => {
    const client = encryptedAttachment(RTF); t.after(() => client.dispose());
    const plan = await prepare();
    await assert.rejects(project(plan, JSON.stringify({ sourceText: 'FORGED' }), 'application/json'), { code: 'invalid_request' });
    await assert.rejects(project(plan, client.freshBytes(plan)), { code: 'revoked' });
    assert.equal(counts.workers, 0);
    assert.equal(counts.attempts, 0);
});

for (const change of ['documentRevision', 'documentFreshnessEpoch', 'data']) test(`native ${change} change before ingest denies without worker or consent`, async t => {
    const client = encryptedAttachment(RTF); t.after(() => client.dispose());
    const plan = await prepare(), bytes = client.freshBytes(plan);
    if (change === 'data') f.rows.attachments[0].data += 'changed';
    else f.rows.attachments[0][change]++;
    await assert.rejects(project(plan, bytes), { code: 'revoked' });
    assert.equal(counts.workers, 0);
    assert.equal(counts.attempts, 0);
});

test('native session revocation before ingest denies without worker or consent', async t => {
    const client = encryptedAttachment(RTF); t.after(() => client.dispose());
    const plan = await prepare(), bytes = client.freshBytes(plan);
    f.owner.serverSessions.deleteSession(session.id);
    await assert.rejects(project(plan, bytes), { code: 'revoked' });
    assert.equal(counts.workers, 0);
    assert.equal(counts.attempts, 0);
});

test('native source change after real worker completion is vetoed before ingest/preview publication', async t => {
    const client = encryptedAttachment(RTF); t.after(() => client.dispose());
    const plan = await prepare();
    afterWorker = () => { f.rows.attachments[0].documentFreshnessEpoch++; };
    await assert.rejects(project(plan, client.freshBytes(plan)), { code: 'invalid_state' });
    assert.equal(counts.workers, 1);
    assert.equal(workerResults[0].status, 'extracted', 'mutation is after real parser completion, not an IO failure');
    assert.equal(extractionResults[0].status, 'denied');
    assert.equal(Object.hasOwn(extractionResults[0], 'markdown'), false);
    assert.equal(counts.attempts, 0);
});

for (const target of ['provenance.attachmentId', 'receipt.sourceSha256']) test(`native rejects tampered AnyDoc ${target} before original ingest/preview publication`, async t => {
    const client = encryptedAttachment(RTF); t.after(() => client.dispose());
    const plan = await prepare();
    tamperWorkerResult = result => corruptClosedLineage(result, target);
    await assert.rejects(project(plan, client.freshBytes(plan)), { code: 'invalid_state' });
    assert.equal(counts.workers, 1);
    assert.equal(workerResults[0].status, 'extracted', 'the pinned worker still completed successfully');
    assert.equal(extractionResults[0].status, 'extracted', 'the wrapper changed only the result passed to original ingest');
    if (target === 'provenance.attachmentId') assert.equal(extractionResults[0].provenance.attachmentId, 'foreign-attachment');
    else assert.equal(extractionResults[0].receipt.sourceSha256, 'f'.repeat(64));
    assert.equal(counts.attempts, 0);
    assert.equal(pendingPreviews.length, 0, 'the original preview was never published');
    assert.equal(events.includes('preview.begin'), false);
});

test('native final witness remains live after AnyDoc finalize and blocks dispatch on ciphertext change', async t => {
    const client = encryptedAttachment(RTF); t.after(() => client.dispose());
    const plan = await prepare();
    await consentState(plan, client);
    assertExtracted(RTF);
    await flow.ordinaryFunctionCommand(session, 'consent', {
        attemptId: state.attemptId, expectedDisclosureRevision: state.disclosure.revision,
    }, localSignal());
    f.rows.attachments[0].data += 'changed-after-finalize';
    await assert.rejects(flow.ordinaryFunctionCommand(session, 'generate', {
        attemptId: state.attemptId, modelOptionId: 'synthetic-unqualified', expectedCatalogRevision: 'synthetic-unqualified',
    }, localSignal()), { code: 'revoked' });
    assert.equal(counts.generateCalls, 0, 'real flow vetoes before the execution seam');
});
