import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import childProcess, { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
    applyBackupRetention,
    BackupSchedulerOutcomeUnknownError,
    runBackupSchedulerScript,
    applyRetentionResultToState,
    buildBackupLaunchAgentPlist,
    DEFAULT_BACKUP_RETENTION_KEEP_ARTIFACTS,
    getDefaultBackupSchedulerState,
    mergeBackupSchedulerConfig,
    previewBackupRetention,
    readBackupSchedulerStateFromValue,
} from './backup-scheduler.ts';
import {
    buildCronLine,
    getSchedulerAdapter,
    buildBackupSchedulerStatus,
    buildSchtasksCreateArgs,
    buildSystemdServiceUnit,
    buildSystemdTimerUnit,
    buildWindowsWrapperCmd,
} from './backup-scheduler-adapter.ts';

test('reads default backup scheduler state when setting is missing', () => {
    const state = readBackupSchedulerStateFromValue(null);
    assert.equal(state.config.enabled, false);
    assert.equal(state.config.hour, 2);
    assert.equal(state.config.minute, 0);
    assert.match(state.config.destinationDir, /backups$/);
    assert.equal(state.config.retentionKeepArtifacts, DEFAULT_BACKUP_RETENTION_KEEP_ARTIFACTS);
});

test('persisted scheduler enablement accepts only the boolean true', () => {
    assert.equal(readBackupSchedulerStateFromValue(JSON.stringify({ config: { enabled: true } })).config.enabled, true);
    for (const enabled of [false, undefined, null, 0, 1, 'false', 'true', [], {}]) {
        const state = readBackupSchedulerStateFromValue(JSON.stringify({ config: { enabled } }));
        assert.equal(state.config.enabled, false, JSON.stringify(enabled));
    }
});

