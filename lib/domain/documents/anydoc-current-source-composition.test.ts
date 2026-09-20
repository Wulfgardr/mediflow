/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, test } from 'node:test';
import { createCanvas } from '@napi-rs/canvas';
import Database from 'better-sqlite3';
import { PDFDocument } from 'pdf-lib';
import type { ServerSession } from '../../security/server-session.ts';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-anydoc-p1d-'));
const dbPath = path.join(dataDir, 'medical.db');
const migrationDb = new Database(dbPath);
migrationDb.pragma('foreign_keys = OFF');
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter((file) => file.endsWith('.sql')).sort())
    migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gm, ''));
migrationDb.close();
process.env.MEDIFLOW_DATA_DIR = dataDir;

const compositionModule = await import('./anydoc-current-source-composition.ts');
const productionOwnerModule = await import('../../security/server-session-projection-owner-production.ts');
const webFixtureModule = await import('../../security/web-auth-lifecycle-owner-test-fixture.ts');
const { composeAnyDocCurrentSourceExtraction, composeAnyDocCurrentSelectionExtraction } = compositionModule;
const { serverSessionProjectionOwnerRegistry } = productionOwnerModule;
const { issueSyntheticWebSession, issueSyntheticWebSessionContext, retireSyntheticWebSession } = webFixtureModule;
const { retire } = await import('../../security/web-auth-lifecycle-owner-adapter.ts');
const { acquireAttachmentExtractionProjection } = await import('./attachment-extraction-projection-broker.ts');
const { composeAnyDocClientProjectionExtraction } = compositionModule;
const { encryptData, decryptData } = await import('../../security/security.ts');
const PATIENT = 'patient.synthetic.p1d';
const ATTACHMENT = 'attachment.synthetic.p1d';
const AMBULATORY = 'ambulatory.synthetic.p1d';
const OTHER_AMBULATORY = 'ambulatory.synthetic.other.p1d';
const REF = 'c'.repeat(64);
const RTF = Buffer.from('{\\rtf1\\ansi Synthetic current source note.}', 'utf8');
const MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;
const finalSessions: ServerSession[] = [];
let sessionSequence = 0;

function seed(data = RTF.toString('base64')) {
    const db = new Database(dbPath); db.pragma('foreign_keys = ON');
    try {
        db.exec('DELETE FROM attachments; DELETE FROM patients_to_ambulatories; DELETE FROM patients; DELETE FROM ambulatories;');
        db.prepare('INSERT INTO ambulatories (id, name, type) VALUES (?, ?, ?), (?, ?, ?)')
            .run(AMBULATORY, 'Ambulatorio sintetico', 'test', OTHER_AMBULATORY, 'Altro sintetico', 'test');
        db.prepare('INSERT INTO patients (id, first_name, last_name, tax_code) VALUES (?, ?, ?, ?)')
            .run(PATIENT, 'Ada', 'Synthetic', 'SYNTHETIC00000002');
        db.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)').run(PATIENT, AMBULATORY);
        db.prepare('INSERT INTO attachments (id, patient_id, name, type, size, path, data, document_source_ref, document_revision, document_freshness_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)')
            .run(ATTACHMENT, PATIENT, 'synthetic.rtf', 'application/rtf', RTF.byteLength, 'synthetic.rtf', data, REF);
    } finally { db.close(); }
}
function session() {
    const value = issueSyntheticWebSession({ id: 'user.synthetic.p1d', username: ['clinician', 'synthetic', 'p1d'].join('.'), role: 'clinician' },
        `anydoc-current-source-${sessionSequence += 1}`);
    finalSessions.push(value);
    return value;
}
async function syntheticScannedPdf(): Promise<Buffer> {
    const canvas = createCanvas(1600, 500); const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000'; context.font = 'bold 92px Helvetica';
    context.fillText('DOCUMENTO SINTETICO', 60, 210);
    context.font = '56px Helvetica'; context.fillText('Controllo locale offline', 60, 340);
    const document = await PDFDocument.create(); const page = document.addPage([800, 250]);
    const raster = await document.embedPng(canvas.toBuffer('image/png'));
    page.drawImage(raster, { x: 0, y: 0, width: 800, height: 250 });
    return Buffer.from(await document.save({ useObjectStreams: false }));
}
afterEach(() => {
    while (finalSessions.length > 0) retireSyntheticWebSession(finalSessions.pop()!);
});
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('reveals real AnyDoc Markdown and evidence only after a current host source finalizes', async () => {
    seed(); const activeSession = session();
    assert.equal(serverSessionProjectionOwnerRegistry.lookup(activeSession.id), null);
    const result = await composeAnyDocCurrentSourceExtraction(activeSession, { attachmentId: ATTACHMENT });
    assert.equal(result.status, 'extracted');
    if (result.status !== 'extracted') return;
    assert.equal(result.markdown, 'Synthetic current source note.');
    assert.equal(result.provenance.attachmentId, ATTACHMENT);
    assert.equal(result.receipt.outcome, 'extracted');
    assert.equal(result.writes, 0); assert.equal(result.apply, 'none'); assert.equal(Object.isFrozen(result), true);
    const owner = serverSessionProjectionOwnerRegistry.lookup(activeSession.id); assert.ok(owner);
    assert.deepEqual(owner.withLeaseCriticalSection(activeSession, (selection) => selection), { patientId: PATIENT, ambulatoryId: AMBULATORY });
});

