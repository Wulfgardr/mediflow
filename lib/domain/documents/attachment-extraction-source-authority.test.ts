/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, test } from 'node:test';
import Database from 'better-sqlite3';
import type { ServerSession } from '../../security/server-session.ts';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-anydoc-p1c-'));
const dbPath = path.join(dataDir, 'medical.db');
const migrationDb = new Database(dbPath);
migrationDb.pragma('foreign_keys = OFF');
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter((file) => file.endsWith('.sql')).sort())
    migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gm, ''));
migrationDb.close();
process.env.MEDIFLOW_DATA_DIR = dataDir;

const authorityModule = await import('./attachment-extraction-source-authority.ts');
const revocationModule = await import('./attachment-extraction-locator-revocation.ts');
const backupModule = await import('../../backup-artifact.ts');
const restoreModule = await import('../../backup-restore-executor.ts');
const productionOwnerModule = await import('../../security/server-session-projection-owner-production.ts');
const webFixtureModule = await import('../../security/web-auth-lifecycle-owner-test-fixture.ts');
const lifecycleOwnerModule = await import('../../security/web-auth-lifecycle-owner-adapter.ts');
const { createAttachmentExtractionSourceAuthority } = authorityModule;
const { captureAttachmentExtractionLocatorGeneration, isCurrentAttachmentExtractionLocatorGeneration,
    revokeAttachmentExtractionLocatorGeneration } = revocationModule;
const { createBackupArtifact, createEmptyDataset } = backupModule;
const { restoreBackupArtifact } = restoreModule;
const { serverSessionProjectionOwnerRegistry } = productionOwnerModule;
const { issueSyntheticWebSession, retireSyntheticWebSession } = webFixtureModule;
const { beginResourceUse, commitResourceUse, mintResourcePort, releaseResourcePort } = lifecycleOwnerModule;
const REF = 'a'.repeat(64);
const PATIENT = 'patient.synthetic.01';
const ATTACHMENT = 'attachment.synthetic.01';
const AMBULATORY = 'ambulatory.synthetic.01';
const sessions: ServerSession[] = [];
let sequence = 0;

function seed(data = 'data:text/rtf;base64,VGVzdA==', sourceRef = REF, revision = 1, freshnessEpoch = 1) {
    const db = new Database(dbPath); db.pragma('foreign_keys = ON');
    try {
        db.exec('DELETE FROM attachments; DELETE FROM patients_to_ambulatories; DELETE FROM patients; DELETE FROM ambulatories;');
        db.prepare('INSERT INTO ambulatories (id, name, type) VALUES (?, ?, ?)').run(AMBULATORY, 'Ambulatorio sintetico', 'test');
        db.prepare('INSERT INTO patients (id, first_name, last_name, tax_code) VALUES (?, ?, ?, ?)')
            .run(PATIENT, 'Ada', 'Synthetic', 'SYNTHETIC00000000');
        db.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)').run(PATIENT, AMBULATORY);
        db.prepare('INSERT INTO attachments (id, patient_id, name, type, size, path, data, document_source_ref, document_revision, document_freshness_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(ATTACHMENT, PATIENT, 'synthetic.rtf', 'application/rtf', 4, 'synthetic.rtf', data, sourceRef, revision, freshnessEpoch);
    } finally { db.close(); }
}
function fixture() {
    const session = issueSyntheticWebSession({ id: 'user.synthetic.01', username: ['clinician', 'synthetic', '01'].join('.'), role: 'clinician' },
        `attachment-source-${sequence += 1}`);
    sessions.push(session);
    const projectionOwner = serverSessionProjectionOwnerRegistry.acquire(session);
    projectionOwner.issueSelection({ expectedEpoch: 0, patientId: PATIENT, ambulatoryId: AMBULATORY });
    return { authority: createAttachmentExtractionSourceAuthority(session), projectionOwner, session };
}
async function sameTupleArtifact() {
    const payload = createEmptyDataset();
    payload.ambulatories = [{ id: AMBULATORY, name: 'Ambulatorio sintetico', type: 'test' }];
    payload.patients = [{ id: PATIENT, firstName: 'Ada', lastName: 'Synthetic', taxCode: 'SYNTHETIC00000000',
        ambulatoryId: AMBULATORY, assignedAmbulatoryIds: [AMBULATORY] }];
    payload.attachments = [{ id: ATTACHMENT, patientId: PATIENT, name: 'synthetic.rtf', type: 'application/rtf', size: 4,
        path: 'synthetic.rtf', data: 'data:text/rtf;base64,VGVzdA==', documentSourceRef: REF, documentRevision: 1, documentFreshnessEpoch: 1 }];
    return createBackupArtifact(payload);
}
function isCurrentSession(session: ServerSession): boolean {
    const port = mintResourcePort(session); if (!port) return false;
    const use = beginResourceUse(port); const result = !!use && commitResourceUse(use);
    releaseResourcePort(port); return result;
}
afterEach(() => {
    while (sessions.length > 0) retireSyntheticWebSession(sessions.pop()!);
});
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('binds one host source, snapshots bytes, and admits evidence only after fresh finalize', () => {
    seed(); const { authority, session } = fixture(); const locator = authority.issue({ attachmentId: ATTACHMENT }); assert.ok(locator);
    assert.equal(Object.isFrozen(locator), true); assert.deepEqual(Reflect.ownKeys(locator), []);
    const begun = authority.consume(locator); assert.equal(begun.status, 'begun'); if (begun.status !== 'begun') return;
    assert.deepEqual([...begun.bytes], [...Buffer.from('Test')]); assert.deepEqual(Reflect.ownKeys(begun.operation), []);
    assert.equal(authority.consume(locator).status, 'denied');
    assert.deepEqual(authority.finalize(begun.operation), { status: 'spent', evidenceAdmissible: true, applyPolicy: 'none', writesPerformed: 0 });
    assert.equal(authority.finalize(begun.operation).status, 'denied');
    let fakeCalls = 0; const fakeOwner = Object.freeze(Object.fromEntries([
        'snapshotSelectionEpoch', 'snapshotReviewContextEpoch', 'acquireProjectionIngest', 'resolveProjectionService',
        'issueSelection', 'dereferenceSelection', 'withLeaseCriticalSection', 'dispose',
    ].map((key) => [key, () => { fakeCalls += 1; return 1; }])));
    const extraArgument = createAttachmentExtractionSourceAuthority as unknown as (...args: unknown[]) => ReturnType<typeof createAttachmentExtractionSourceAuthority>;
    assert.ok(extraArgument(session, fakeOwner).issue({ attachmentId: ATTACHMENT })); assert.equal(fakeCalls, 0);

    let foreignResolveCalls = 0;
    const foreignOwner = Object.freeze({ resolve() { foreignResolveCalls += 1; throw new Error('foreign registry'); } });
    assert.ok(extraArgument(session, foreignOwner).issue({ attachmentId: ATTACHMENT }));
    assert.equal(foreignResolveCalls, 0);
});

