/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { openAdmittedSqlite, runWithSqliteMaintenance, SqliteMaintenanceHoldError } from './sqlite-maintenance-admission.mjs';

const root = process.cwd();
const store = (target: string) => target + '.maintenance-admission';
function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-admission-'));
    const target = path.join(dir, 'medical.db');
    const db = new Database(target);
    db.exec('CREATE TABLE synthetic_values (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    db.close();
    return { dir, target, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
function child(script: string, dir: string) {
    const worker = spawn(process.execPath, ['--import', './scripts/register-strip-types-loader.mjs', '--input-type=module', '-e', script], {
        cwd: root, env: { ...process.env, MEDIFLOW_DATA_DIR: dir, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let output = '';
    worker.stdout!.on('data', bytes => { output += bytes.toString(); });
    worker.stderr!.on('data', bytes => { output += bytes.toString(); });
    const terminal = new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => { worker.kill(); reject(new Error('owned child deadline: ' + output)); }, 20_000);
        worker.once('error', error => { clearTimeout(timer); reject(error); });
        worker.once('exit', code => { clearTimeout(timer); resolve(code); });
    });
    return { worker, terminal, output: () => output };
}
function message(worker: ChildProcess) {
    return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => { worker.off('message', receive); reject(new Error('child barrier deadline')); }, 10_000);
        const receive = (value: unknown) => { clearTimeout(timer); resolve(value); };
        worker.once('message', receive);
    });
}
async function waitIntent(target: string) {
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(path.join(store(target), 'intent.json'))) {
        assert.ok(Date.now() < deadline, 'maintenance must publish intent');
        await delay(5);
    }
}

test('lease spans native open and close; successful maintenance admits the next connection', async () => {
    const f = fixture();
    try {
        const participant = openAdmittedSqlite(f.target, { role: 'reader', sqliteOptions: { readonly: true } });
        assert.equal(fs.readdirSync(path.join(store(f.target), 'leases')).length, 1);
        await participant.close();
        assert.equal(participant.database.open, false);
        await participant.close();
        let reached = false;
        await runWithSqliteMaintenance(f.target, { timeoutMs: 1000 }, () => { reached = true; });
        assert.equal(reached, true);
        const next = openAdmittedSqlite(f.target);
        await next.close();
    } finally { f.cleanup(); }
});

test('intent first denies native open and cannot create a missing target', async () => {
    const f = fixture();
    fs.unlinkSync(f.target);
    try {
        await runWithSqliteMaintenance(f.target, {}, async () => {
            assert.throws(() => openAdmittedSqlite(f.target), /maintenance_pending/);
            const w = child(`
                import assert from 'node:assert/strict';
                import path from 'node:path';
                import { openAdmittedSqlite } from './lib/sqlite-maintenance-admission.mjs';
                assert.throws(() => openAdmittedSqlite(path.join(process.env.MEDIFLOW_DATA_DIR, 'medical.db')), /maintenance_pending/);
                process.disconnect();
            `, f.dir);
            assert.equal(await w.terminal, 0, w.output());
            assert.equal(fs.existsSync(f.target), false);
        });
    } finally { f.cleanup(); }
});

test('another process admitted first drains before snapshot; subsequent open is denied', async () => {
    const f = fixture();
    const w = child(`
        import path from 'node:path';
        import { openAdmittedSqlite } from './lib/sqlite-maintenance-admission.mjs';
        const lease = openAdmittedSqlite(path.join(process.env.MEDIFLOW_DATA_DIR, 'medical.db'));
        lease.database.pragma('journal_mode = WAL');
        lease.database.pragma('wal_autocheckpoint = 0');
        lease.database.prepare('INSERT INTO synthetic_values VALUES (?, ?)').run(1, 'WAL-A');
        const go = new Promise(resolve => process.once('message', resolve));
        process.send('OPEN'); await go;
        lease.database.prepare('INSERT INTO synthetic_values VALUES (?, ?)').run(2, 'DRAIN-B');
        await lease.close(); process.disconnect();
    `, f.dir);
    try {
        assert.equal(await message(w.worker), 'OPEN');
        let snapshotStarted = false;
        const operation = runWithSqliteMaintenance(f.target, { timeoutMs: 5000 }, async () => {
            snapshotStarted = true;
            const db = new Database(f.target, { readonly: true });
            try { await db.backup(path.join(f.dir, 'snapshot.db')); } finally { db.close(); }
        });
        await waitIntent(f.target);
        assert.equal(snapshotStarted, false);
        assert.throws(() => openAdmittedSqlite(f.target), /maintenance_pending/);
        w.worker.send('DRAIN');
        assert.equal(await w.terminal, 0, w.output());
        await operation;
        const snapshot = new Database(path.join(f.dir, 'snapshot.db'), { readonly: true });
        try { assert.deepEqual(snapshot.prepare('SELECT value FROM synthetic_values ORDER BY id').all(), [{ value: 'WAL-A' }, { value: 'DRAIN-B' }]); }
        finally { snapshot.close(); }
    } finally {
        if (w.worker.exitCode === null && w.worker.signalCode === null) { w.worker.kill(); await w.terminal; }
        f.cleanup();
    }
});

