/* @Codex */
import assert from 'node:assert/strict';
import childProcess, { type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, mock, test } from 'node:test';
import { createCanvas } from '@napi-rs/canvas';
import Database from 'better-sqlite3';
import { PDFDocument } from 'pdf-lib';
import type { ServerSession } from '../../security/server-session.ts';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-ocr-acceptance-'));
const dbPath = path.join(dataDir, 'medical.db');
const migrationDb = new Database(dbPath);
migrationDb.pragma('foreign_keys = OFF');
for (const name of fs.readdirSync('drizzle').filter((file) => file.endsWith('.sql')).sort())
    migrationDb.exec(fs.readFileSync(path.join('drizzle', name), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gm, ''));
migrationDb.close();
process.env.MEDIFLOW_DATA_DIR = dataDir;

const { composeAnyDocCurrentSourceExtraction } = await import('./anydoc-current-source-composition.ts');
const { issueSyntheticWebSession, retireSyntheticWebSession } = await import('../../security/web-auth-lifecycle-owner-test-fixture.ts');
const sessions: ServerSession[] = [];
const ATTACHMENT = 'attachment.synthetic.ocr.acceptance';
const originalSpawn = childProcess.spawn;
const originalSetTimeout = globalThis.setTimeout;
const ownedChildren: ChildProcess[] = [];
const temporaryRoots: string[] = [];
const SUCCESS_TEXT = 'OCR SYNTHETIC RECOVERY';
const engineEnvelope = JSON.stringify({ schemaVersion: 'mediflow.apple_vision_ocr.v1', engine: 'apple_vision',
    ok: true, text: SUCCESS_TEXT, avgConfidence: 1 });
const engineSuccess = `process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(${JSON.stringify(engineEnvelope)}));`;