function withScheduledBackupFixture(check: (fixture: {
    destinationDir: string;
    setEnabled: (enabled: unknown) => void;
    run: (force?: boolean) => { status: number | null; result: { ok: boolean; artifactPath?: string; message?: string } };
}) => void) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'msb-'));
    const dataDir = path.join(root, 'data');
    const destinationDir = path.join(root, 'out');
    fs.mkdirSync(dataDir);
    const dbPath = path.join(dataDir, 'medical.db');
    const setEnabled = (enabled: unknown) => {
        const db = new Database(dbPath);
        try {
            db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
            db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
                .run('backupScheduler', JSON.stringify({ version: 1, config: { enabled, destinationDir, retentionKeepArtifacts: 1 }, run: {} }));
        } finally {
            db.close();
        }
    };
    const run = (force = false) => {
        const child = spawnSync(process.execPath, ['scripts/run-scheduled-backup.mjs'], {
            cwd: fileURLToPath(new URL('..', import.meta.url)),
            encoding: 'utf8',
            env: {
                ...process.env,
                MEDIFLOW_DATA_DIR: dataDir,
                MEDIFLOW_E2E_DATA_DIR: dataDir,
                MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1',
                MEDIFLOW_BACKUP_DEST_DIR: destinationDir,
                MEDIFLOW_BACKUP_FORCE: force ? '1' : '0',
            },
        });
        assert.ifError(child.error);
        return { status: child.status, result: JSON.parse(child.stdout) as { ok: boolean; artifactPath?: string; message?: string } };
    };
    try {
        check({ destinationDir, setEnabled, run });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

for (const [label, enabled] of [
    ['false', false], ['absent', undefined], ['null', null], ['zero', 0],
    ['string false', 'false'], ['string true', 'true'], ['one', 1], ['array', []], ['object', {}],
] as const) {
    test(`scheduled CLI with ${label} enablement preserves the existing artifact without retention`, () => {
        withScheduledBackupFixture(({ destinationDir, setEnabled, run }) => {
            setEnabled(true);
            const control = run();
            assert.equal(control.status, 0);
            assert.equal(control.result.ok, true);
            assert.ok(control.result.artifactPath);
            const artifactPath = control.result.artifactPath;
            const artifactBytes = fs.readFileSync(artifactPath);
            const filesBefore = fs.readdirSync(destinationDir).sort();
            setEnabled(enabled);
            const disabled = run();
            assert.equal(disabled.status, 1);
            assert.equal(disabled.result.ok, false);
            assert.match(disabled.result.message ?? '', /disabilitato/);
            assert.deepEqual(fs.readdirSync(destinationDir).sort(), filesBefore);
            assert.deepEqual(fs.readFileSync(artifactPath), artifactBytes);
        });
    });
}

test('explicit manual force still creates a backup while automatic enablement is false or malformed', () => {
    for (const enabled of [false, 'false']) {
        withScheduledBackupFixture(({ setEnabled, run }) => {
            setEnabled(enabled);
            const forced = run(true);
            assert.equal(forced.status, 0);
            assert.equal(forced.result.ok, true);
            assert.ok(forced.result.artifactPath);
            assert.equal(JSON.parse(fs.readFileSync(forced.result.artifactPath, 'utf8')).format, 'mediflow-backup');
        });
    }
});

test('scheduled backups and a new destination are readable only by the owning account', { skip: process.platform === 'win32' }, () => {
    withScheduledBackupFixture(({ destinationDir, setEnabled, run }) => {
        setEnabled(true);
        const first = run();
        assert.equal(first.result.ok, true, first.result.message);
        assert.equal(fs.statSync(destinationDir).mode & 0o777, 0o700);
        assert.equal(fs.statSync(first.result.artifactPath!).mode & 0o777, 0o600);

        // An artifact an earlier version left readable by everyone: the newest by date, so retention keeps it.
        const earlier = path.join(destinationDir, 'mediflow-backup-v1-20260101-000000.mediflow');
        fs.writeFileSync(earlier, '{}', { mode: 0o644 });
        fs.chmodSync(earlier, 0o644);
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
        fs.utimesSync(earlier, tomorrow, tomorrow);
        const second = run(true);
        assert.equal(second.result.ok, true, second.result.message);
        assert.equal(fs.statSync(earlier).mode & 0o777, 0o600);
        assert.equal(fs.statSync(second.result.artifactPath!).mode & 0o777, 0o600);
    });
});

test('merges and sanitizes backup scheduler config', () => {
    const state = mergeBackupSchedulerConfig(getDefaultBackupSchedulerState(), {
        enabled: true,
        hour: 25,
        minute: -3,
        destinationDir: 'relative/path',
        retentionKeepArtifacts: 0,
    });

    assert.equal(state.config.enabled, true);
    assert.equal(state.config.hour, 23);
    assert.equal(state.config.minute, 0);
    assert.equal(path.isAbsolute(state.config.destinationDir), true);
    assert.equal(state.config.retentionKeepArtifacts, 1);
});

test('builds a launchd plist with the configured schedule and destination', () => {
    const state = mergeBackupSchedulerConfig(getDefaultBackupSchedulerState(), {
        enabled: true,
        hour: 1,
        minute: 45,
        destinationDir: '/Users/demo/Backups/MediFlow',
    });

    const plist = buildBackupLaunchAgentPlist(state, {
        projectRoot: '/tmp/mediflow',
        nodePath: '/opt/homebrew/bin/node',
        dataDir: '/Users/demo/Library/Application Support/MediFlow',
    });

    assert.match(plist, /<integer>1<\/integer>/);
    assert.match(plist, /<integer>45<\/integer>/);
    assert.match(plist, /MEDIFLOW_BACKUP_DEST_DIR/);
    assert.match(plist, /\/Users\/demo\/Backups\/MediFlow/);
    assert.match(plist, /run-scheduled-backup\.mjs/);
    assert.doesNotMatch(plist, /--experimental-strip-types/);
});

test('previews only scheduler-owned backup artifacts beyond keep-last-N plus orphan temp files', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mediflow-backup-preview-'));
    const olderArtifact = path.join(tempDir, 'mediflow-backup-v1-2026-03-18T00-00-00.000Z.mediflow');
    const newerArtifact = path.join(tempDir, 'mediflow-backup-v1-2026-03-18T01-00-00.000Z.mediflow');
    const orphanTemp = path.join(tempDir, 'mediflow-backup-v1-2026-03-18T02-00-00.000Z.mediflow.tmp');
    const unrelated = path.join(tempDir, 'notes.txt');

    await fs.promises.writeFile(olderArtifact, 'older');
    await fs.promises.writeFile(newerArtifact, 'newer');
    await fs.promises.writeFile(orphanTemp, 'temp');
    await fs.promises.writeFile(unrelated, 'keep');
    const staleAt = new Date(Date.now() - (16 * 60 * 1000));
    await fs.promises.utimes(orphanTemp, staleAt, staleAt);

    const preview = previewBackupRetention({
        destinationDir: tempDir,
        retentionKeepArtifacts: 1,
    });

    assert.equal(preview.artifactCount, 2);
    assert.equal(preview.orphanTempCount, 1);
    assert.equal(preview.deleteCount, 2);
    assert.deepEqual(
        preview.items.map((item) => item.reason).sort(),
        ['keep-last-n', 'orphan-temp'],
    );
    assert.equal(preview.items.some((item) => item.path === olderArtifact), true);
    assert.equal(preview.items.some((item) => item.path === newerArtifact), false);
    assert.equal(preview.items.some((item) => item.path === unrelated), false);

    await fs.promises.rm(tempDir, { recursive: true, force: true });
});

