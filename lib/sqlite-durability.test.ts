import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertDurableDirectory } from './sqlite-durability.mjs';
import { openAdmittedSqlite } from './sqlite-maintenance-admission.mjs';
import { replaceSqliteDatabase } from './sqlite-repair';
import Database from 'better-sqlite3';

function asWindows(operation: () => void) {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const systemRoot = process.env.SystemRoot;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.SystemRoot = 'C:\\Windows';
    try { operation(); }
    finally {
        Object.defineProperty(process, 'platform', descriptor);
        if (systemRoot === undefined) delete process.env.SystemRoot;
        else process.env.SystemRoot = systemRoot;
    }
}

for (const result of [
    { status: 1, stdout: '', error: undefined, signal: null },
    { status: 0, stdout: 'NTFS', error: undefined, signal: null },
    { status: 0, stdout: 'NTFS_FIXED\nextra', error: undefined, signal: null },
    { status: null, stdout: '', error: new Error('synthetic timeout'), signal: 'SIGTERM' },
]) {
    test(`unverified Windows directory remains blocked: ${result.error?.message ?? result.stdout ?? result.status}`, t => {
        t.mock.method(childProcess, 'spawnSync', () => result);
        asWindows(() => assert.throws(() => assertDurableDirectory('C:\\Synthetic'), /SQLITE_DURABILITY_UNSUPPORTED/));
    });
}

test('Windows path is data in a fixed read-only check, including spaces, apostrophe and Unicode', t => {
    const directory = "C:\\Synthetic user's archivio è";
    const execute = t.mock.method(childProcess, 'spawnSync', () => ({ status: 0, stdout: 'NTFS_FIXED', signal: null }));
    asWindows(() => assertDurableDirectory(directory));
    assert.equal(execute.mock.callCount(), 1);
    const [command, args, options] = execute.mock.calls[0].arguments;
    assert.equal(command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.ok(options?.env);
    assert.ok(args);
    assert.equal(options.shell, false);
    assert.equal(options.env.MEDIFLOW_SQLITE_DURABILITY_DIRECTORY, directory);
    assert.equal(args.some((arg: string) => arg.includes(directory)), false);
    assert.equal(args.includes('-ExecutionPolicy'), false);
});

test('UNC, device, alternate stream and noncanonical Windows paths never start the checker', t => {
    const execute = t.mock.method(childProcess, 'spawnSync', () => assert.fail('invalid path must not execute'));
    asWindows(() => {
        for (const directory of ['\\\\server\\share', '\\\\?\\C:\\data', 'C:\\data:stream', 'C:\\data\\..\\other', 'C:/data']) {
            assert.throws(() => assertDurableDirectory(directory), /SQLITE_DURABILITY_UNSUPPORTED/);
        }
    });
    assert.equal(execute.mock.callCount(), 0);
});

test('unqualified Windows storage prevents admission and swap before any destination effect', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-durability-deny-'));
    const target = path.join(dir, 'medical.db'), source = path.join(dir, 'replacement.db');
    const live = new Database(target);
    live.exec('CREATE TABLE synthetic_values (value TEXT); INSERT INTO synthetic_values VALUES (\'original\')');
    new Database(source).close();
    const before = fs.readFileSync(target);
    t.mock.method(childProcess, 'spawnSync', () => ({ status: 1, stdout: '', signal: null }));
    let swapping: Promise<void> | undefined;
    try {
        asWindows(() => {
            assert.throws(() => openAdmittedSqlite(target), /SQLITE_MAINTENANCE_HOLD/);
            swapping = replaceSqliteDatabase({ sourcePath: source, destPath: target, connection: live,
                reopenConnection: () => assert.fail('must not reopen') });
        });
        await assert.rejects(swapping!, /SQLITE_DURABILITY_UNSUPPORTED/);
        assert.equal(live.open, true);
        assert.deepEqual(fs.readFileSync(target), before);
        assert.deepEqual(fs.readdirSync(dir).sort(), ['medical.db', 'replacement.db']);
    } finally { live.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