test('deadline refuses maintenance before callback and leaves native database unchanged', async () => {
    const f = fixture();
    const participant = openAdmittedSqlite(f.target);
    const before = fs.readFileSync(f.target);
    try {
        let called = false;
        await assert.rejects(runWithSqliteMaintenance(f.target, { timeoutMs: 20 }, () => { called = true; }), /drain_timeout/);
        assert.equal(called, false);
        assert.deepEqual(fs.readFileSync(f.target), before);
        assert.equal(fs.existsSync(path.join(store(f.target), 'intent.json')), false, 'only this never-started invocation may cancel its own intent');
        await participant.close();
        await runWithSqliteMaintenance(f.target, {}, () => {});
    } finally { if (participant.database.open) participant.database.close(); f.cleanup(); }
});

test('failed native close retains the lease and blocks maintenance', async () => {
    const f = fixture();
    const participant = openAdmittedSqlite(f.target);
    const nativeClose = participant.database.close;
    participant.database.close = () => { throw new Error('synthetic locked handle'); };
    try {
        await assert.rejects(participant.close(), SqliteMaintenanceHoldError);
        assert.equal(participant.database.open, true);
        assert.equal(fs.readdirSync(path.join(store(f.target), 'leases')).length, 1);
        await assert.rejects(runWithSqliteMaintenance(f.target, { timeoutMs: 10 }, () => assert.fail('no snapshot')), /drain_timeout/);
        participant.database.close = nativeClose;
        await participant.close();
    } finally { participant.database.close = nativeClose; if (participant.database.open) participant.database.close(); f.cleanup(); }
});

test('interrupted participant is never reaped from PID or mtime', async () => {
    const f = fixture();
    const w = child(`
        import path from 'node:path';
        import { openAdmittedSqlite } from './lib/sqlite-maintenance-admission.mjs';
        openAdmittedSqlite(path.join(process.env.MEDIFLOW_DATA_DIR, 'medical.db'));
        process.exit(86);
    `, f.dir);
    try {
        assert.equal(await w.terminal, 86, w.output());
        const files = fs.readdirSync(path.join(store(f.target), 'leases'));
        assert.equal(files.length, 1);
        const file = path.join(store(f.target), 'leases', files[0]);
        fs.utimesSync(file, new Date(0), new Date(0));
        const before = fs.readFileSync(file);
        await assert.rejects(runWithSqliteMaintenance(f.target, { timeoutMs: 10 }, () => assert.fail('no snapshot')), /drain_timeout/);
        assert.deepEqual(fs.readFileSync(file), before);
    } finally { f.cleanup(); }
});

test('callback failure preserves intent and denies later admission', async () => {
    const f = fixture();
    try {
        await assert.rejects(runWithSqliteMaintenance(f.target, {}, () => { throw new Error('synthetic interrupted swap'); }), SqliteMaintenanceHoldError);
        const file = path.join(store(f.target), 'intent.json');
        fs.utimesSync(file, new Date(0), new Date(0));
        assert.throws(() => openAdmittedSqlite(f.target), /maintenance_pending/);
        await assert.rejects(runWithSqliteMaintenance(f.target, {}, () => assert.fail()), /maintenance_pending/);
        assert.ok(fs.existsSync(file));
    } finally { f.cleanup(); }
});