test('applies retention and tracks the last cleanup state', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mediflow-backup-apply-'));
    const preservedArtifact = path.join(tempDir, 'mediflow-backup-v1-2026-03-18T02-00-00.000Z.mediflow');
    const staleArtifact = path.join(tempDir, 'mediflow-backup-v1-2026-03-18T01-00-00.000Z.mediflow');
    const orphanTemp = path.join(tempDir, 'mediflow-backup-v1-2026-03-18T03-00-00.000Z.mediflow.tmp');
    const unrelated = path.join(tempDir, 'notes.txt');

    await fs.promises.writeFile(staleArtifact, 'older');
    await fs.promises.writeFile(preservedArtifact, 'latest');
    await fs.promises.writeFile(orphanTemp, 'temp');
    await fs.promises.writeFile(unrelated, 'keep');
    const staleAt = new Date(Date.now() - (16 * 60 * 1000));
    await fs.promises.utimes(orphanTemp, staleAt, staleAt);

    const result = applyBackupRetention(
        {
            destinationDir: tempDir,
            retentionKeepArtifacts: 1,
        },
        { preservePaths: [preservedArtifact] },
    );

    assert.equal(result.deletedCount, 2);
    assert.equal(fs.existsSync(staleArtifact), false);
    assert.equal(fs.existsSync(orphanTemp), false);
    assert.equal(fs.existsSync(preservedArtifact), true);
    assert.equal(fs.existsSync(unrelated), true);

    const trackedState = applyRetentionResultToState(
        {
            ...getDefaultBackupSchedulerState(),
            config: {
                ...getDefaultBackupSchedulerState().config,
                destinationDir: tempDir,
                retentionKeepArtifacts: 1,
            },
            run: {
                ...getDefaultBackupSchedulerState().run,
                lastArtifactPath: preservedArtifact,
            },
        },
        result,
        'manual',
        new Date('2026-03-18T12:00:00.000Z'),
    );

    assert.equal(trackedState.run.lastRetentionMode, 'manual');
    assert.equal(trackedState.run.lastRetentionDeletedCount, 2);
    assert.equal(trackedState.run.lastRetentionAt, '2026-03-18T12:00:00.000Z');
    assert.equal(trackedState.run.lastArtifactPath, preservedArtifact);

    await fs.promises.rm(tempDir, { recursive: true, force: true });
});