test('current-selection extraction preserves a confirmed lease with multiple valid memberships', async () => {
    seed(); const activeSession = session();
    const db = new Database(dbPath);
    db.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)').run(PATIENT, OTHER_AMBULATORY);
    db.close();
    const owner = serverSessionProjectionOwnerRegistry.acquire(activeSession);
    const selection = owner.issueSelection({ expectedEpoch: 0, patientId: PATIENT, ambulatoryId: OTHER_AMBULATORY });
    const result = await composeAnyDocCurrentSelectionExtraction(activeSession, { attachmentId: ATTACHMENT });
    assert.equal(result.status, 'extracted');
    if (result.status !== 'extracted') return;
    assert.equal(result.markdown, 'Synthetic current source note.');
    assert.deepEqual([owner.snapshotSelectionEpoch(activeSession), owner.snapshotReviewContextEpoch(activeSession)], [1, 1]);
    const { expiresAt, ...tuple } = selection;
    assert.equal(expiresAt, activeSession.expiresAt);
    assert.deepEqual(owner.dereferenceSelection(activeSession, tuple), { patientId: PATIENT, ambulatoryId: OTHER_AMBULATORY });
});

test('current-selection extraction denies missing, foreign and stale selections without selecting', async () => {
    for (const state of ['missing', 'foreign', 'version', 'membership'] as const) {
        seed(); const activeSession = session();
        const owner = serverSessionProjectionOwnerRegistry.acquire(activeSession);
        const db = new Database(dbPath);
        try {
            if (state === 'foreign') {
                db.prepare('INSERT INTO patients (id, first_name, last_name, tax_code) VALUES (?, ?, ?, ?)')
                    .run('patient.synthetic.foreign', 'Altra', 'Sintetica', 'SYNTHETIC00000003');
                db.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)')
                    .run('patient.synthetic.foreign', AMBULATORY);
            }
            if (state !== 'missing') owner.issueSelection({ expectedEpoch: 0,
                patientId: state === 'foreign' ? 'patient.synthetic.foreign' : PATIENT, ambulatoryId: AMBULATORY });
            if (state === 'version') db.prepare('UPDATE patients SET version = version + 1 WHERE id = ?').run(PATIENT);
            if (state === 'membership') db.prepare('DELETE FROM patients_to_ambulatories WHERE patient_id = ?').run(PATIENT);
        } finally { db.close(); }
        const result = await composeAnyDocCurrentSelectionExtraction(activeSession, { attachmentId: ATTACHMENT });
        assert.equal(result.status, 'denied', state);
        assert.equal('markdown' in result, false); assert.equal('receipt' in result, false);
        if (state === 'missing' || state === 'foreign') {
            const expected = state === 'missing' ? 0 : 1;
            assert.deepEqual([owner.snapshotSelectionEpoch(activeSession), owner.snapshotReviewContextEpoch(activeSession)], [expected, expected]);
        }
    }
});

