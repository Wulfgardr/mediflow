import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { replaceSqliteDatabase } from './sqlite-repair';

const root = process.cwd();

function fixture(file: string, value: string): Database.Database {
    const db = new Database(file);
    db.exec('CREATE TABLE synthetic_recovery (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO synthetic_recovery VALUES (1, ?)').run(value);
    return db;
}

function contents(dir: string): Record<string, string> {
    return Object.fromEntries(fs.readdirSync(dir, { recursive: true }).map(String).sort().flatMap(name => {
        const file = path.join(dir, name);
        return fs.lstatSync(file).isDirectory() ? [] : [[name, fs.lstatSync(file).isSymbolicLink()
            ? 'SYMLINK:' + fs.readlinkSync(file) : createHash('sha256').update(fs.readFileSync(file)).digest('hex')]];
    }));
}

function boot(dir: string, extraEnv: Record<string, string> = {}) {
    return spawnSync(process.execPath, ['scripts/run-strip-types.mjs', '--input-type=module', '-e',
        "(await import('./lib/db-server.ts')).openDbServer(); console.log('SYNTHETIC_BOOT_OK');"], {
        cwd: root, encoding: 'utf8', timeout: 30_000,
        env: { ...process.env, MEDIFLOW_DATA_DIR: dir, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', ...extraEnv },
    });
}

test('startup preserves ambiguous real SQLite originals instead of selecting by mtime', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-swap-ambiguous-'));
    try {
        fixture(path.join(dir, 'medical.db.old-1'), 'synthetic-original-A').close();
        fixture(path.join(dir, 'medical.db.old-2'), 'synthetic-original-B').close();
        fs.utimesSync(path.join(dir, 'medical.db.old-2'), new Date(2_000_000), new Date(2_000_000));
        const before = contents(dir);
        const result = boot(dir);
        assert.notEqual(result.status, 0);
        assert.deepEqual(contents(dir), before, 'HOLD must preserve every candidate and must not create medical.db');
        assert.match(result.stderr, /SQLITE_SWAP_RECOVERY_REQUIRED/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function worker(dir: string, script: string, extraEnv: Record<string, string> = {}) {
    const result = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', '--input-type=module', '-e', script], {
        cwd: root, encoding: 'utf8', timeout: 30_000,
        env: { ...process.env, MEDIFLOW_DATA_DIR: dir, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', ...extraEnv },
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return result;
}

const crashScript = `
    import Database from 'better-sqlite3';
    import fs from 'node:fs';
    import path from 'node:path';
    import { replaceSqliteDatabase } from './lib/sqlite-repair.ts';
    const dir = process.env.MEDIFLOW_DATA_DIR;
    const destPath = path.join(dir, 'medical.db');
    const sourcePath = path.join(dir, 'replacement.db');
    const live = new Database(destPath);
    let candidate;
    await replaceSqliteDatabase({ sourcePath, destPath, connection: live,
        reopenConnection: () => {
            candidate = new Database(destPath);
            candidate.pragma('journal_mode = WAL');
            candidate.exec('ALTER TABLE synthetic_recovery ADD COLUMN validation TEXT');
            candidate.prepare('UPDATE synthetic_recovery SET validation = ?').run('synthetic-validation');
            return candidate;
        },
        onPhaseForTest: phase => {
            if (phase === process.env.CRASH_PHASE) process.exit(86);
            if (phase === 'cleanup' && process.env.WRITE_AFTER_COMMIT === '1') throw new Error('SYNTHETIC_CLEANUP_FAILURE');
        },
    });
    if (process.env.WRITE_AFTER_COMMIT === '1') {
        candidate.prepare('UPDATE synthetic_recovery SET value = ?').run('synthetic-committed-C');
        process.exit(87);
    }
    candidate.close();
`;

const recoveryScript = `
    import Database from 'better-sqlite3';
    import path from 'node:path';
    import { recoverSqliteSwapArtifacts } from './lib/sqlite-repair.ts';
    const target = path.join(process.env.MEDIFLOW_DATA_DIR, 'medical.db');
    const recovery = recoverSqliteSwapArtifacts(target);
    if (recovery.status === 'HOLD') { console.log(JSON.stringify({status:'HOLD'})); process.exit(3); }
    const db = new Database(target, { fileMustExist: true });
    try {
        const rows = db.prepare('SELECT * FROM synthetic_recovery').all();
        if (recovery.status === 'RECOVERED') recovery.complete();
        console.log(JSON.stringify({ status: recovery.status, rows }));
    } finally { db.close(); }
`;

function crashFixture(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-swap-crash-'));
    fixture(path.join(dir, 'medical.db'), 'synthetic-original-A').close();
    fixture(path.join(dir, 'replacement.db'), 'synthetic-replacement-B').close();
    return dir;
}

for (const phase of ['prepared', 'retired', 'installed', 'validated', 'committed']) {
    test(`process crash at ${phase} recovers the declared side of the durable commit`, () => {
        const dir = crashFixture();
        try {
            assert.equal(worker(dir, crashScript, { CRASH_PHASE: phase }).status, 86);
            const result = worker(dir, recoveryScript);
            assert.equal(result.status, 0, result.stderr + result.stdout);
            const recovered = JSON.parse(result.stdout.trim());
            assert.equal(recovered.status, 'RECOVERED');
            assert.equal(recovered.rows[0].value, phase === 'committed' ? 'synthetic-replacement-B' : 'synthetic-original-A');
            assert.equal(recovered.rows[0].validation, phase === 'committed' ? 'synthetic-validation' : undefined);
            assert.equal(fs.existsSync(path.join(dir, 'medical.db.swap-recovery')), false);
            const repeat = worker(dir, recoveryScript);
            assert.equal(repeat.status, 0, repeat.stderr);
            assert.equal(JSON.parse(repeat.stdout.trim()).status, 'CLEAN');
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
}

test('durable commit survives cleanup failure, later write C and process loss without rollback', () => {
    const dir = crashFixture();
    try {
        assert.equal(worker(dir, crashScript, { WRITE_AFTER_COMMIT: '1' }).status, 87);
        assert.ok(fs.statSync(path.join(dir, 'medical.db-wal')).size > 0);
        const result = worker(dir, recoveryScript);
        assert.equal(result.status, 0, result.stderr + result.stdout);
        assert.deepEqual(JSON.parse(result.stdout.trim()).rows, [{ id: 1, value: 'synthetic-committed-C', validation: 'synthetic-validation' }]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const mutation of ['malformed', 'target-traversal', 'original-digest', 'replacement-digest', 'symlink', 'hardlink', 'collision', 'partial-commit', 'live-owner']) {
    test(`unproven ${mutation} recovery is HOLD without changing any files`, () => {
        const dir = crashFixture();
        try {
            assert.equal(worker(dir, crashScript, { CRASH_PHASE: 'retired' }).status, 86);
            const journalDir = path.join(dir, 'medical.db.swap-recovery');
            const journalPath = path.join(journalDir, 'prepared.json');
            if (mutation === 'malformed') fs.writeFileSync(journalPath, '{');
            if (mutation === 'target-traversal') {
                const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')); journal.target = '../medical.db';
                fs.writeFileSync(journalPath, JSON.stringify(journal));
            }
            if (mutation === 'original-digest') fs.appendFileSync(path.join(journalDir, 'original.db'), 'corrupt');
            if (mutation === 'replacement-digest') fs.appendFileSync(path.join(journalDir, 'replacement.db'), 'corrupt');
            if (mutation === 'hardlink') fs.linkSync(path.join(journalDir, 'original.db'), path.join(dir, 'alias.db'));
            if (mutation === 'live-owner') {
                const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')); journal.pid = process.pid;
                fs.writeFileSync(journalPath, JSON.stringify(journal));
            }
            if (mutation === 'symlink') {
                fs.renameSync(path.join(journalDir, 'original.db'), path.join(dir, 'preserved-original.db'));
                fs.symlinkSync(path.join(dir, 'preserved-original.db'), path.join(journalDir, 'original.db'));
            }
            if (mutation === 'collision') fs.writeFileSync(path.join(journalDir, 'restore.db'), 'synthetic-collision');
            if (mutation === 'partial-commit') fs.writeFileSync(path.join(journalDir, 'committed.json'), '{');
            const before = contents(dir);
            const result = worker(dir, recoveryScript);
            assert.equal(result.status, 3, result.stderr + result.stdout);
            assert.deepEqual(contents(dir), before);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
}

test('fresh and repeated startup work without remnants; build does not inspect persistent recovery', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-swap-clean-'));
    try {
        const initial = boot(dir); assert.equal(initial.status, 0, initial.stderr);
        const repeated = boot(dir); assert.equal(repeated.status, 0, repeated.stderr);
        fs.writeFileSync(path.join(dir, 'medical.db.old-unproven'), 'synthetic-unproven');
        const before = contents(dir);
        const build = boot(dir, { NEXT_PHASE: 'phase-production-build' });
        assert.equal(build.status, 0, build.stderr);
        assert.deepEqual(contents(dir), before);
        const held = boot(dir); assert.notEqual(held.status, 0);
        assert.match(held.stderr, /SQLITE_SWAP_RECOVERY_REQUIRED/);
        assert.deepEqual(contents(dir), before);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('failed replacement reopening retains a readable original snapshot', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-swap-reopen-'));
    const destPath = path.join(dir, 'medical.db');
    const sourcePath = path.join(dir, 'replacement.db');
    const live = fixture(destPath, 'synthetic-original-A');
    fixture(sourcePath, 'synthetic-replacement-B').close();
    try {
        await assert.rejects(replaceSqliteDatabase({ sourcePath, destPath, backupPath: null, connection: live,
            reopenConnection: () => { throw new Error('SYNTHETIC_VALIDATION_FAILURE'); },
        }), /SYNTHETIC_VALIDATION_FAILURE/);
        const originalPath = path.join(dir, 'medical.db.swap-recovery', 'original.db');
        assert.ok(fs.existsSync(originalPath), 'validation failure must not delete the original');
        const original = new Database(originalPath, { readonly: true, fileMustExist: true });
        try { assert.deepEqual(original.prepare('SELECT * FROM synthetic_recovery').all(), [{ id: 1, value: 'synthetic-original-A' }]); }
        finally { original.close(); }
    } finally {
        if (live.open) live.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('original snapshot includes indispensable WAL pages while another handle pins an earlier read', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-swap-wal-'));
    const destPath = path.join(dir, 'medical.db');
    const sourcePath = path.join(dir, 'replacement.db');
    const live = fixture(destPath, 'synthetic-original-A');
    live.pragma('journal_mode = WAL');
    live.pragma('wal_autocheckpoint = 0');
    const reader = new Database(destPath);
    reader.exec('BEGIN');
    reader.prepare('SELECT * FROM synthetic_recovery').all();
    live.prepare('UPDATE synthetic_recovery SET value = ?').run('synthetic-original-WAL');
    fixture(sourcePath, 'synthetic-replacement-B').close();
    let candidate: Database.Database | undefined;
    let snapshotVerified = false;
    try {
        await replaceSqliteDatabase({ sourcePath, destPath, connection: live,
            reopenConnection: () => { candidate = new Database(destPath); return candidate; },
            onPhaseForTest: phase => {
                if (phase !== 'prepared') return;
                const raw = path.join(dir, 'raw-main-only.db');
                fs.copyFileSync(destPath, raw);
                const naive = new Database(raw, { readonly: true });
                try { assert.equal((naive.prepare('SELECT value FROM synthetic_recovery').get() as { value: string }).value, 'synthetic-original-A'); }
                finally { naive.close(); }
                const original = path.join(dir, 'medical.db.swap-recovery', 'original.db');
                const saved = new Database(original, { readonly: true, fileMustExist: true });
                try { assert.equal((saved.prepare('SELECT value FROM synthetic_recovery').get() as { value: string }).value, 'synthetic-original-WAL'); }
                finally { saved.close(); }
                assert.equal(fs.existsSync(original + '-wal'), false);
                assert.equal(fs.existsSync(original + '-shm'), false);
                snapshotVerified = true;
                reader.exec('ROLLBACK'); reader.close();
            },
        });
        assert.equal(snapshotVerified, true);
    } finally {
        if (candidate?.open) candidate.close();
        if (reader.open) reader.close();
        if (live.open) live.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

for (const mode of ['prepared-fsync', 'committed-fsync', 'prepared-directory-fsync', 'committed-directory-fsync', 'install-rename']) {
    test(`${mode} failure preserves the original and obeys the uncertain commit boundary`, () => {
        const dir = crashFixture();
        try {
            const script = `
                import Database from 'better-sqlite3';
                import fs from 'node:fs';
                import path from 'node:path';
                import { replaceSqliteDatabase } from './lib/sqlite-repair.ts';
                const dir = process.env.MEDIFLOW_DATA_DIR, target = path.join(dir, 'medical.db');
                const mode = process.env.FAULT_MODE, descriptors = new Map();
                const open = fs.openSync, close = fs.closeSync, sync = fs.fsyncSync, rename = fs.renameSync;
                let injected = false, candidate, reopenCount = 0, error;
                fs.openSync = function(file, ...args) { const fd = open.call(this, file, ...args); descriptors.set(fd, String(file)); return fd; };
                fs.closeSync = function(fd) { descriptors.delete(fd); return close.call(this, fd); };
                fs.fsyncSync = function(fd) {
                    const name = descriptors.get(fd);
                    const boundary = mode.startsWith('prepared') ? 'prepared' : 'committed';
                    const selected = mode.includes('directory')
                        ? name === path.join(fs.realpathSync(dir), 'medical.db.swap-recovery') && fs.existsSync(path.join(name, boundary + '.json'))
                        : name?.endsWith(mode.replace('-fsync', '.json'));
                    if (!injected && selected) {
                        injected = true; throw Object.assign(new Error('SYNTHETIC_DISK_FULL'), {code:'ENOSPC'});
                    }
                    return sync.call(this, fd);
                };
                fs.renameSync = function(from, to) {
                    if (!injected && mode === 'install-rename' && path.basename(String(from)) === 'replacement.db') {
                        injected = true; throw Object.assign(new Error('SYNTHETIC_LOCKED_FILE'), {code:'EPERM'});
                    }
                    return rename.call(this, from, to);
                };
                try { await replaceSqliteDatabase({ sourcePath: path.join(dir,'replacement.db'), destPath: target,
                    connection: new Database(target), reopenConnection: () => { reopenCount++; candidate = new Database(target); return candidate; }
                }); } catch(caught) { error = caught.message; }
                console.log(JSON.stringify({injected,error,reopenCount,candidateOpen:candidate?.open ?? false}));
                if (candidate?.open) candidate.close();
            `;
            const result = worker(dir, script, { FAULT_MODE: mode });
            assert.equal(result.status, 0, result.stderr);
            const report = JSON.parse(result.stdout.trim());
            assert.equal(report.injected, true);
            assert.match(report.error, /SYNTHETIC_/);
            assert.equal(report.candidateOpen, mode === 'install-rename');
            assert.equal(report.reopenCount, mode.startsWith('prepared') ? 0 : 1);
            const recovered = worker(dir, recoveryScript);
            assert.equal(recovered.status, 0, recovered.stderr + recovered.stdout);
            assert.equal(JSON.parse(recovered.stdout.trim()).rows[0].value,
                mode.startsWith('committed') ? 'synthetic-replacement-B' : 'synthetic-original-A');
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
}

test('production schema validation closes the failed candidate; restart retains original audit and append-only guards', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-swap-production-'));
    try {
        // Fresh admission requires the directory to be empty before staging a replacement.
        const initial = boot(dir);
        assert.equal(initial.status, 0, initial.stderr);
        fixture(path.join(dir, 'replacement.db'), 'synthetic-incompatible-schema').close();
        const result = worker(dir, `
            import Database from 'better-sqlite3';
            import path from 'node:path';
            import { sql } from 'drizzle-orm';
            import { dbServer, swapDatabaseFromFile, openDbServer } from './lib/db-server.ts';
            openDbServer();
            dbServer.run(sql.raw("INSERT INTO audit_events VALUES ('synthetic-swap-audit',1,'patient.updated',1700000000,'success','user','synthetic-operator','patient','synthetic-patient','web','synthetic-request','{}',1700000001)"));
            let rejected = false, closed = false;
            try { await swapDatabaseFromFile(path.join(process.env.MEDIFLOW_DATA_DIR,'replacement.db'), null); } catch { rejected = true; }
            try { dbServer.get(sql.raw('SELECT 1')); } catch (error) { closed = String(error).includes('not open'); }
            const original = new Database(path.join(process.env.MEDIFLOW_DATA_DIR,'medical.db.swap-recovery','original.db'), {readonly:true});
            const audit = original.prepare('SELECT * FROM audit_events').all(); original.close();
            console.log('RESULT:' + JSON.stringify({rejected,closed,audit}));
        `);
        assert.equal(result.status, 0, result.stderr);
        const before = JSON.parse(result.stdout.split('RESULT:')[1]);
        assert.equal(before.rejected, true); assert.equal(before.closed, true); assert.equal(Object.keys(before.audit[0]).length, 13);
        const restarted = boot(dir); assert.equal(restarted.status, 0, restarted.stderr);
        const recovered = new Database(path.join(dir, 'medical.db'), { readonly: true });
        try {
            assert.deepEqual(recovered.prepare('SELECT * FROM audit_events').all(), before.audit);
            assert.equal((recovered.pragma('integrity_check', { simple: true })), 'ok');
            assert.deepEqual(recovered.pragma('foreign_key_check'), []);
        } finally { recovered.close(); }
        const writer = new Database(path.join(dir, 'medical.db'));
        try { assert.throws(() => writer.exec("UPDATE audit_events SET event_type = 'synthetic-overwrite'"), /append-only/); }
        finally { writer.close(); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const mode of ['staging-only', 'corrupt-live', 'unreadable-directory']) {
    test(`${mode} startup cannot discard artifacts or bootstrap a new archive`, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-swap-startup-hold-'));
        try {
            if (mode === 'staging-only') fixture(path.join(dir, 'medical.db.repair-tmp-unproven'), 'synthetic-stage').close();
            else {
                fixture(path.join(dir, 'medical.db.old-unproven'), 'synthetic-original').close();
                if (mode === 'corrupt-live') fs.writeFileSync(path.join(dir, 'medical.db'), 'synthetic-corrupt');
            }
            const before = contents(dir);
            const result = mode === 'unreadable-directory' ? worker(dir, `
                import fs from 'node:fs';
                const read = fs.readdirSync;
                fs.readdirSync = function(file, ...args) {
                    if (String(file) === fs.realpathSync(process.env.MEDIFLOW_DATA_DIR)) throw Object.assign(new Error('SYNTHETIC_PERMISSION_DENIED'), {code:'EACCES'});
                    return read.call(this, file, ...args);
                };
                (await import('./lib/db-server.ts')).openDbServer();
            `) : boot(dir);
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /SQLITE_SWAP_RECOVERY_REQUIRED/);
            assert.deepEqual(contents(dir), before);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
}

test('a committed journal with a missing live database is HOLD, never a rollback or empty bootstrap', () => {
    const dir = crashFixture();
    try {
        assert.equal(worker(dir, crashScript, { CRASH_PHASE: 'committed' }).status, 86);
        fs.unlinkSync(path.join(dir, 'medical.db'));
        const before = contents(dir);
        const result = worker(dir, recoveryScript);
        assert.equal(result.status, 3, result.stderr);
        assert.deepEqual(contents(dir), before);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('crashing during restart recovery keeps the independent original and holds on ambiguous retry', () => {
    const dir = crashFixture();
    try {
        assert.equal(worker(dir, crashScript, { CRASH_PHASE: 'installed' }).status, 86);
        const original = path.join(dir, 'medical.db.swap-recovery', 'original.db');
        const saved = fs.readFileSync(original);
        const interrupted = worker(dir, `
            import fs from 'node:fs';
            import path from 'node:path';
            import { recoverSqliteSwapArtifacts } from './lib/sqlite-repair.ts';
            const rename = fs.renameSync;
            fs.renameSync = function(from, to) {
                const result = rename.call(this, from, to);
                if (path.basename(String(from)) === 'restore.db') process.exit(88);
                return result;
            };
            recoverSqliteSwapArtifacts(path.join(process.env.MEDIFLOW_DATA_DIR, 'medical.db'));
        `);
        assert.equal(interrupted.status, 88);
        assert.deepEqual(fs.readFileSync(original), saved);
        const before = contents(dir);
        assert.equal(worker(dir, recoveryScript).status, 3);
        assert.deepEqual(contents(dir), before);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const fault of ['weakened-trigger', 'audit-index-failure', 'quoted-type', 'extra-trigger']) {
    test(`production swap rejects ${fault} even when ordinary schema setup does not throw`, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-swap-audit-schema-'));
        try {
            const result = worker(dir, `
                import Database from 'better-sqlite3';
                import fs from 'node:fs';
                import path from 'node:path';
                import { sql } from 'drizzle-orm';
                import { dbServer, swapDatabaseFromFile, openDbServer } from './lib/db-server.ts';
            openDbServer();
                const dir = process.env.MEDIFLOW_DATA_DIR, sourcePath = path.join(dir,'replacement.db');
                const live = new Database(path.join(dir,'medical.db'));
                await live.backup(sourcePath); live.close();
                const source = new Database(sourcePath);
                if (process.env.AUDIT_FAULT === 'weakened-trigger') source.exec('DROP TRIGGER audit_events_no_update; CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT 1; END');
                else if (process.env.AUDIT_FAULT === 'audit-index-failure') source.exec('DROP INDEX audit_events_actor_idx; CREATE TABLE audit_events_actor_idx (id INTEGER)');
                else if (process.env.AUDIT_FAULT === 'quoted-type') {
                    const definitions = source.prepare("SELECT type, name, sql FROM sqlite_master WHERE tbl_name='audit_events' AND sql IS NOT NULL").all();
                    source.exec('DROP TABLE audit_events');
                    for (const item of definitions) source.exec(item.type === 'table' ? item.sql.replace('outcome TEXT NOT NULL', 'outcome "TEXT NOT NULL"') : item.sql);
                } else source.exec('CREATE TRIGGER audit_events_skip BEFORE INSERT ON audit_events BEGIN SELECT RAISE(IGNORE); END');
                source.close();
                let error, closed = false;
                try { await swapDatabaseFromFile(sourcePath, null); } catch(caught) { error = caught.message; }
                try { dbServer.get(sql.raw('SELECT 1')); } catch(caught) { closed = String(caught).includes('not open'); }
                console.log('RESULT:' + JSON.stringify({error,closed,committed:fs.existsSync(path.join(dir,'medical.db.swap-recovery','committed.json'))}));
            `, { AUDIT_FAULT: fault });
            assert.equal(result.status, 0, result.stderr);
            const report = JSON.parse(result.stdout.split('RESULT:')[1]);
            assert.ok(report.error); assert.equal(report.closed, true); assert.equal(report.committed, false);
            const restored = boot(dir); assert.equal(restored.status, 0, restored.stderr);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
}

test('production swap accepts the supported tracked migration baseline without weakening audit validation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-swap-legacy-schema-'));
    try {
        // Fresh admission requires the directory to be empty before staging a replacement.
        const initial = boot(dir);
        assert.equal(initial.status, 0, initial.stderr);
        const sourcePath = path.join(dir, 'replacement.db');
        const source = new Database(sourcePath);
        try {
            source.pragma('foreign_keys = OFF');
            for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort()) {
                source.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gm, ''));
            }
            source.exec("INSERT INTO audit_events VALUES ('synthetic-legacy-audit',1,'patient.updated',1700000000,'success','user','synthetic-operator','patient','synthetic-patient','web','synthetic-request','{}',1700000001)");
        } finally { source.close(); }
        const result = worker(dir, `
            import path from 'node:path';
            import { sql } from 'drizzle-orm';
            import { dbServer, swapDatabaseFromFile, openDbServer } from './lib/db-server.ts';
            openDbServer();
            await swapDatabaseFromFile(path.join(process.env.MEDIFLOW_DATA_DIR,'replacement.db'), null);
            const audit = dbServer.all(sql.raw('SELECT * FROM audit_events'));
            console.log('RESULT:' + JSON.stringify(audit));
        `);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout.split('RESULT:')[1])[0].event_id, 'synthetic-legacy-audit');
        assert.equal(fs.existsSync(path.join(dir, 'medical.db.swap-recovery')), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('SOAP imported before first open cannot acquire replacement authority on its first use after swap', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-soap-initial-handle-'));
    try {
        const result = worker(dir, `
            import assert from 'node:assert/strict';
            import path from 'node:path';
            import Database from 'better-sqlite3';
            import { sql } from 'drizzle-orm';
            import { createHeadlessSoapActiveRoleAttestationStore, isHeadlessSoapActiveRoleAttestationStoreError } from './lib/security/headless-soap-active-role-attestation-store.ts';
            import './lib/security/headless-soap-entry-commit-owner.ts';
            import { openDbServer, dbServer, swapDatabaseFromFile } from './lib/db-server.ts';
            const initial = openDbServer();
            const replacementPath = path.join(process.env.MEDIFLOW_DATA_DIR, 'replacement.db');
            await initial.backup(replacementPath);
            const replacement = new Database(replacementPath);
            replacement.prepare("INSERT INTO users (id,username,password_hash,encrypted_master_key,salt) VALUES ('replacement-only','replacement-user','synthetic-hash','synthetic-key','synthetic-salt')").run();
            replacement.close();
            await swapDatabaseFromFile(replacementPath, null);
            assert.equal(initial.open, false);
            assert.throws(() => initial.prepare('SELECT 1'), /not open/);
            assert.equal(dbServer.get(sql.raw("SELECT count(*) AS count FROM users WHERE id='replacement-only'")).count, 1);
            assert.throws(() => createHeadlessSoapActiveRoleAttestationStore().createInactive('replacement-only'),
                error => isHeadlessSoapActiveRoleAttestationStoreError(error) && error.code === 'storage_unavailable');
            assert.equal(dbServer.get(sql.raw('SELECT count(*) AS count FROM headless_soap_active_role_attestations')).count, 0);
            assert.equal(dbServer.get(sql.raw('SELECT count(*) AS count FROM audit_events')).count, 0);
        `);
        assert.equal(result.status, 0, result.stderr);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