for (const fault of ['unknown-lease', 'target-mismatch', 'stale-gate', 'malformed-intent', 'swap-remnant']) {
    test(`${fault} never authorizes maintenance or a conflicting opener`, async () => {
        const f = fixture();
        try {
            const lease = openAdmittedSqlite(f.target); await lease.close();
            const dir = store(f.target);
            if (fault === 'stale-gate') fs.mkdirSync(path.join(dir, 'gate'));
            else if (fault === 'malformed-intent') fs.writeFileSync(path.join(dir, 'intent.json'), '{');
            else if (fault === 'swap-remnant') fs.mkdirSync(f.target + '.swap-recovery');
            else {
                const id = randomUUID();
                fs.writeFileSync(path.join(dir, 'leases', id + '.json'), fault === 'unknown-lease' ? '{}' : JSON.stringify({ version: 1, id, role: 'reader', pid: 1, target: f.target + '-different' }));
            }
            const before = fs.readFileSync(f.target);
            assert.throws(() => openAdmittedSqlite(f.target), SqliteMaintenanceHoldError);
            if (fault !== 'swap-remnant') await assert.rejects(runWithSqliteMaintenance(f.target, { timeoutMs: 10 }, () => assert.fail()), SqliteMaintenanceHoldError);
            assert.deepEqual(fs.readFileSync(f.target), before);
        } finally { f.cleanup(); }
    });
}

test('linked target or admission root is rejected without opening the target', async () => {
    const f = fixture();
    try {
        const outside = path.join(f.dir, 'outside'); fs.mkdirSync(outside);
        fs.symlinkSync(outside, store(f.target), 'dir');
        assert.throws(() => openAdmittedSqlite(f.target), SqliteMaintenanceHoldError);
        assert.deepEqual(fs.readdirSync(outside), []);
        fs.unlinkSync(store(f.target));
        fs.linkSync(f.target, path.join(f.dir, 'alias.db'));
        assert.throws(() => openAdmittedSqlite(f.target), SqliteMaintenanceHoldError);
    } finally { f.cleanup(); }
});

test('failed native constructor leaves an unresolved registration instead of claiming a closed handle', async () => {
    const f = fixture();
    fs.unlinkSync(f.target);
    try {
        assert.throws(() => openAdmittedSqlite(f.target, { sqliteOptions: { fileMustExist: true } }), SqliteMaintenanceHoldError);
        assert.equal(fs.existsSync(f.target), false);
        assert.equal(fs.readdirSync(path.join(store(f.target), 'leases')).length, 1);
        await assert.rejects(runWithSqliteMaintenance(f.target, { timeoutMs: 10 }, () => assert.fail()), /drain_timeout/);
    } finally { f.cleanup(); }
});

test('failed intent fsync never starts maintenance or permits a conflicting open', async () => {
    const f = fixture();
    const nativeOpen = fs.openSync, nativeSync = fs.fsyncSync;
    let intentFd = -1;
    fs.openSync = ((file, flags, mode) => {
        const fd = nativeOpen(file, flags, mode);
        if (String(file).endsWith('/intent.json')) intentFd = fd;
        return fd;
    }) as typeof fs.openSync;
    fs.fsyncSync = fd => { if (fd === intentFd) throw Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' }); nativeSync(fd); };
    try {
        await assert.rejects(runWithSqliteMaintenance(f.target, {}, () => assert.fail('no snapshot')), SqliteMaintenanceHoldError);
    } finally { fs.openSync = nativeOpen; fs.fsyncSync = nativeSync; }
    try {
        assert.ok(fs.existsSync(path.join(store(f.target), 'intent.json')));
        assert.throws(() => openAdmittedSqlite(f.target), /maintenance_pending/);
    } finally { f.cleanup(); }
});

test('process exit after callback entry leaves intent and never grants a new owner', async () => {
    const f = fixture();
    const w = child(`
        import path from 'node:path';
        import { runWithSqliteMaintenance } from './lib/sqlite-maintenance-admission.mjs';
        await runWithSqliteMaintenance(path.join(process.env.MEDIFLOW_DATA_DIR, 'medical.db'), {}, () => process.exit(87));
    `, f.dir);
    try {
        assert.equal(await w.terminal, 87, w.output());
        assert.throws(() => openAdmittedSqlite(f.target), /maintenance_pending/);
        await assert.rejects(runWithSqliteMaintenance(f.target, {}, () => assert.fail()), /maintenance_pending/);
    } finally { f.cleanup(); }
});

function schedulerFixture() {
    const f = fixture();
    const db = new Database(f.target);
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO settings VALUES (?, ?)').run('backupScheduler', JSON.stringify({
        config: { enabled: true, destinationDir: path.join(f.dir, 'backups') }, run: { lastRunStatus: null },
    }));
    db.close();
    return f;
}

