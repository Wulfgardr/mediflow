import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { openVersionedSqliteDatabase } from '../sqlite-schema-open';
import { readSqliteArchiveGeneration } from '../archive-generation';
import { ACCOUNT_RESET_JOURNAL_SUFFIX, discardPreviousArchive, listAccountResetReceipts, reconcileAccountResets, resetAccountsDurably,
    type AccountResetPhase, type AccountResetReceipt } from './account-reset-journal';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
// The process itself, not a wrapper: SIGKILL must reach the code that holds the archive.
const loader = ['--experimental-strip-types', '--import', pathToFileURL(path.join(root, 'scripts', 'register-strip-types-loader.mjs')).href];
const child = path.join(here, 'account-reset-journal-crash-fixture.ts');

function syntheticArchive(): { dir: string; file: string; generation: string } {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(process.env.MEDIFLOW_DATA_DIR!, 'account-reset-')));
    const file = path.join(dir, 'medical.db');
    const db = openVersionedSqliteDatabase(file);
    try {
        for (const [id, username] of [['11111111-1111-4111-8111-111111111111', 'synthetic-admin'], ['22222222-2222-4222-8222-222222222222', 'synthetic-doctor']]) {
            db.prepare(`INSERT INTO users(id, username, role, password_hash, encrypted_master_key, salt)
                VALUES (?, ?, 'admin', 'synthetic-hash', 'v3:synthetic-wrapping', 'synthetic-salt')`).run(id, username);
        }
        db.prepare(`INSERT INTO patients (id, first_name, last_name, tax_code, version)
            VALUES ('synthetic-patient', 'Synthetic', 'Reset', 'SYNTHETIC-RESET', 1)`).run();
        return { dir, file, generation: readSqliteArchiveGeneration(db) };
    } finally { db.close(); }
}

function users(file: string): number {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try { return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n; } finally { db.close(); }
}