test('burns stale, wrong-patient, reselected, revoked, and cross-owner capabilities', () => {
    seed(); const first = fixture(); const second = fixture(); const locator = first.authority.issue({ attachmentId: ATTACHMENT }); assert.ok(locator);
    const db = new Database(dbPath); db.prepare('UPDATE attachments SET document_revision = 2 WHERE id = ?').run(ATTACHMENT); db.close();
    assert.equal(first.authority.consume(locator).status, 'denied'); assert.equal(first.authority.consume(locator).status, 'denied');
    seed(); const recreated = first.authority.issue({ attachmentId: ATTACHMENT }); assert.ok(recreated);
    const replacement = new Database(dbPath); replacement.prepare('UPDATE attachments SET document_source_ref = ? WHERE id = ?').run('b'.repeat(64), ATTACHMENT); replacement.close();
    assert.equal(first.authority.consume(recreated).status, 'denied');
    const foreign = second.authority.issue({ attachmentId: ATTACHMENT }); assert.ok(foreign); assert.equal(first.authority.consume(foreign).status, 'denied');
    const own = second.authority.consume(foreign); assert.equal(own.status, 'begun'); if (own.status !== 'begun') return;
    second.projectionOwner.issueSelection({ expectedEpoch: 1, patientId: PATIENT, ambulatoryId: AMBULATORY });
    assert.equal(second.authority.finalize(own.operation).status, 'denied');
    const revoked = first.authority.issue({ attachmentId: ATTACHMENT }); assert.ok(revoked); retireSyntheticWebSession(first.session);
    assert.equal(first.authority.consume(revoked).status, 'denied');
    seed(); const expired = fixture(); retireSyntheticWebSession(expired.session); assert.equal(expired.authority.issue({ attachmentId: ATTACHMENT }), null);
    seed(); const wrong = fixture(); const moved = new Database(dbPath); moved.prepare('INSERT INTO patients (id, first_name, last_name, tax_code) VALUES (?, ?, ?, ?)').run('patient.synthetic.02', 'Grace', 'Synthetic', 'SYNTHETIC00000001');
    moved.prepare('UPDATE attachments SET patient_id = ? WHERE id = ?').run('patient.synthetic.02', ATTACHMENT); moved.close();
    assert.equal(wrong.authority.issue({ attachmentId: ATTACHMENT }), null); assert.equal(wrong.authority.issue({ attachmentId: 'missing.synthetic' }), null);
});