const schedulerWorker = `
    import fs from 'node:fs';
    import path from 'node:path';
    import Database from 'better-sqlite3';
    const target = fs.realpathSync(path.join(process.env.MEDIFLOW_DATA_DIR, 'medical.db'));
    const seen = new Set(), closed = new Set();
    const prepare = Database.prototype.prepare, close = Database.prototype.close;
    Database.prototype.prepare = function(...args) { if (this.name === target) seen.add(this); return prepare.apply(this, args); };
    Database.prototype.close = function(...args) { const result = close.apply(this, args); if (this.name === target) closed.add(this); return result; };
    if (process.env.SCHEDULER_BARRIER === '1') {
        const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
        globalThis.crypto.subtle.digest = async (...args) => {
            const go = new Promise(resolve => process.once('message', resolve));
            process.send('SERIALIZING'); await go;
            [...seen][0].prepare('INSERT INTO synthetic_values VALUES (1, ?)').run('scheduler-finished-before-snapshot');
            if (process.env.SCHEDULER_FAIL === '1') throw new Error('synthetic serialization failure');
            return digest(...args);
        };
    }
    process.argv[1] = path.resolve('scripts/run-scheduled-backup.mjs');
    await import('./scripts/run-scheduled-backup.mjs');
    console.log('NATIVE_HANDLES:' + JSON.stringify({opened:seen.size,closed:closed.size,stillOpen:[...seen].filter(db => db.open).length}));
    process.disconnect();
`;
function schedulerChild(dir: string, barrier = false, fail = false) {
    return child(`process.env.SCHEDULER_BARRIER = '${barrier ? '1' : '0'}'; process.env.SCHEDULER_FAIL = '${fail ? '1' : '0'}';\n` + schedulerWorker, dir);
}

for (const fail of [false, true]) {
    test(`real scheduler ${fail ? 'error' : 'success'} finishes and closes its only writer before maintenance snapshots`, async () => {
        const f = schedulerFixture();
        const w = schedulerChild(f.dir, true, fail);
        try {
            assert.equal(await message(w.worker), 'SERIALIZING');
            let snapshotStarted = false;
            const maintenance = runWithSqliteMaintenance(f.target, { timeoutMs: 5000 }, async () => {
                snapshotStarted = true;
                const db = new Database(f.target, { readonly: true });
                try { await db.backup(path.join(f.dir, 'snapshot.db')); } finally { db.close(); }
            });
            await waitIntent(f.target);
            assert.equal(snapshotStarted, false);
            w.worker.send('COMPLETE');
            assert.equal(await w.terminal, fail ? 1 : 0, w.output());
            await maintenance;
            assert.match(w.output(), /NATIVE_HANDLES:\{"opened":1,"closed":1,"stillOpen":0\}/);
            const snapshot = new Database(path.join(f.dir, 'snapshot.db'), { readonly: true });
            try {
                const row = snapshot.prepare('SELECT value FROM settings WHERE key = ?').get('backupScheduler') as { value: string };
                assert.equal(JSON.parse(row.value).run.lastRunStatus, fail ? 'error' : 'success');
                assert.deepEqual(snapshot.prepare('SELECT value FROM synthetic_values').all(), [{ value: 'scheduler-finished-before-snapshot' }]);
            } finally { snapshot.close(); }
            assert.deepEqual(fs.readdirSync(path.join(store(f.target), 'leases')), []);
            const next = schedulerChild(f.dir);
            assert.equal(await next.terminal, 0, next.output());
        } finally {
            if (w.worker.exitCode === null && w.worker.signalCode === null) { w.worker.kill(); await w.terminal; }
            f.cleanup();
        }
    });
}

test('scheduler admission denial never reaches its error-path writer or changes scheduler state', async () => {
    const f = schedulerFixture();
    const before = fs.readFileSync(f.target);
    try {
        await runWithSqliteMaintenance(f.target, {}, async () => {
            const w = schedulerChild(f.dir);
            assert.equal(await w.terminal, 1, w.output());
            assert.match(w.output(), /SQLITE_MAINTENANCE_HOLD: maintenance_pending/);
            assert.match(w.output(), /NATIVE_HANDLES:\{"opened":0,"closed":0,"stillOpen":0\}/);
            assert.deepEqual(fs.readFileSync(f.target), before);
            assert.equal(fs.existsSync(path.join(f.dir, 'backups')), false);
            assert.deepEqual(fs.readdirSync(path.join(store(f.target), 'leases')), []);
        });
    } finally { f.cleanup(); }
});