test('retention preserves recent temp files and all temps while a runner lock is active', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mediflow-backup-lock-'));
    const recentTemp = path.join(tempDir, 'mediflow-backup-v1-recent.mediflow.tmp');
    const staleTemp = path.join(tempDir, 'mediflow-backup-v1-stale.mediflow.tmp');
    const lockPath = path.join(tempDir, '.mediflow-backup.lock');

    await fs.promises.writeFile(recentTemp, 'recent');
    await fs.promises.writeFile(staleTemp, 'stale');
    const staleAt = new Date(Date.now() - (16 * 60 * 1000));
    await fs.promises.utimes(staleTemp, staleAt, staleAt);
    await fs.promises.writeFile(lockPath, 'active');

    const whileLocked = previewBackupRetention({ destinationDir: tempDir, retentionKeepArtifacts: 1 });
    assert.equal(whileLocked.items.some((item) => item.path === recentTemp), false);
    assert.equal(whileLocked.items.some((item) => item.path === staleTemp), false);

    const staleLockAt = new Date(Date.now() - (7 * 60 * 60 * 1000));
    await fs.promises.utimes(lockPath, staleLockAt, staleLockAt);
    const afterStaleLock = previewBackupRetention({ destinationDir: tempDir, retentionKeepArtifacts: 1 });
    assert.equal(afterStaleLock.items.some((item) => item.path === recentTemp), false);
    assert.equal(afterStaleLock.items.some((item) => item.path === staleTemp), true);

    await fs.promises.rm(tempDir, { recursive: true, force: true });
});

test('builds Windows schtasks args with zero-padded daily time', () => {
    const args = buildSchtasksCreateArgs({ taskName: 'MediFlow Backup', wrapperPath: 'C:\\data\\b.cmd', hour: 2, minute: 5 });
    assert.deepEqual(args, ['/Create', '/F', '/SC', 'DAILY', '/TN', 'MediFlow Backup', '/TR', '"C:\\data\\b.cmd"', '/ST', '02:05']);
});

test('builds Windows wrapper cmd carrying the backup env vars', () => {
    const cmd = buildWindowsWrapperCmd({ nodePath: 'C:\\node.exe', runnerPath: 'C:\\app\\runner.mjs', dataDir: 'C:\\data', destinationDir: 'C:\\dest' });
    assert.match(cmd, /set "MEDIFLOW_DATA_DIR=C:\\data"/);
    assert.match(cmd, /set "MEDIFLOW_BACKUP_DEST_DIR=C:\\dest"/);
    assert.match(cmd, /"C:\\node\.exe" "C:\\app\\runner\.mjs"/);
    assert.doesNotMatch(cmd, /--experimental-strip-types/);
});

test('Windows wrapper preserves literal percent and exclamation paths with a runner exit code', () => {
    const cmd = buildWindowsWrapperCmd({
        nodePath: 'C:\\Program Files\\node%LOCALAPPDATA%!\\node.exe',
        runnerPath: 'C:\\app %PATH%!\\runner.mjs',
        dataDir: 'C:\\data %USERNAME%!\\folder',
        destinationDir: 'C:\\backup %TEMP%!\\folder',
    });
    assert.match(cmd, /^@echo off\r\nsetlocal DisableDelayedExpansion\r\n/);
    assert.match(cmd, /set "MEDIFLOW_DATA_DIR=C:\\data %%USERNAME%%!\\folder"/);
    assert.match(cmd, /set "MEDIFLOW_BACKUP_DEST_DIR=C:\\backup %%TEMP%%!\\folder"/);
    assert.match(cmd, /"C:\\Program Files\\node%%LOCALAPPDATA%%!\\node\.exe" "C:\\app %%PATH%%!\\runner\.mjs"/);
    assert.match(cmd, /\r\nendlocal & exit \/b %errorlevel%\r\n$/);
});