test('denies module-copy tokens and disposal clears every pending capability', async () => {
    seed(); const current = fixture(); const locator = current.authority.issue({ attachmentId: ATTACHMENT }); assert.ok(locator);
    const copy = await import(`${new URL('./attachment-extraction-source-authority.ts', import.meta.url).href}?copy=synthetic`);
    const foreign = copy.createAttachmentExtractionSourceAuthority(current.session);
    assert.equal(foreign.consume(locator).status, 'denied');
    const begun = current.authority.consume(locator); assert.equal(begun.status, 'begun'); if (begun.status !== 'begun') return;
    current.authority.dispose(); assert.equal(current.authority.finalize(begun.operation).status, 'denied'); assert.equal(current.authority.issue({ attachmentId: ATTACHMENT }), null);
});

test('revokes same-tuple locators and operations before restore while preserving session and selection', async () => {
    seed(); const current = fixture(); const selectionEpoch = current.projectionOwner.snapshotSelectionEpoch(current.session);
    const finalizeLocator = current.authority.issue({ attachmentId: ATTACHMENT }); assert.ok(finalizeLocator);
    const abortLocator = current.authority.issue({ attachmentId: ATTACHMENT }); assert.ok(abortLocator);
    const staleLocator = current.authority.issue({ attachmentId: ATTACHMENT }); assert.ok(staleLocator);
    const finalizeOperation = current.authority.consume(finalizeLocator); const abortOperation = current.authority.consume(abortLocator);
    assert.equal(finalizeOperation.status, 'begun'); assert.equal(abortOperation.status, 'begun');
    if (finalizeOperation.status !== 'begun' || abortOperation.status !== 'begun') return;
    const copy = await import(`${new URL('./attachment-extraction-source-authority.ts', import.meta.url).href}?restore-copy=synthetic`);
    const copyAuthority = copy.createAttachmentExtractionSourceAuthority(current.session);
    const copyLocator = copyAuthority.issue({ attachmentId: ATTACHMENT }); assert.ok(copyLocator);

    restoreBackupArtifact(await sameTupleArtifact());

    assert.equal(current.authority.consume(staleLocator).status, 'denied'); assert.equal(current.authority.consume(staleLocator).status, 'denied');
    assert.equal(current.authority.finalize(finalizeOperation.operation).status, 'denied'); assert.equal(current.authority.finalize(finalizeOperation.operation).status, 'denied');
    assert.equal(current.authority.abort(abortOperation.operation).status, 'denied'); assert.equal(current.authority.abort(abortOperation.operation).status, 'denied');
    assert.equal(copyAuthority.consume(copyLocator).status, 'denied');
    assert.equal(isCurrentSession(current.session), true);
    assert.equal(current.projectionOwner.snapshotSelectionEpoch(current.session), selectionEpoch);
    const freshLocator = current.authority.issue({ attachmentId: ATTACHMENT }); assert.ok(freshLocator);
    const fresh = current.authority.consume(freshLocator); assert.equal(fresh.status, 'begun');
    if (fresh.status === 'begun') assert.equal(current.authority.finalize(fresh.operation).status, 'spent');
});

test('keeps restore revocation fail-closed after precondition and transaction failures', async () => {
    seed(); const precondition = fixture(); const preconditionLocator = precondition.authority.issue({ attachmentId: ATTACHMENT }); assert.ok(preconditionLocator);
    const artifact = await sameTupleArtifact(); const db = new Database(dbPath);
    db.prepare('INSERT INTO durable_review_command_states (review_id, review_state, revision, action) VALUES (?, ?, ?, ?)')
        .run(`review_${'c'.repeat(32)}`, 'accepted', 1, 'accept'); db.close();
    assert.throws(() => restoreBackupArtifact(artifact), /append-only audit ledger/u);
    assert.equal(precondition.authority.consume(preconditionLocator).status, 'denied');
    const cleanup = new Database(dbPath); cleanup.exec('DELETE FROM durable_review_command_states'); cleanup.close();

    const transaction = fixture(); const transactionLocator = transaction.authority.issue({ attachmentId: ATTACHMENT }); assert.ok(transactionLocator);
    artifact.payload.ambulatories.push({ id: AMBULATORY, name: 'Duplicato sintetico', type: 'test' });
    assert.throws(() => restoreBackupArtifact(artifact));
    assert.equal(transaction.authority.consume(transactionLocator).status, 'denied');
    const stillPresent = new Database(dbPath); const count = stillPresent.prepare('SELECT COUNT(*) AS count FROM attachments WHERE id = ?').get(ATTACHMENT) as { count: number };
    assert.equal(count.count, 1); stillPresent.close();
});

