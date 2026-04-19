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