test('current-selection extraction discards source, version and membership changes while the real worker runs', async () => {
    for (const changed of ['source', 'version', 'membership'] as const) {
        seed(); const activeSession = session();
        serverSessionProjectionOwnerRegistry.acquire(activeSession)
            .issueSelection({ expectedEpoch: 0, patientId: PATIENT, ambulatoryId: AMBULATORY });
        const pending = composeAnyDocCurrentSelectionExtraction(activeSession, { attachmentId: ATTACHMENT });
        const db = new Database(dbPath);
        try {
            if (changed === 'source') db.prepare('UPDATE attachments SET document_revision = 2, document_freshness_epoch = 2 WHERE id = ?').run(ATTACHMENT);
            if (changed === 'version') db.prepare('UPDATE patients SET version = version + 1 WHERE id = ?').run(PATIENT);
            if (changed === 'membership') db.prepare('DELETE FROM patients_to_ambulatories WHERE patient_id = ?').run(PATIENT);
        } finally { db.close(); }
        const result = await pending;
        assert.equal(result.status, 'denied', changed);
        assert.equal('markdown' in result, false); assert.equal('receipt' in result, false);
    }
});

test('current-selection extraction denies a real reselection in flight', async () => {
    seed(); const activeSession = session();
    const owner = serverSessionProjectionOwnerRegistry.acquire(activeSession);
    owner.issueSelection({ expectedEpoch: 0, patientId: PATIENT, ambulatoryId: AMBULATORY });
    const pending = composeAnyDocCurrentSelectionExtraction(activeSession, { attachmentId: ATTACHMENT });
    assert.deepEqual([owner.snapshotSelectionEpoch(activeSession), owner.snapshotReviewContextEpoch(activeSession)], [1, 1]);
    owner.issueSelection({ expectedEpoch: 1, patientId: PATIENT, ambulatoryId: AMBULATORY });
    const result = await pending;
    assert.equal(result.status, 'denied');
    assert.equal('markdown' in result, false); assert.equal('receipt' in result, false);
});

test('current-selection extraction denies a confirmed Web lock in flight', async () => {
    seed();
    const web = issueSyntheticWebSessionContext({ id: 'user.synthetic.lock', username: path.basename(dataDir), role: 'clinician' },
        `anydoc-current-selection-lock-${sessionSequence += 1}`);
    finalSessions.push(web.session);
    serverSessionProjectionOwnerRegistry.acquire(web.session)
        .issueSelection({ expectedEpoch: 0, patientId: PATIENT, ambulatoryId: AMBULATORY });
    const pending = composeAnyDocCurrentSelectionExtraction(web.session, { attachmentId: ATTACHMENT });
    assert.equal(retire(web.session, 'lock', { controlId: web.controlId, ifMatch: web.etag,
        idempotencyKey: 'synthetic-anydoc-current-selection-lock' }).outcome, 'completed');
    const result = await pending;
    assert.equal(result.status, 'denied');
    assert.equal('markdown' in result, false); assert.equal('receipt' in result, false);
});

test('continues a real AnyDoc image_or_scan result through offline Apple Vision', {
    skip: process.platform !== 'darwin' || process.arch !== 'arm64',
}, async () => {
    const pdf = await syntheticScannedPdf(); seed(pdf.toString('base64'));
    const result = await composeAnyDocCurrentSourceExtraction(session(), { attachmentId: ATTACHMENT });
    assert.equal(result.status, 'extracted');
    if (result.status !== 'extracted') return;
    assert.match(result.markdown, /DOCUMENTO SINTETICO/iu);
    assert.match(result.markdown, /Controllo locale offline/iu);
    assert.equal(result.provenance.sourceSha256, createHash('sha256').update(pdf).digest('hex'));
    assert.equal(result.receipt.ocrProvenance?.schemaVersion, 'mediflow.anydoc_local_ocr_provenance.v1');
    assert.equal(result.receipt.ocrProvenance?.engine, 'apple_vision');
    assert.deepEqual([result.receipt.ocrProvenance?.pageCount, result.receipt.ocrProvenance?.ocrPageCount], [1, 1]);
    assert.match(result.receipt.ocrProvenance?.scriptSha256 ?? '', /^[a-f0-9]{64}$/u);
    assert.match(result.receipt.ocrProvenance?.receiptSetSha256 ?? '', /^[a-f0-9]{64}$/u);
    assert.equal(Object.getPrototypeOf(result.receipt.ocrProvenance!), null);
    assert.equal(Object.isFrozen(result.receipt.ocrProvenance), true);
    assert.deepEqual([result.review, result.writes, result.apply, result.candidateUse], ['required', 0, 'none', 'review_only']);
});