test('uses frozen null-prototype generations and repeated revocation cannot resurrect them', () => {
    let reads = 0; const first = captureAttachmentExtractionLocatorGeneration();
    assert.equal(Object.getPrototypeOf(first), null); assert.equal(Object.isFrozen(first), true); assert.equal(isCurrentAttachmentExtractionLocatorGeneration(first), true);
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; throw new Error('raw then'); } });
    try {
        revokeAttachmentExtractionLocatorGeneration(); const second = captureAttachmentExtractionLocatorGeneration();
        revokeAttachmentExtractionLocatorGeneration(); const third = captureAttachmentExtractionLocatorGeneration();
        assert.notEqual(first, second); assert.notEqual(second, third);
        assert.equal(isCurrentAttachmentExtractionLocatorGeneration(first), false);
        assert.equal(isCurrentAttachmentExtractionLocatorGeneration(second), false);
        assert.equal(isCurrentAttachmentExtractionLocatorGeneration(third), true);
    } finally { delete (Object.prototype as { then?: unknown }).then; }
    assert.equal(reads, 0);
});

test('denies hostile selectors and unreadable sources without getters, traps, iterators, or then reads', () => {
    seed(); const { authority } = fixture(); let reads = 0;
    const accessor = Object.defineProperty({}, 'attachmentId', { enumerable: true, get() { reads += 1; return ATTACHMENT; } });
    const proxy = new Proxy({ attachmentId: ATTACHMENT }, { getPrototypeOf() { reads += 1; throw new Error('raw'); } });
    const hidden = Object.defineProperty({}, 'attachmentId', { value: ATTACHMENT });
    for (const selector of [accessor, proxy, hidden, { attachmentId: ATTACHMENT, currentness: REF }, Object.assign(Object.create({}), { attachmentId: ATTACHMENT })])
        assert.doesNotThrow(() => assert.equal(authority.issue(selector as never), null));
    assert.equal(reads, 0);
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
    const iterator = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.iterator)!;
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; throw new Error('raw then'); } });
    Object.defineProperty(typedArrayPrototype, Symbol.iterator, { configurable: true, get() { reads += 1; throw new Error('raw iterator'); } });
    try { const candidate = authority.issue({ attachmentId: ATTACHMENT }); assert.ok(candidate); assert.equal(authority.consume(candidate).status, 'begun'); }
    finally { delete (Object.prototype as { then?: unknown }).then; Object.defineProperty(typedArrayPrototype, Symbol.iterator, iterator); }
    assert.equal(reads, 0);
    for (const data of ['ENC:YWJj:ZGVm', '%%%', '', 'A'.repeat(35 * 1024 * 1024)]) {
        seed(data); const candidate = authority.issue({ attachmentId: ATTACHMENT }); assert.ok(candidate);
        assert.equal(authority.consume(candidate).status, 'denied');
    }
});

test('keeps callbacks, AnyDoc, routes, logging, and persistence outside the authority packet', () => {
    const source = fs.readFileSync(new URL('./attachment-extraction-source-authority.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /extractAnyDoc|toMarkdownBytes|fetch|spawn|console|app\/api|insert\(|update\(|delete\(/iu);
    assert.doesNotMatch(source, /\bsourcePort\b|hook|caller.*function|Promise\.|async\s|await\s/iu);
    assert.match(source, /mintResourcePort[\s\S]*beginResourceUse[\s\S]*commitResourceUse/iu);
    assert.doesNotMatch(source, /ownerValue|registryValue|sourceRegistry|createServerSessionProjectionOwnerRegistry/iu);
    assert.match(source, /createAttachmentExtractionSourceAuthority\(sessionValue: ServerSession\)/u);
    assert.match(source, /serverSessionProjectionOwnerRegistry\.acquire\(session\)/u);
    const revocation = fs.readFileSync(new URL('./attachment-extraction-locator-revocation.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(revocation, /Promise|async|await|callback|dbServer|schema|transaction|\.then|Symbol\.iterator/iu);
    const restore = fs.readFileSync(new URL('../../backup-restore-executor.ts', import.meta.url), 'utf8');
    assert.match(restore, /revokeAttachmentExtractionLocatorGeneration\(\);\s*runDbServerImmediateTransaction/iu);
});
