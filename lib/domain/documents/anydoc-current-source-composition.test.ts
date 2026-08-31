/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, test } from 'node:test';
import Database from 'better-sqlite3';
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
const { composeAnyDocCurrentSourceExtraction } = compositionModule;
const { serverSessionProjectionOwnerRegistry } = productionOwnerModule;
const { issueSyntheticWebSession, retireSyntheticWebSession } = webFixtureModule;
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
