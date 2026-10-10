import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function hashFile(file: string) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function runDrill(workDir: string, reportPath: string, options: { keep?: boolean; callerDataDir?: string } = {}) {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
        if (key.startsWith('MEDIFLOW_') || key.startsWith('NODE_TEST') || key === 'NODE_OPTIONS') delete env[key];
    }
    env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${env.PATH || ''}`;
    if (options.callerDataDir) env.MEDIFLOW_DATA_DIR = options.callerDataDir;
    const result = spawnSync(process.execPath, [
        'scripts/run-strip-types.mjs', 'scripts/backup-restore-drill.mjs',
        '--work-dir', workDir, '--report', reportPath,
        ...(options.keep ? ['--keep-work-dir'] : []),
    ], { cwd: ROOT, env, encoding: 'utf8', timeout: 30_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Restore drill pass\. Report:/);
    assert.ok(fs.existsSync(reportPath), 'the declared report must remain readable after the CLI exits');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.status, 'pass');
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.scenario, 'synthetic-local-restore-drill');
    assert.equal(report.localOnly, true);
    assert.equal(report.restore.mode, 'sandbox-payload-materialization');
    // The backup taken from the source archive is restored by the real executor and exported again.
    assert.equal(report.realRestore.mode, 'sqlite-restore-and-reexport');
    assert.deepEqual(report.realRestore.differences, []);
    assert.ok(report.realRestore.recordsCompared >= 5, 'the seeded synthetic records take part in the comparison');
    assert.equal(report.realRestore.sealedValuesReadable, 8);
    assert.equal(report.preflight.ok, true);
    assert.deepEqual(report.failures, []);
    assert.deepEqual(report.retention, {
        staleArtifactRemoved: true, staleTempRemoved: true, unrelatedFilePreserved: true,
    });
    return report;
}

function withFixture(run: (root: string) => void) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-drill-report-'));
    try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('drill preserves a report inside the work directory after default cleanup', () => withFixture((root) => {
    const workDir = path.join(root, 'work');
    runDrill(workDir, path.join(workDir, 'restore-drill-report.json'));
    assert.deepEqual(fs.readdirSync(workDir), ['restore-drill-report.json']);
}));

test('drill preserves an external report and removes the work directory', () => withFixture((root) => {
    const workDir = path.join(root, 'work');
    runDrill(workDir, path.join(root, 'reports', 'report.json'));
    assert.equal(fs.existsSync(workDir), false);
}));

test('keep-work-dir retains fixtures whose bytes match the report', () => withFixture((root) => {
    const workDir = path.join(root, 'work');
    const report = runDrill(workDir, path.join(workDir, 'report.json'), { keep: true });
    assert.ok(fs.existsSync(path.join(workDir, 'source-data', 'medical.db')));
    assert.ok(fs.existsSync(path.join(workDir, 'target-data', 'medical.db')));
    const backups = path.join(workDir, 'backups');
    const artifacts = fs.readdirSync(backups).filter((file) => file.endsWith('.mediflow'));
    assert.equal(artifacts.length, 1);
    assert.equal(hashFile(path.join(backups, artifacts[0])), report.exportedArtifact.fileSha256);
    assert.equal(hashFile(path.join(workDir, 'restored-payload-snapshot.json')), report.restore.restoredPayloadSnapshotHash);
    assert.equal(fs.readFileSync(path.join(backups, 'operator-note.txt'), 'utf8'), 'do not delete');
}));

test('drill prepares owned fixtures without changing the caller data directory', () => withFixture((root) => {
    const callerDataDir = path.join(root, 'caller-data');
    fs.mkdirSync(callerDataDir);
    const callerDbPath = path.join(callerDataDir, 'medical.db');
    const db = new Database(callerDbPath);
    try {
        db.exec("CREATE TABLE caller_sentinel (value TEXT); INSERT INTO caller_sentinel VALUES ('synthetic caller');");
    } finally { db.close(); }
    const before = hashFile(callerDbPath);
    const workDir = path.join(root, 'work');
    runDrill(workDir, path.join(root, 'report.json'), { callerDataDir });
    assert.equal(hashFile(callerDbPath), before);
    assert.deepEqual(fs.readdirSync(callerDataDir), ['medical.db']);
    assert.equal(fs.existsSync(workDir), false);
}));

test('the drill never lets the database preparer copy a database from the checkout', { skip: process.platform === 'win32' }, () => withFixture((root) => {
    // A stand-in `node` first on PATH records what the drill hands to the preparer, then runs the real one.
    const bin = path.join(root, 'bin');
    const seen = path.join(root, 'preparer-environment.log');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'node'), `#!/bin/sh\nprintf '%s\\n' "$MEDIFLOW_E2E_DISABLE_LEGACY_COPY" >> ${JSON.stringify(seen)}\nexec ${JSON.stringify(process.execPath)} "$@"\n`, { mode: 0o755 });
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
        if (key.startsWith('MEDIFLOW_') || key.startsWith('NODE_TEST') || key === 'NODE_OPTIONS') delete env[key];
    }
    env.PATH = `${bin}${path.delimiter}${env.PATH || ''}`;
    // The caller asks for the legacy copy; the drill must not pass that on.
    env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '0';
    const result = spawnSync(process.execPath, [
        'scripts/run-strip-types.mjs', 'scripts/backup-restore-drill.mjs',
        '--work-dir', path.join(root, 'work'), '--report', path.join(root, 'report.json'),
    ], { cwd: ROOT, env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const handed = fs.readFileSync(seen, 'utf8').trim().split('\n');
    assert.ok(handed.length >= 2, 'both preparer runs go through the stand-in');
    assert.deepEqual([...new Set(handed)], ['1']);
}));