test('builds systemd service and timer units with OnCalendar', () => {
    const service = buildSystemdServiceUnit({ nodePath: '/usr/bin/node', runnerPath: '/app/runner.mjs', projectRoot: '/app', dataDir: '/home/u/.mediflow', destinationDir: '/backups with spaces' });
    assert.match(service, /Type=oneshot/);
    assert.match(service, /Environment="MEDIFLOW_BACKUP_DEST_DIR=\/backups with spaces"/);
    assert.match(service, /ExecStart="\/usr\/bin\/node" "\/app\/runner\.mjs"/);
    assert.doesNotMatch(service, /--experimental-strip-types/);
    const timer = buildSystemdTimerUnit({ hour: 3, minute: 30 });
    assert.match(timer, /OnCalendar=\*-\*-\* 03:30:00/);
    assert.match(timer, /WantedBy=timers\.target/);
});

test('systemd doubles specifiers in every path and dollars only in ExecStart arguments', () => {
    const service = buildSystemdServiceUnit({
        nodePath: '/opt/node %n/${NODE}/node',
        runnerPath: '/app %i/$HOME/runner.mjs',
        projectRoot: '/app %n/$HOME',
        dataDir: '/data %u/${DATA}',
        destinationDir: '/backup %t/$HOME/with "quote" and \\slash',
    });
    assert.match(service, /WorkingDirectory=\/app %%n\/\$HOME\n/);
    assert.match(service, /Environment="MEDIFLOW_DATA_DIR=\/data %%u\/\$\{DATA\}"/);
    assert.match(service, /Environment="MEDIFLOW_BACKUP_DEST_DIR=\/backup %%t\/\$HOME\/with \\"quote\\" and \\\\slash"/);
    assert.match(service, /ExecStart="\/opt\/node %%n\/\$\{NODE\}\/node" "\/app %%i\/\$\$HOME\/runner\.mjs"/);
});

test('systemd rejects WorkingDirectory suffixes that would change the path', () => {
    for (const suffix of [' ', '\t', '\\']) {
        assert.throws(
            () => buildSystemdServiceUnit({
                nodePath: '/usr/bin/node',
                runnerPath: '/app/runner.mjs',
                projectRoot: `/app/project${suffix}`,
                dataDir: '/data',
                destinationDir: '/backup',
            }),
            /Il backup automatico non può usare questa cartella/,
        );
    }
    const service = buildSystemdServiceUnit({
        nodePath: '/usr/bin/node',
        runnerPath: '/app/runner.mjs',
        projectRoot: '/app/with "quote" and \\segment',
        dataDir: '/data',
        destinationDir: '/backup',
    });
    assert.match(service, /WorkingDirectory=\/app\/with "quote" and \\segment\n/);
});