test('denies zero or multiple host memberships without publishing candidate evidence', async () => {
    seed();
    const db = new Database(dbPath);
    db.prepare('DELETE FROM patients_to_ambulatories WHERE patient_id = ?').run(PATIENT);
    db.close();
    let result = await composeAnyDocCurrentSourceExtraction(session(), { attachmentId: ATTACHMENT });
    assert.equal(result.status, 'denied'); assert.equal('markdown' in result, false); assert.equal('provenance' in result, false);

    seed();
    const multi = new Database(dbPath);
    multi.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)').run(PATIENT, OTHER_AMBULATORY);
    multi.close();
    result = await composeAnyDocCurrentSourceExtraction(session(), { attachmentId: ATTACHMENT });
    assert.equal(result.status, 'denied'); assert.equal('markdown' in result, false); assert.equal('receipt' in result, false);
});

test('denies expired and logged-out authenticated sessions before source authority publication', async () => {
    seed(); const active = session();
    const expired = Object.freeze({ ...active, expiresAt: 0 }) as ServerSession;
    let result = await composeAnyDocCurrentSourceExtraction(expired, { attachmentId: ATTACHMENT });
    assert.equal(result.status, 'denied'); assert.equal('provenance' in result, false);
    const loggedOut = session(); retireSyntheticWebSession(loggedOut);
    result = await composeAnyDocCurrentSourceExtraction(loggedOut, { attachmentId: ATTACHMENT });
    assert.equal(result.status, 'denied'); assert.equal('provenance' in result, false);
});

test('discards completed worker output when attachment currentness changes in flight', async () => {
    seed(); const pending = composeAnyDocCurrentSourceExtraction(session(), { attachmentId: ATTACHMENT });
    const db = new Database(dbPath);
    db.prepare('UPDATE attachments SET document_revision = 2, document_freshness_epoch = 2 WHERE id = ?').run(ATTACHMENT);
    db.close();
    const result = await pending;
    assert.equal(result.status, 'denied');
    assert.equal(Object.getPrototypeOf(result), null);
    assert.deepEqual(Reflect.ownKeys(result), ['schemaVersion', 'status', 'reason', 'field', 'review', 'writes', 'apply', 'candidateUse']);
    assert.equal('markdown' in result, false); assert.equal('provenance' in result, false); assert.equal('receipt' in result, false);
});

test('discards completed worker output when the authenticated session is revoked in flight', async () => {
    seed(); const activeSession = session();
    const pending = composeAnyDocCurrentSourceExtraction(activeSession, { attachmentId: ATTACHMENT });
    retireSyntheticWebSession(activeSession);
    const result = await pending;
    assert.equal(result.status, 'denied'); assert.equal('markdown' in result, false); assert.equal('provenance' in result, false);
});

test('returns only finalized review-required evidence for unsupported local extraction', async () => {
    seed(Buffer.from([0, 1, 2, 3]).toString('base64'));
    const result = await composeAnyDocCurrentSourceExtraction(session(), { attachmentId: ATTACHMENT });
    assert.equal(result.status, 'review_required');
    if (result.status !== 'review_required') return;
    assert.equal(result.reason, 'unsupported_local_extraction'); assert.equal(result.detail, 'unsupported_format');
    assert.equal(result.markdown, ''); assert.equal(result.candidateUse, 'blocked'); assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.getPrototypeOf(result), null);
    assert.equal(Object.getPrototypeOf(result.provenance), null); assert.equal(Object.getPrototypeOf(result.receipt), null);
});

