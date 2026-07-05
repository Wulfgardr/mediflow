/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
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

test('builds cron line with marker and env', () => {
    const line = buildCronLine({ nodePath: '/usr/bin/node', runnerPath: '/app/runner.mjs', projectRoot: '/app root', dataDir: '/d', destinationDir: "/b's", hour: 2, minute: 0 });
    assert.match(line, /^0 2 \* \* \* /);
    assert.match(line, /cd '\/app root'/);
    assert.match(line, /MEDIFLOW_BACKUP_DEST_DIR='\/b'\\''s'/);
    assert.doesNotMatch(line, /--experimental-strip-types/);
    assert.match(line, /# dev\.wulfgardr\.mediflow\.backup$/);
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