/** Starts a real reset process, waits for the phase and kills it with SIGKILL. */
async function killDuring(file: string, phase: AccountResetPhase): Promise<void> {
    const process_ = spawn(process.execPath, [...loader, child, file, phase], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
    let output = '';
    await new Promise<void>((resolve, reject) => {
        process_.stdout.on('data', chunk => {
            output += String(chunk);
            if (output.includes(`PHASE:${phase}`)) { process_.kill('SIGKILL'); resolve(); }
        });
        process_.once('exit', () => reject(new Error(`child exited before ${phase}: ${output}`)));
    });
    const [, signal] = await new Promise<[number | null, NodeJS.Signals | null]>(resolve => process_.once('exit', (code, sig) => resolve([code, sig])));
    assert.equal(signal, 'SIGKILL');
}

/** A new process starts the server's own opener on that data directory, as the next launch would. */
function restart(dir: string): AccountResetReceipt[] {
    const script = `const { openDbServer } = require('./lib/db-server.ts');
        const { listAccountResetReceipts } = require('./lib/security/account-reset-journal.ts');
        process.stdout.write(JSON.stringify(listAccountResetReceipts(openDbServer())));`;
    const result = spawnSync(process.execPath, [...loader, '-e', script], { cwd: root, encoding: 'utf8',
        env: { ...process.env, MEDIFLOW_DATA_DIR: dir, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' } });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim().split('\n').at(-1)!) as AccountResetReceipt[];
}

const cases: Array<{ phase: AccountResetPhase; outcome: 'completed' | 'aborted'; copy: boolean; reconciled: boolean }> = [
    { phase: 'intent', outcome: 'aborted', copy: false, reconciled: true },
    // Before the point of no return: the copy is complete, the archive is untouched.
    { phase: 'preserved', outcome: 'aborted', copy: true, reconciled: true },
    // Inside the transaction, after the deletion and before the commit.
    { phase: 'mutated', outcome: 'aborted', copy: true, reconciled: true },
    // After the commit, before the receipt file.
    { phase: 'committed', outcome: 'completed', copy: true, reconciled: true },
    { phase: 'recorded', outcome: 'completed', copy: true, reconciled: false },
];

for (const { phase, outcome, copy, reconciled } of cases) {
    test(`a reset killed at ${phase} is ${outcome} after restart, never mixed`, async () => {
        const archive = syntheticArchive();
        await killDuring(archive.file, phase);
        const [receipt, ...others] = restart(archive.dir);
        assert.equal(others.length, 0);
        assert.equal(receipt.outcome, outcome);
        assert.equal(receipt.reconciled, reconciled);
        assert.equal(receipt.previousArchive.retained, copy);
        const db = new Database(archive.file, { readonly: true, fileMustExist: true });
        try {
            const generation = readSqliteArchiveGeneration(db);
            assert.equal(users(archive.file), outcome === 'completed' ? 0 : 2);
            assert.equal(generation === archive.generation, outcome === 'aborted');
            if (outcome === 'completed') assert.equal(receipt.archiveGeneration, generation);
            // Clinical rows are never part of the reset.
            assert.ok(db.prepare("SELECT 1 FROM patients WHERE id = 'synthetic-patient'").get());
        } finally { db.close(); }
        const journal = path.join(archive.file + ACCOUNT_RESET_JOURNAL_SUFFIX, receipt.id);
        assert.equal(fs.existsSync(path.join(journal, 'previous.db.partial')), false);
        if (copy) {
            const previous = path.join(journal, 'previous.db');
            assert.equal(createHash('sha256').update(fs.readFileSync(previous)).digest('hex'), receipt.previousArchive.sha256);
            assert.equal(users(previous), 2);
        }
        // A second start finds nothing left to decide.
        assert.deepEqual(restart(archive.dir), [receipt]);
    });
}

test('the previous archive is removed only by an explicit confirmation that matches the receipt', () => {
    const archive = syntheticArchive();
    const db = openVersionedSqliteDatabase(archive.file);
    try {
        const receipt = resetAccountsDurably(db);
        assert.equal(receipt.outcome, 'completed');
        assert.equal(receipt.previousArchive.retained, true);
        const previous = path.join(archive.file + ACCOUNT_RESET_JOURNAL_SUFFIX, receipt.id, 'previous.db');
        fs.appendFileSync(previous, 'x');
        assert.equal(discardPreviousArchive(db, receipt.id), null, 'a copy that changed is kept');
        fs.truncateSync(previous, fs.statSync(previous).size - 1);
        const discarded = discardPreviousArchive(db, receipt.id);
        assert.equal(discarded?.previousArchive.retained, false);
        assert.ok(discarded?.previousArchive.discardedAt);
        assert.deepEqual(listAccountResetReceipts(db).map(entry => entry.outcome), ['completed']);
    } finally { db.close(); }
});

test('a write by another connection after the copy aborts the reset with the archive intact', () => {
    const archive = syntheticArchive();
    const db = openVersionedSqliteDatabase(archive.file);
    const other = new Database(archive.file, { fileMustExist: true });
    try {
        assert.throws(() => resetAccountsDurably(db, { onPhaseForTest: phase => {
            if (phase === 'preserved') other.prepare("UPDATE patients SET version = 2 WHERE id = 'synthetic-patient'").run();
        } }), { code: 'RESET_ARCHIVE_CHANGED' });
        assert.equal(users(archive.file), 2);
        assert.deepEqual(listAccountResetReceipts(db).map(entry => entry.outcome), ['aborted']);
    } finally { other.close(); db.close(); }
});

test('an interrupted reset whose PID now belongs to this process is reconciled, not left in progress', () => {
    const { dir, file, generation } = syntheticArchive();
    const id = '33333333-3333-4333-8333-333333333333';
    const journal = path.join(file + ACCOUNT_RESET_JOURNAL_SUFFIX, id);
    fs.mkdirSync(journal, { recursive: true, mode: 0o700 });
    // Written before this process started, with the PID this process has now: the writer no longer exists.
    fs.writeFileSync(path.join(journal, 'intent.json'), JSON.stringify({ version: 1, id, kind: 'account-reset', target: file,
        pid: process.pid, startedAt: new Date(Date.now() - process.uptime() * 1000 - 60_000).toISOString(), originalGeneration: generation }), { mode: 0o600 });
    fs.mkdirSync(path.join(journal, 'previous.db.partial'));
    const db = new Database(file);
    try {
        const receipt = reconcileAccountResets(db).find(entry => entry.id === id);
        assert.equal(receipt?.outcome, 'aborted');
        assert.equal(receipt?.reconciled, true);
    } finally { db.close(); }
    assert.equal(users(file), 2);
    fs.rmSync(dir, { recursive: true, force: true });
});


test('a failed copy records its refusal even when its partial path cannot be cleaned up', () => {
    const archive = syntheticArchive();
    const db = openVersionedSqliteDatabase(archive.file);
    try {
        assert.throws(() => resetAccountsDurably(db, { onPhaseForTest: phase => {
            if (phase !== 'intent') return;
            const root = archive.file + ACCOUNT_RESET_JOURNAL_SUFFIX;
            fs.mkdirSync(path.join(root, fs.readdirSync(root)[0], 'previous.db.partial'));
        } }), { code: 'RESET_DATABASE_FAILED' });
        const [receipt] = listAccountResetReceipts(db);
        assert.equal(receipt.outcome, 'aborted');
        assert.equal(users(archive.file), 2);
        assert.equal(readSqliteArchiveGeneration(db), archive.generation);
        const partial = path.join(archive.file + ACCOUNT_RESET_JOURNAL_SUFFIX, receipt.id, 'previous.db.partial');
        assert.ok(fs.statSync(partial).isDirectory(), 'an unexpected entry is preserved for inspection');
        assert.deepEqual(restart(archive.dir), [receipt]);
    } finally { db.close(); }
});