test('finalizes a real worker resource-limit outcome without candidate content', async () => {
    seed(Buffer.from(`{\\rtf1\\ansi ${'x'.repeat(MAX_MARKDOWN_BYTES + 1)}}`, 'utf8').toString('base64'));
    const result = await composeAnyDocCurrentSourceExtraction(session(), { attachmentId: ATTACHMENT });
    assert.equal(result.status, 'review_required');
    if (result.status !== 'review_required') return;
    assert.equal(result.detail, 'resource_limit'); assert.equal(result.markdown, ''); assert.equal(result.candidateUse, 'blocked');
});

test('denies a reselection while the real worker is in flight without publishing its result', async () => {
    seed(); const activeSession = session();
    const pending = composeAnyDocCurrentSourceExtraction(activeSession, { attachmentId: ATTACHMENT });
    serverSessionProjectionOwnerRegistry.acquire(activeSession)
        .issueSelection({ expectedEpoch: 1, patientId: PATIENT, ambulatoryId: AMBULATORY });
    const result = await pending;
    assert.equal(result.status, 'denied'); assert.equal('markdown' in result, false); assert.equal('receipt' in result, false);
});

test('denies hostile selectors before reflection or worker execution', async () => {
    seed(); const activeSession = session(); let reads = 0;
    const proxy = new Proxy({ attachmentId: ATTACHMENT }, { getPrototypeOf() { reads += 1; throw new Error('raw'); } });
    const accessor = Object.defineProperty({}, 'attachmentId', { enumerable: true, get() { reads += 1; return ATTACHMENT; } });
    const values = [proxy, accessor, Object.defineProperty({}, 'attachmentId', { value: ATTACHMENT }),
        { attachmentId: ATTACHMENT, provider: 'forbidden' }, { attachmentId: () => ATTACHMENT }];
    for (const value of values) {
        const result = await composeAnyDocCurrentSourceExtraction(activeSession, value);
        assert.equal(result.status, 'denied'); assert.equal('provenance' in result, false);
    }
    assert.equal(reads, 0);
});

test('publishes an exact null-prototype result without ambient then assimilation', async () => {
    seed();
    const result = await composeAnyDocCurrentSourceExtraction(session(), { attachmentId: ATTACHMENT });
    let reads = 0; const unhandled: unknown[] = [];
    const priorThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
        Object.defineProperty(Object.prototype, 'then', {
            configurable: true,
            get() { reads += 1; throw new Error('ambient then'); },
        });
        await Promise.resolve(result);
        assert.equal(result.status, 'extracted');
        assert.equal(Object.getPrototypeOf(result), null);
        assert.equal(Object.isFrozen(result), true);
        assert.deepEqual(Reflect.ownKeys(result), [
            'schemaVersion', 'provenance', 'receipt', 'review', 'writes', 'apply', 'status', 'markdown', 'candidateUse',
        ]);
        if (result.status !== 'extracted') return;
        assert.equal(Object.getPrototypeOf(result.provenance), null);
        assert.equal(Object.getPrototypeOf(result.receipt), null);
        for (const value of [result, result.provenance, result.receipt]) {
            for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
                assert.equal('value' in descriptor, true); assert.equal(descriptor.enumerable, true);
                assert.equal(descriptor.configurable, false); assert.equal(descriptor.writable, false);
            }
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(reads, 0); assert.deepEqual(unhandled, []);
    } finally {
        process.off('unhandledRejection', onUnhandled);
        if (priorThen) Object.defineProperty(Object.prototype, 'then', priorThen);
        else delete (Object.prototype as { then?: unknown }).then;
    }
});

