/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, test } from 'node:test';
import { types } from 'node:util';
import Database from 'better-sqlite3';
import type { ServerSession } from '../../security/server-session.ts';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-anydoc-l1d-s1-'));
const dbPath = path.join(dataDir, 'medical.db');
const migrationDb = new Database(dbPath); migrationDb.pragma('foreign_keys = OFF');
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter((file) => file.endsWith('.sql')).sort())
    migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gm, ''));
migrationDb.close(); process.env.MEDIFLOW_DATA_DIR = dataDir;

const dbModule = await import('../../db-server.ts');
const ownerModule = await import('../../security/server-session-projection-owner-production.ts');
const webFixtureModule = await import('../../security/web-auth-lifecycle-owner-test-fixture.ts');
const { dbServer } = dbModule;
const originalAll = dbServer.all; let allHook = () => {}; let allReplacement: unknown = undefined;
(dbServer as unknown as { all: typeof dbServer.all }).all = (function (query) {
    allHook(); return allReplacement === undefined ? Reflect.apply(originalAll, dbServer, [query]) : allReplacement as never;
}) as typeof dbServer.all;
const bindingModule = await import('./attachment-extraction-selection-binding.ts');
(dbServer as unknown as { all: typeof dbServer.all }).all = originalAll;
const { serverSessionProjectionOwnerRegistry } = ownerModule;
const { issueSyntheticWebSession, retireSyntheticWebSession } = webFixtureModule;
const { bindAttachmentExtractionSelection } = bindingModule;
const PATIENT = 'patient.synthetic.selection'; const ATTACHMENT = 'attachment.synthetic.selection';
const AMBULATORY = 'ambulatory.synthetic.selection'; const OTHER = 'ambulatory.synthetic.other';
const sessions: ServerSession[] = [];
let sequence = 0;

