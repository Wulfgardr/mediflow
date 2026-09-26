/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'node:child_process';
import {
    applyBackupRetention,
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