test('keeps the composition callback-free and outside P4, routes, storage, and logging', () => {
    const source = fs.readFileSync(new URL('./anydoc-current-source-composition.ts', import.meta.url), 'utf8');
    assert.match(source, /bindAttachmentExtractionSelection\(session, id\)/u);
    assert.match(source, /createAttachmentExtractionSourceAuthority\(session\)/u);
    assert.match(source, /await extractAnyDocLocalBytes\(id, begun\.bytes\)/u);
    assert.match(source, /authority\.finalize\(operation\)/u);
    assert.doesNotMatch(source, /withLeaseCriticalSection|callback|runnerValue|sourceValue|provider|config|console|app\/api|insert\(|update\(|delete\(/iu);
    assert.doesNotMatch(source, /export async function composeAnyDocCurrentSourceExtraction\([^)]*=>/u);
    const bindingAt = source.indexOf('bindAttachmentExtractionSelection(session, id)');
    const authorityAt = source.indexOf('createAttachmentExtractionSourceAuthority(session)');
    const finalizeAt = source.indexOf('const final = authority.finalize(operation)');
    const publishAt = source.indexOf('? publishFinalizedResult(result)');
    assert.ok(bindingAt >= 0); assert.ok(authorityAt > bindingAt);
    assert.ok(finalizeAt > authorityAt); assert.ok(publishAt > finalizeAt);
});

test('admits the complete local OCR continuation before page work and releases it on every exit', () => {
    const source = fs.readFileSync(new URL('./anydoc-apple-vision-ocr-composition.ts', import.meta.url), 'utf8');
    const admissionAt = source.indexOf('if (activeLocalOcrDocument)');
    const routingAt = source.indexOf('await extractAnyDocPageRoutingBytes(bytes)');
    assert.ok(admissionAt >= 0); assert.ok(routingAt > admissionAt);
    assert.match(source, /return mapAnyDocLocalFailure\(source, 'resourceLimit'\)/u);
    assert.match(source, /finally \{ activeLocalOcrDocument = false; \}/u);
});

/* @Codex: production SQLite/migrations + unchanged security primitives + real AnyDoc worker.
 * These tests require the canonical Node24 dependency tree; the delivery harness does not replace this gate. */

async function seedEncrypted(bytes: Buffer = RTF) {
    const masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const plaintext = `data:application/rtf;base64,${bytes.toString('base64')}`;
    const encrypted = await encryptData(plaintext, masterKey);
    const ciphertext = `ENC:${encrypted.iv}:${encrypted.data}`;
    seed(ciphertext);
    return { ciphertext, masterKey };
}
function projectionRequest(bytes: Uint8Array): Request {
    return new Request(`http://127.0.0.1/api/attachments/${ATTACHMENT}/local-extraction`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes).buffer,
    });
}
function persistedAttachment() {
    const db = new Database(dbPath);
    try { return db.prepare('SELECT * FROM attachments WHERE id = ?').get(ATTACHMENT) as Record<string, unknown>; }
    finally { db.close(); }
}

test('ordinary ENC persistence can produce real AnyDoc preview via authenticated client decryption, never a plaintext DB write', async () => {
    const { ciphertext, masterKey } = await seedEncrypted(); const active = session();
    const before = persistedAttachment();
    assert.equal((await composeAnyDocCurrentSourceExtraction(active, { attachmentId: ATTACHMENT })).status, 'denied');
    const grant = acquireAttachmentExtractionProjection(active, ATTACHMENT); assert.ok(grant);
    const [, iv, sealed] = ciphertext.split(':');
    const source = await decryptData(sealed!, iv!, masterKey); assert.equal(typeof source, 'string');
    const bytes = Buffer.from((source as string).split(',')[1]!, 'base64');
    const response = await composeAnyDocClientProjectionExtraction(active, { attachmentId: ATTACHMENT }, grant.grantId, projectionRequest(bytes));
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const envelope = await response.json();
    assert.deepEqual(envelope.acquisition, { origin: 'authenticated_client_decryption', ciphertextEquality: 'not_attested',
        canonicalSource: { sourceRef: REF, revision: 1, freshnessEpoch: 1 } });
    assert.equal(envelope.extraction.status, 'extracted'); assert.equal(envelope.extraction.markdown, 'Synthetic current source note.');
    assert.equal(envelope.extraction.provenance.sourceSha256, createHash('sha256').update(RTF).digest('hex'));
    assert.deepEqual([envelope.extraction.review, envelope.extraction.writes, envelope.extraction.apply], ['required', 0, 'none']);
    assert.deepEqual(persistedAttachment(), before); assert.match(persistedAttachment().data as string, /^ENC:/);
    assert.equal((await composeAnyDocClientProjectionExtraction(active, { attachmentId: ATTACHMENT }, grant.grantId, projectionRequest(bytes))).status, 409);
});

for (const change of ['revision', 'ciphertext-only', 'delete', 'selection', 'revoke'] as const)
    test(`encrypted source ${change} cannot publish from a previously acquired projection grant`, async () => {
        await seedEncrypted(); const active = session();
        const grant = acquireAttachmentExtractionProjection(active, ATTACHMENT); assert.ok(grant);
        const db = new Database(dbPath);
        try {
            if (change === 'revision') db.prepare('UPDATE attachments SET document_revision = 2 WHERE id = ?').run(ATTACHMENT);
            if (change === 'ciphertext-only') db.prepare('UPDATE attachments SET data = ? WHERE id = ?').run('ENC:changed:same-canonical-tuple', ATTACHMENT);
            if (change === 'delete') db.prepare('DELETE FROM attachments WHERE id = ?').run(ATTACHMENT);
        } finally { db.close(); }
        if (change === 'selection') serverSessionProjectionOwnerRegistry.acquire(active)
            .issueSelection({ expectedEpoch: 1, patientId: PATIENT, ambulatoryId: AMBULATORY });
        if (change === 'revoke') retireSyntheticWebSession(active);
        const response = await composeAnyDocClientProjectionExtraction(active, { attachmentId: ATTACHMENT }, grant.grantId, projectionRequest(RTF));
        assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: 'Local extraction unavailable' });
    });