async function scannedPdf(): Promise<Buffer> {
    const canvas = createCanvas(600, 180); const context = canvas.getContext('2d');
    context.fillStyle = 'white'; context.fillRect(0, 0, 600, 180);
    context.fillStyle = 'black'; context.font = '40px Helvetica'; context.fillText('SYNTHETIC OCR', 20, 90);
    const pdf = await PDFDocument.create(); const raster = await pdf.embedPng(canvas.toBuffer('image/png'));
    pdf.addPage([600, 180]).drawImage(raster, { x: 0, y: 0, width: 600, height: 180 });
    return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

function mutate(sql: string, ...values: Array<string | number>) {
    const db = new Database(dbPath);
    try { db.prepare(sql).run(...values); } finally { db.close(); }
}
function persistedSource() {
    const db = new Database(dbPath);
    try { return db.prepare('SELECT data,document_source_ref,document_revision,document_freshness_epoch FROM attachments WHERE id=?').get(ATTACHMENT); }
    finally { db.close(); }
}
function seed(bytes: Buffer) {
    const db = new Database(dbPath);
    try {
        db.exec('DELETE FROM attachments; DELETE FROM patients_to_ambulatories; DELETE FROM patients; DELETE FROM ambulatories;');
        db.exec("INSERT INTO ambulatories (id,name,type) VALUES ('synthetic.ocr.ambulatory','Synthetic','test');");
        db.exec("INSERT INTO patients (id,first_name,last_name,tax_code) VALUES ('synthetic.ocr.patient','Synthetic','OCR','SYNTHETIC00000671');");
        db.exec("INSERT INTO patients_to_ambulatories (patient_id,ambulatory_id) VALUES ('synthetic.ocr.patient','synthetic.ocr.ambulatory');");
        db.prepare('INSERT INTO attachments (id,patient_id,name,type,size,path,data,document_source_ref,document_revision,document_freshness_epoch) VALUES (?,?,?,?,?,?,?,?,1,1)')
            .run(ATTACHMENT, 'synthetic.ocr.patient', 'synthetic.pdf', 'application/pdf', bytes.byteLength,
                'synthetic.pdf', bytes.toString('base64'), 'c'.repeat(64));
    } finally { db.close(); }
    const session = issueSyntheticWebSession({ id: 'synthetic.ocr.user', username: randomUUID(), role: 'clinician' }, `ocr-acceptance-${sessions.length}`);
    sessions.push(session); return session;
}

/** Only the recognition executable is substituted. AnyDoc, rendering, process ownership and finalization run normally. */
function substituteRecognition(start: () => { script?: string; missing?: boolean }) {
    let calls = 0;
    mock.method(childProcess, 'spawn', (command: string, args: string[], options: childProcess.SpawnOptions) => {
        if (command !== '/usr/bin/sandbox-exec') return originalSpawn(command, args, options);
        calls += 1;
        assert.deepEqual(args.slice(0, 4), ['-p', '(version 1) (allow default) (deny network*)', '/usr/bin/xcrun', 'swift']);
        assert.equal(options.detached, true);
        temporaryRoots.push(options.env!.TMPDIR!);
        const replacement = start();
        const child = replacement.missing
            ? originalSpawn(path.join(dataDir, 'absent-engine'), [], options)
            : originalSpawn(process.execPath, ['-e', replacement.script ?? engineSuccess], options);
        ownedChildren.push(child); return child;
    });
    syncBuiltinESMExports();
    return () => calls;
}

function noCandidate(result: Awaited<ReturnType<typeof composeAnyDocCurrentSourceExtraction>>) {
    assert.notEqual(result.status, 'extracted');
    assert.deepEqual([result.review, result.writes, result.apply, result.candidateUse], ['required', 0, 'none', 'blocked']);
    if (result.status === 'review_required') {
        assert.equal(result.markdown, ''); assert.equal(result.receipt.markdownByteLength, 0);
        assert.equal(result.receipt.ocrProvenance, undefined);
    } else {
        assert.equal('markdown' in result, false); assert.equal('receipt' in result, false);
        assert.equal('provenance' in result, false);
    }
    assert.doesNotMatch(JSON.stringify(result), /OCR SYNTHETIC RECOVERY|\/Users|\/private\/var|absent-engine/);
}
afterEach(() => {
    mock.restoreAll(); syncBuiltinESMExports();
    for (const child of ownedChildren.splice(0)) {
        if (child.pid && child.exitCode === null && child.signalCode === null) {
            try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already closed. */ }
        }
    }
    while (sessions.length) retireSyntheticWebSession(sessions.pop()!);
    for (const root of temporaryRoots.splice(0)) assert.equal(fs.existsSync(root), false, 'owned temporary root must be cleaned');
});
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

for (const failure of ['absent', 'crash', 'timeout'] as const) {
    test(`OCR acceptance: ${failure} discards output, closes the child and permits retry`, { skip: process.platform !== 'darwin' }, async () => {
        const bytes = await scannedPdf(); const session = seed(bytes);
        const before = persistedSource();
        let failing = true;
        let restoreRecognitionTimers: (() => void) | undefined;
        const calls = substituteRecognition(() => {
            if (!failing) return {};
            if (failure === 'absent') return { missing: true };
            // @Codex: accelerate only after entering recognition. Earlier 30-second
            // PDF/AnyDoc timers must not expire under concurrent suite CPU load.
            if (failure === 'timeout') {
                const timerMock = mock.method(globalThis, 'setTimeout', (callback: () => void, delay: number) =>
                    originalSetTimeout(callback, delay === 30_000 ? 250 : delay));
                restoreRecognitionTimers = () => timerMock.mock.restore();
            }
            return { script: failure === 'crash'
                ? `${engineSuccess} process.exitCode = 1;`
                : "process.stdin.resume(); setInterval(() => {}, 1000);" };
        });
        const failed = await composeAnyDocCurrentSourceExtraction(session, { attachmentId: ATTACHMENT });
        noCandidate(failed); assert.equal(failed.status, 'review_required');
        if (failed.status === 'review_required') assert.equal(failed.detail, failure === 'timeout' ? 'resource_limit' : 'io_failure');
        assert.equal(calls(), 1);
        const child = ownedChildren[0];
        if (failure === 'timeout') assert.equal(child.signalCode, 'SIGKILL');
        if (child.pid) assert.throws(() => process.kill(child.pid!, 0), { code: 'ESRCH' });
        assert.equal(fs.existsSync(temporaryRoots[0]), false);
        // @Codex: the successful retry must use production deadlines, including under suite CPU load.
        restoreRecognitionTimers?.();
        failing = false;
        const retry = await composeAnyDocCurrentSourceExtraction(session, { attachmentId: ATTACHMENT });
        assert.equal(retry.status, 'extracted'); assert.equal(calls(), 2);
        if (retry.status === 'extracted') {
            assert.equal(retry.markdown, SUCCESS_TEXT);
            assert.equal(retry.provenance.sourceSha256, createHash('sha256').update(bytes).digest('hex'));
            assert.deepEqual([retry.receipt.ocrProvenance?.ocrPageCount, retry.writes, retry.apply], [1, 0, 'none']);
        }
        assert.deepEqual(persistedSource(), before, 'failed extraction and retry must leave the source and its currentness unchanged');
    });
}