for (const fault of ['destination-file', 'missing-settings']) {
    test(`scheduler ${fault} closes the initial native handle without a second open`, async () => {
        const f = schedulerFixture();
        try {
            if (fault === 'destination-file') fs.writeFileSync(path.join(f.dir, 'backups'), 'synthetic obstruction');
            else { const db = new Database(f.target); db.exec('DROP TABLE settings'); db.close(); }
            const w = schedulerChild(f.dir);
            assert.equal(await w.terminal, 1, w.output());
            assert.match(w.output(), /NATIVE_HANDLES:\{"opened":1,"closed":1,"stillOpen":0\}/);
            assert.deepEqual(fs.readdirSync(path.join(store(f.target), 'leases')), []);
            await runWithSqliteMaintenance(f.target, {}, () => {});
        } finally { f.cleanup(); }
    });
}

test('scheduler drain timeout never snapshots and leaves the target unchanged until the scheduler resumes', async () => {
    const f = schedulerFixture();
    const w = schedulerChild(f.dir, true);
    try {
        assert.equal(await message(w.worker), 'SERIALIZING');
        const before = fs.readFileSync(f.target);
        await assert.rejects(runWithSqliteMaintenance(f.target, { timeoutMs: 20 }, () => assert.fail('no snapshot')), /drain_timeout/);
        assert.deepEqual(fs.readFileSync(f.target), before);
        assert.equal(fs.existsSync(path.join(store(f.target), 'intent.json')), false);
        w.worker.send('COMPLETE');
        assert.equal(await w.terminal, 0, w.output());
        await runWithSqliteMaintenance(f.target, {}, () => {});
    } finally {
        if (w.worker.exitCode === null && w.worker.signalCode === null) { w.worker.kill(); await w.terminal; }
        f.cleanup();
    }
});

for (const [label, whitespace] of [['space', ' '], ['tab', '\t'], ['newline', '\n'], ['carriage-return', '\r'], ['nbsp', '\u00a0'], ['bom', '\ufeff']]) {
    for (const position of ['leading', 'trailing']) {
        test(`driver ${position} ${label} alias cannot acquire a separate participant or maintenance identity`, async () => {
            const f = fixture();
            const alias = position === 'leading' ? whitespace + f.target : f.target + whitespace;
            try {
                const before = fs.readdirSync(f.dir);
                // Alias-first is rejected before native open or lease creation.
                // It cannot establish an invisible live handle for a later owner.
                assert.throws(() => openAdmittedSqlite(alias, { sqliteOptions: { fileMustExist: true } }), /invalid_target/);
                assert.deepEqual(fs.readdirSync(f.dir), before);

                const participant = openAdmittedSqlite(f.target);
                try {
                    // A canonical live handle also cannot be evaded by spelling
                    // the maintenance target with driver-trimmed whitespace.
                    await assert.rejects(runWithSqliteMaintenance(alias, {}, () => assert.fail('no callback while canonical handle is live')), /invalid_target/);
                    assert.equal(participant.database.open, true);
                    assert.equal(fs.readdirSync(path.join(store(f.target), 'leases')).length, 1);
                } finally { await participant.close(); }

                await runWithSqliteMaintenance(f.target, {}, () => {
                    // Intent-first: an alias opener cannot write to this target.
                    assert.throws(() => openAdmittedSqlite(alias, { sqliteOptions: { fileMustExist: true } }), /invalid_target/);
                    assert.deepEqual(fs.readdirSync(path.join(store(f.target), 'leases')), []);
                });
                const inspect = new Database(f.target, { readonly: true });
                try { assert.equal((inspect.prepare('SELECT count(*) AS n FROM synthetic_values').get() as { n: number }).n, 0); }
                finally { inspect.close(); }
            } finally { f.cleanup(); }
        });
    }
}

test('internal filename and directory whitespace retains its exact filesystem identity', async () => {
    const f = fixture();
    try {
        const dir = path.join(f.dir, 'synthetic directory ');
        fs.mkdirSync(dir);
        const target = path.join(dir, 'synthetic database.db');
        const participant = openAdmittedSqlite(target);
        try {
            const actual = (participant.database.pragma('database_list') as Array<{ file: string }>)[0].file;
            assert.equal(actual, fs.realpathSync(target));
        } finally { await participant.close(); }
        assert.deepEqual(fs.readdirSync(f.dir).sort(), ['medical.db', 'synthetic directory ']);
        await runWithSqliteMaintenance(target, {}, () => {});
    } finally { f.cleanup(); }
});