test('real lock retires a projection while HTTP body acquisition is suspended', async () => {
    await seedEncrypted();
    const web = issueSyntheticWebSessionContext({ id: 'user.synthetic.p1d', username: path.basename(dataDir), role: 'clinician' },
        `encrypted-lock-${sessionSequence += 1}`); finalSessions.push(web.session);
    const grant = acquireAttachmentExtractionProjection(web.session, ATTACHMENT); assert.ok(grant);
    const reached = Promise.withResolvers<void>(); let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ pull() { reached.resolve(); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const request = new Request('http://127.0.0.1/', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body,
        duplex: 'half' } as RequestInit);
    const pending = composeAnyDocClientProjectionExtraction(web.session, { attachmentId: ATTACHMENT }, grant.grantId, request);
    await reached.promise;
    assert.equal(retire(web.session, 'lock', { controlId: web.controlId, ifMatch: web.etag,
        idempotencyKey: 'synthetic-encrypted-projection-lock' }).outcome, 'completed');
    assert.equal((await pending).status, 409); assert.equal(cancelled, true);
});

test('encrypted unsupported bytes stay review-only under the real AnyDoc worker', async () => {
    const bytes = Buffer.from([0, 1, 2, 3]); await seedEncrypted(bytes); const active = session(); const before = persistedAttachment();
    const grant = acquireAttachmentExtractionProjection(active, ATTACHMENT); assert.ok(grant);
    const response = await composeAnyDocClientProjectionExtraction(active, { attachmentId: ATTACHMENT }, grant.grantId, projectionRequest(bytes));
    assert.equal(response.status, 200); const { extraction } = await response.json();
    assert.equal(extraction.status, 'review_required'); assert.equal(extraction.markdown, '');
    assert.equal(extraction.candidateUse, 'blocked'); assert.deepEqual(persistedAttachment(), before);
});

test('encrypted scanned PDF reaches real Apple Vision only after AnyDoc needsOcr', {
    skip: process.platform !== 'darwin' || process.arch !== 'arm64',
}, async () => {
    const bytes = await syntheticScannedPdf(); await seedEncrypted(bytes); const active = session(); const before = persistedAttachment();
    const grant = acquireAttachmentExtractionProjection(active, ATTACHMENT); assert.ok(grant);
    const response = await composeAnyDocClientProjectionExtraction(active, { attachmentId: ATTACHMENT }, grant.grantId, projectionRequest(bytes));
    assert.equal(response.status, 200); const { extraction } = await response.json();
    assert.equal(extraction.status, 'extracted'); assert.match(extraction.markdown, /DOCUMENTO SINTETICO/iu);
    assert.deepEqual([extraction.receipt.ocrProvenance.engine, extraction.receipt.ocrProvenance.pageCount,
        extraction.receipt.ocrProvenance.ocrPageCount], ['apple_vision', 1, 1]);
    assert.deepEqual(persistedAttachment(), before);
});