function seed(memberships = [AMBULATORY]) {
    const db = new Database(dbPath); db.pragma('foreign_keys = ON');
    db.exec('DELETE FROM attachments; DELETE FROM patients_to_ambulatories; DELETE FROM patients; DELETE FROM ambulatories;');
    db.prepare('INSERT INTO ambulatories (id,name,type) VALUES (?,?,?),(?,?,?)')
        .run(AMBULATORY, 'Ambulatorio sintetico', 'test', OTHER, 'Altro sintetico', 'test');
    db.prepare('INSERT INTO patients (id,first_name,last_name,tax_code,ambulatory_id) VALUES (?,?,?,?,?)')
        .run(PATIENT, 'Ada', 'Synthetic', 'SYNTHETIC00000000', AMBULATORY);
    for (const ambulatoryId of memberships) db.prepare('INSERT INTO patients_to_ambulatories (patient_id,ambulatory_id) VALUES (?,?)').run(PATIENT, ambulatoryId);
    db.prepare(`INSERT INTO attachments (id,patient_id,name,type,size,path,data,document_source_ref,document_revision,document_freshness_epoch)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(ATTACHMENT, PATIENT, 'synthetic.rtf', 'application/rtf', 4, 'synthetic.rtf', 'VGVzdA==', 'a'.repeat(64), 1, 1);
    db.close();
}
function session(channel: 'web' | 'native' | 'system' = 'web') {
    const web = issueSyntheticWebSession({ id: `user.synthetic.${channel}`, username: ['clinician', 'synthetic', channel].join('.'), role: 'clinician' },
        `selection-binding-${sequence += 1}`);
    sessions.push(web);
    return channel === 'web' ? web : { ...web, id: `${channel}.synthetic.selection`, authChannel: channel };
}
afterEach(() => {
    while (sessions.length > 0) retireSyntheticWebSession(sessions.pop()!);
});
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('derives the unique active host membership and publishes only an opaque selection result', () => {
    seed(); const current = session(); const result = bindAttachmentExtractionSelection(current, ATTACHMENT);
    assert.ok(result); assert.equal(Object.getPrototypeOf(result), null); assert.equal(Object.isFrozen(result), true); assert.deepEqual(Reflect.ownKeys(result), []);
    const owner = serverSessionProjectionOwnerRegistry.lookup(current.id); assert.ok(owner);
    assert.deepEqual(owner.withLeaseCriticalSection(current, (pair) => pair), { patientId: PATIENT, ambulatoryId: AMBULATORY });
    assert.equal(bindAttachmentExtractionSelection(current, result), null);
});

test('denies missing, inactive, mismatched, zero, and multiple memberships without legacy fallback', () => {
    seed([]); const current = session(); assert.equal(bindAttachmentExtractionSelection(current, ATTACHMENT), null);
    const db = new Database(dbPath); db.prepare('INSERT INTO patients_to_ambulatories (patient_id,ambulatory_id) VALUES (?,?),(?,?)')
        .run(PATIENT, AMBULATORY, PATIENT, OTHER); db.close();
    assert.equal(bindAttachmentExtractionSelection(current, ATTACHMENT), null);
    seed(); const inactive = new Database(dbPath); inactive.prepare('UPDATE patients SET deleted_at = ? WHERE id = ?').run(Date.now(), PATIENT); inactive.close();
    assert.equal(bindAttachmentExtractionSelection(current, ATTACHMENT), null);
    seed(); assert.equal(bindAttachmentExtractionSelection(current, 'attachment.synthetic.missing'), null);
    const moved = new Database(dbPath); moved.pragma('foreign_keys = OFF'); moved.prepare('UPDATE attachments SET patient_id = ? WHERE id = ?').run('patient.synthetic.missing', ATTACHMENT); moved.close();
    assert.equal(bindAttachmentExtractionSelection(current, ATTACHMENT), null);
});

test('denies ineligible, stale, hostile, cross-session, and replay-shaped inputs without reflection', () => {
    seed(); const web = session(); let traps = 0;
    const proxy = new Proxy(web, { getPrototypeOf() { traps += 1; throw new Error('raw proxy'); } });
    const accessor = Object.defineProperty({ ...web }, 'id', { enumerable: true, get() { traps += 1; return web.id; } });
    const thenable = Object.defineProperty({}, 'then', { enumerable: true, get() { traps += 1; throw new Error('raw then'); } });
    for (const value of [session('native'), session('system'), { ...web, id: 'local-api' }, proxy, accessor, thenable, Promise.resolve(web)])
        assert.doesNotThrow(() => assert.equal(bindAttachmentExtractionSelection(value, ATTACHMENT), null));
    assert.equal(traps, 0); retireSyntheticWebSession(web); assert.equal(bindAttachmentExtractionSelection(web, ATTACHMENT), null);
    const loggedOut = session(); retireSyntheticWebSession(loggedOut); assert.equal(bindAttachmentExtractionSelection(loggedOut, ATTACHMENT), null);
    const current = session(); const token = bindAttachmentExtractionSelection(current, ATTACHMENT); assert.ok(token);
    const foreign = session(); assert.equal(bindAttachmentExtractionSelection(foreign, token), null);
    for (const target of ['', ` ${ATTACHMENT}`, { attachmentId: ATTACHMENT }, Promise.resolve(ATTACHMENT), new Proxy({}, {})])
        assert.equal(bindAttachmentExtractionSelection(current, target), null);
});

test('fails closed on reentry, stale epoch, and hostile database result shapes, then permits a clean retry', () => {
    seed(); const current = session(); const owner = serverSessionProjectionOwnerRegistry.acquire(current);
    let nested: unknown = true; allHook = () => { nested = bindAttachmentExtractionSelection(current, ATTACHMENT); };
    assert.ok(bindAttachmentExtractionSelection(current, ATTACHMENT)); assert.equal(nested, null);
    allHook = () => { owner.issueSelection({ expectedEpoch: owner.snapshotSelectionEpoch(current), patientId: PATIENT, ambulatoryId: AMBULATORY }); };
    assert.equal(bindAttachmentExtractionSelection(current, ATTACHMENT), null); allHook = () => {};
    assert.ok(bindAttachmentExtractionSelection(current, ATTACHMENT));
    let reads = 0; const hostileRow = Object.defineProperty({ attachmentId: ATTACHMENT, patientId: PATIENT }, 'ambulatoryId', { enumerable: true, get() { reads += 1; return AMBULATORY; } });
    const hidden = Object.defineProperty({ attachmentId: ATTACHMENT, patientId: PATIENT }, 'ambulatoryId', { value: AMBULATORY });
    const proxiedRow = new Proxy({ attachmentId: ATTACHMENT, patientId: PATIENT, ambulatoryId: AMBULATORY }, { getPrototypeOf() { reads += 1; throw new Error('raw row'); } });
    for (const value of [new Proxy([], {}), [hostileRow], [hidden], [proxiedRow],
        [Object.assign(Object.create({}), { attachmentId: ATTACHMENT, patientId: PATIENT, ambulatoryId: AMBULATORY })],
        [{ attachmentId: ATTACHMENT, patientId: PATIENT, ambulatoryId: AMBULATORY, authority: true }]]) {
        allReplacement = value; assert.equal(bindAttachmentExtractionSelection(current, ATTACHMENT), null);
    }
    assert.equal(reads, 0); allReplacement = undefined;
});

test('keeps selection binding server-only and excludes leases, routes, AnyDoc, writes, providers, and apply', () => {
    const source = fs.readFileSync(new URL('./attachment-extraction-selection-binding.ts', import.meta.url), 'utf8');
    assert.match(source, /server-only/u); assert.match(source, /patients_to_ambulatories/u); assert.match(source, /issueSelection/u);
    assert.doesNotMatch(source, /patients\.ambulatoryId|patientRef|ambulatoryRef|leaseRef|withLeaseCriticalSection/u);
    assert.doesNotMatch(source, /AnyDoc|toMarkdown|fetch|app\/api|insert\(|update\(|delete\(|provider|egress|applyPolicy|writesPerformed|Smart.?Import/iu);
    assert.equal(types.isProxy(bindAttachmentExtractionSelection), false);
});
