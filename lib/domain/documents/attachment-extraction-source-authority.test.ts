/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, test } from 'node:test';
import Database from 'better-sqlite3';

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
const sessionModule = await import('../../security/server-session.ts');
const ownerModule = await import('../../security/server-session-projection-owner.ts');
const productionOwnerModule = await import('../../security/server-session-projection-owner-production.ts');
const { createAttachmentExtractionSourceAuthority } = authorityModule;
const { clearAllSessions, createSession, deleteSession } = sessionModule;
const { createServerSessionProjectionOwnerRegistry } = ownerModule;
const { serverSessionProjectionOwnerRegistry } = productionOwnerModule;
const REF = 'a'.repeat(64);
const PATIENT = 'patient.synthetic.01';
const ATTACHMENT = 'attachment.synthetic.01';
const AMBULATORY = 'ambulatory.synthetic.01';

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
    const session = createSession({ id: 'user.synthetic.01', username: ['clinician', 'synthetic', '01'].join('.'), role: 'clinician' });
    const projectionOwner = serverSessionProjectionOwnerRegistry.acquire(session);
    projectionOwner.issueSelection({ expectedEpoch: 0, patientId: PATIENT, ambulatoryId: AMBULATORY });
    return { authority: createAttachmentExtractionSourceAuthority(session), projectionOwner, session };
}
afterEach(() => clearAllSessions());
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
    const foreignRegistry = createServerSessionProjectionOwnerRegistry({ resolve() { foreignResolveCalls += 1; throw new Error('foreign registry'); } });
    const foreignOwner = foreignRegistry.acquire(session);
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
    const revoked = first.authority.issue({ attachmentId: ATTACHMENT }); assert.ok(revoked); deleteSession(first.session.id);
    assert.equal(first.authority.consume(revoked).status, 'denied');
    seed(); const expired = fixture(); expired.session.expiresAt = 0; assert.equal(expired.authority.issue({ attachmentId: ATTACHMENT }), null);
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
    assert.doesNotMatch(source, /sourcePort|hook|caller.*function|Promise\.|async\s|await\s/iu);
    assert.doesNotMatch(source, /ownerValue|registryValue|sourceRegistry|createServerSessionProjectionOwnerRegistry/iu);
    assert.match(source, /createAttachmentExtractionSourceAuthority\(sessionValue: ServerSession\)/u);
    assert.match(source, /serverSessionProjectionOwnerRegistry\.acquire\(session\)/u);
});