test('builds cron line with marker and env', () => {
    const line = buildCronLine({ nodePath: '/usr/bin/node', runnerPath: '/app/runner.mjs', projectRoot: '/app root', dataDir: '/d', destinationDir: "/b's", hour: 2, minute: 0 });
    assert.match(line, /^0 2 \* \* \* /);
    assert.match(line, /cd '\/app root'/);
    assert.match(line, /MEDIFLOW_BACKUP_DEST_DIR='\/b'\\''s'/);
    assert.doesNotMatch(line, /--experimental-strip-types/);
    assert.match(line, /# dev\.wulfgardr\.mediflow\.backup$/);
});

test('cron passes literal percent, backslash, quote and dollar paths to the shell', async (t) => {
    if (process.platform === 'win32') return t.skip('requires a POSIX shell');
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mediflow-cron-paths-'));
    try {
        const projectRoot = path.join(tempDir, "project % ' $HOME");
        const nodePath = path.join(tempDir, 'node \\% $HOME');
        const runnerPath = path.join(projectRoot, 'runner % file.mjs');
        const dataDir = path.join(tempDir, "data \\% ' $HOME");
        const destinationDir = path.join(tempDir, 'output % \\ $.json');
        await fs.promises.mkdir(projectRoot);
        await fs.promises.symlink(process.execPath, nodePath);
        await fs.promises.writeFile(runnerPath, "import fs from 'node:fs'; fs.writeFileSync(process.env.MEDIFLOW_BACKUP_DEST_DIR, JSON.stringify({cwd: process.cwd(), dataDir: process.env.MEDIFLOW_DATA_DIR, runner: process.argv[1]}));");
        const line = buildCronLine({ nodePath, runnerPath, projectRoot, dataDir, destinationDir, hour: 2, minute: 0 });
        const cronCommand = line.replace(/^0 2 \* \* \* /, '').replace(/ # dev\.wulfgardr\.mediflow\.backup$/, '');
        // Cronie removes the slash before each escaped %, leaving other slashes intact.
        let shellCommand = '';
        let escaped = false;
        for (const char of cronCommand) {
            if (escaped && char === '%') shellCommand = shellCommand.slice(0, -1);
            else if (!escaped && char === '%') assert.fail('unescaped cron percent');
            shellCommand += char;
            escaped = !escaped && char === '\\';
        }
        const result = spawnSync('/bin/sh', ['-c', shellCommand], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(await fs.promises.readFile(destinationDir, 'utf8')), { cwd: await fs.promises.realpath(projectRoot), dataDir, runner: runnerPath });
    } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
});

test('rejects unsafe scheduler command values before writing OS job files', () => {
    assert.throws(
        () => buildWindowsWrapperCmd({ nodePath: 'C:\\node.exe', runnerPath: 'C:\\app\\runner.mjs', dataDir: 'C:\\data', destinationDir: 'C:\\bad"\r\ncalc' }),
        /destinationDir/,
    );
    assert.throws(
        () => buildSystemdServiceUnit({ nodePath: '/usr/bin/node', runnerPath: '/app/runner.mjs', projectRoot: '/app\nRoot', dataDir: '/d', destinationDir: '/b' }),
        /projectRoot/,
    );
    assert.throws(
        () => buildCronLine({ nodePath: '/usr/bin/node', runnerPath: '/app/runner.mjs', projectRoot: '/app', dataDir: '/d', destinationDir: '/b\n* * * * * bad', hour: 2, minute: 0 }),
        /destinationDir/,
    );
});


// The scheduler boundary is replaced; no command reaches a real OS scheduler.
function syntheticScheduler(t: test.TestContext, platform: string, command: typeof spawnSync) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-scheduler-boundary-')));
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const dataDir = process.env.MEDIFLOW_DATA_DIR;
    Object.defineProperty(process, 'platform', { value: platform });
    process.env.MEDIFLOW_DATA_DIR = root;
    t.mock.method(os, 'homedir', () => root);
    t.mock.method(childProcess, 'spawnSync', command);
    syncBuiltinESMExports();
    t.after(() => {
        t.mock.restoreAll(); syncBuiltinESMExports();
        Object.defineProperty(process, 'platform', originalPlatform);
        if (dataDir === undefined) delete process.env.MEDIFLOW_DATA_DIR; else process.env.MEDIFLOW_DATA_DIR = dataDir;
        fs.rmSync(root, { recursive: true, force: true });
    });
    return root;
}
const schedulerResult = (stdout = '', status: number | null = 0, error?: Error) => ({ pid: 1, output: [], stdout, stderr: '', signal: null, status, ...(error ? { error } : {}) });

test('failed or truncated cron read preserves foreign jobs without issuing a write', (t) => {
    let cron = '5 * * * * foreign-job # dev.wulfgardr.mediflow.backup-other\n';
    let writes = 0;
    syntheticScheduler(t, 'linux', ((file: string, args: string[], options: { input?: string }) => {
        if (file === 'systemctl') return schedulerResult('', null, Object.assign(new Error('synthetic missing systemd'), { code: 'ENOENT' }));
        if (args[0] === '-') { writes += 1; cron = options.input ?? ''; return schedulerResult(); }
        return schedulerResult('5 * * * * partial-output', null, Object.assign(new Error('synthetic output limit'), { code: 'ENOBUFS' }));
    }) as unknown as typeof spawnSync);
    assert.throws(() => getSchedulerAdapter().install(getDefaultBackupSchedulerState()), BackupSchedulerOutcomeUnknownError);
    assert.equal(writes, 0);
    assert.equal(cron, '5 * * * * foreign-job # dev.wulfgardr.mediflow.backup-other\n');
    assert.equal(buildBackupSchedulerStatus(null).installed, null);
});

test('cron changes retain foreign marker prefixes and require readback of the exact owned line', (t) => {
    const foreign = '5 * * * * foreign-job # dev.wulfgardr.mediflow.backup-other';
    let cron = foreign + '\n';
    syntheticScheduler(t, 'linux', ((file: string, args: string[], options: { input?: string }) => {
        if (file === 'systemctl') return schedulerResult('', null, Object.assign(new Error('synthetic missing systemd'), { code: 'ENOENT' }));
        if (args[0] === '-') { cron = options.input ?? ''; return schedulerResult(); }
        return schedulerResult(cron);
    }) as unknown as typeof spawnSync);
    getSchedulerAdapter().install(getDefaultBackupSchedulerState());
    assert.equal(cron.split('\n')[0], foreign);
    assert.equal(getSchedulerAdapter().getStatus().installed, true);
    getSchedulerAdapter().uninstall();
    assert.equal(cron, foreign + '\n');
    assert.equal(getSchedulerAdapter().getStatus().installed, false);
});

test('uncertain task deletion stops before wrapper cleanup or another command', (t) => {
    const calls: string[] = [];
    let deletionAccepted = false;
    const root = syntheticScheduler(t, 'win32', ((_file: string, args: string[]) => {
        calls.push(args[0]);
        if (deletionAccepted && args[0] === '/Delete') return schedulerResult();
        if (args[0] === '/Query' && (!deletionAccepted || calls.length === 1)) return schedulerResult('"\\MediFlow Backup","later","Ready"');
        return schedulerResult('', null, Object.assign(new Error('synthetic timeout'), { code: 'ETIMEDOUT' }));
    }) as unknown as typeof spawnSync);
    const wrapper = path.join(root, 'mediflow-scheduled-backup.cmd');
    fs.writeFileSync(wrapper, 'synthetic wrapper');
    assert.throws(() => getSchedulerAdapter().uninstall(), BackupSchedulerOutcomeUnknownError);
    assert.equal(fs.readFileSync(wrapper, 'utf8'), 'synthetic wrapper');
    assert.deepEqual(calls, ['/Query', '/Delete']);
    deletionAccepted = true; calls.length = 0;
    assert.throws(() => getSchedulerAdapter().uninstall(), BackupSchedulerOutcomeUnknownError);
    assert.equal(fs.readFileSync(wrapper, 'utf8'), 'synthetic wrapper');
    assert.deepEqual(calls, ['/Query', '/Delete', '/Query']);
});

test('launchd state comes from the OS response, not the presence of a plist', (t) => {
    const root = syntheticScheduler(t, 'darwin', (() => schedulerResult('PID\tStatus\tLabel\n')) as unknown as typeof spawnSync);
    const plist = path.join(root, 'Library', 'LaunchAgents', 'dev.wulfgardr.mediflow.backup.plist');
    fs.mkdirSync(path.dirname(plist), { recursive: true }); fs.writeFileSync(plist, 'synthetic stale plist');
    assert.equal(getSchedulerAdapter().getStatus().installed, false);
});

test('manual runner cannot publish reassuring JSON when its process failed', (t) => {
    syntheticScheduler(t, process.platform, (() => schedulerResult('{"ok":true,"message":"synthetic success"}', 1)) as unknown as typeof spawnSync);
    assert.deepEqual(runBackupSchedulerScript(), { ok: false, uncertain: true,
        message: 'Esito del backup non confermato. Rileggi l’ultimo backup prima di ripetere l’operazione.' });
});