for (const change of ['stale', 'replaced', 'revoked'] as const) {
    test(`OCR acceptance: ${change} during recognition discards the old result and recovers on a new request`, { skip: process.platform !== 'darwin' }, async () => {
        const bytes = await scannedPdf(); let session = seed(bytes); let changed = false;
        const replacement = Buffer.from('{\\rtf1\\ansi CURRENT SYNTHETIC REPLACEMENT}', 'utf8');
        const calls = substituteRecognition(() => {
            if (!changed) {
                changed = true;
                if (change === 'revoked') retireSyntheticWebSession(session);
                else if (change === 'stale') mutate('UPDATE attachments SET document_revision=2,document_freshness_epoch=2 WHERE id=?', ATTACHMENT);
                else mutate('UPDATE attachments SET data=?,size=?,document_source_ref=?,document_revision=2,document_freshness_epoch=2 WHERE id=?',
                    replacement.toString('base64'), replacement.byteLength, 'd'.repeat(64), ATTACHMENT);
            }
            return {};
        });
        const result = await composeAnyDocCurrentSourceExtraction(session, { attachmentId: ATTACHMENT });
        assert.equal(calls(), 1); assert.equal(result.status, 'denied'); noCandidate(result);
        if (change === 'revoked') session = seed(bytes);
        const retry = await composeAnyDocCurrentSourceExtraction(session, { attachmentId: ATTACHMENT });
        assert.equal(retry.status, 'extracted');
        if (retry.status === 'extracted') {
            assert.equal(retry.markdown, change === 'replaced' ? 'CURRENT SYNTHETIC REPLACEMENT' : SUCCESS_TEXT);
            assert.equal(retry.provenance.sourceSha256, createHash('sha256').update(change === 'replaced' ? replacement : bytes).digest('hex'));
        }
    });
}

for (const input of ['protected', 'corrupt'] as const) {
    test(`OCR acceptance: real parser rejects ${input} PDF without starting recognition`, async () => {
        const bytes = input === 'protected' ? fs.readFileSync('e2e/fixtures/ocr-synthetic-protected.pdf')
            : Buffer.from('%PDF-1.7\nsynthetic corrupt document\n%%EOF');
        const session = seed(bytes);
        const calls = substituteRecognition(() => { throw new Error('Recognition must not start'); });
        const result = await composeAnyDocCurrentSourceExtraction(session, { attachmentId: ATTACHMENT });
        noCandidate(result); assert.equal(result.status, 'review_required'); assert.equal(calls(), 0);
        if (result.status === 'review_required') assert.equal(result.detail, input === 'protected' ? 'encrypted_document' : 'malformed_document');
    });
}
