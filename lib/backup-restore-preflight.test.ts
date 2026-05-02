import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeBackupArtifact } from './backup-artifact';
import { runBackupRestorePreflight } from './backup-restore-preflight';

const basePayload = {
    ambulatories: [
        {
            id: 'amb-1',
            name: 'Ambulatorio principale',
            createdAt: '2026-03-17T08:00:00.000Z',
        },
    ],
    attachments: [],
    conversations: [],
    drugs: [],
    entries: [],
    exemptions: [],
    messages: [],
    observations: [],
    prostheticPrescriptions: [],
    sissHandoffs: [],
    patients: [],
    checkups: [],
    therapies: [],
};

function createDeps(options?: {
    dataDirReadable?: boolean;
    dataDirWritable?: boolean;
    dbExists?: boolean;
    dbReadable?: boolean;
    dbWritable?: boolean;
}) {
    const {
        dataDirReadable = true,
        dataDirWritable = true,
        dbExists = true,
        dbReadable = true,
        dbWritable = true,
    } = options ?? {};

    const dataDir = '/tmp/mediflow-data';
    const dbPath = `${dataDir}/medical.db`;

    return {
        fs: {
            accessSync(targetPath: string, mode = 0) {
                if (targetPath === dataDir) {
                    const wantsRead = (mode & 4) !== 0;
                    const wantsWrite = (mode & 2) !== 0;
                    if ((wantsRead && !dataDirReadable) || (wantsWrite && !dataDirWritable)) {
                        throw new Error('data dir denied');
                    }
                    return;
                }

                if (targetPath === dbPath) {
                    const wantsRead = (mode & 4) !== 0;
                    const wantsWrite = (mode & 2) !== 0;
                    if ((wantsRead && !dbReadable) || (wantsWrite && !dbWritable)) {
                        throw new Error('db denied');
                    }
                }
            },
            existsSync(targetPath: string) {
                return targetPath === dbPath ? dbExists : true;
            },
            constants: {
                R_OK: 4,
                W_OK: 2,
            },
        },
        getDataDir() {
            return dataDir;
        },
        resolveDataPath(...segments: string[]) {
            return [dataDir, ...segments].join('/');
        },
    };
}

test('runBackupRestorePreflight returns pass checks for a valid artifact and writable target', async () => {
    const serialized = await serializeBackupArtifact(basePayload);
    const { artifact, result } = await runBackupRestorePreflight(JSON.parse(serialized), createDeps());

    assert.ok(artifact);
    assert.equal(result.ok, true);
    assert.equal(result.error, undefined);
    assert.equal(result.checks.filter((check) => check.status === 'pass').length, result.checks.length);
});

test('runBackupRestorePreflight flags unsupported artifact versions before restore', async () => {
    const serialized = await serializeBackupArtifact(basePayload);
    const artifact = JSON.parse(serialized);
    artifact.version = 999;

    const { result } = await runBackupRestorePreflight(artifact, createDeps());

    assert.equal(result.ok, false);
    assert.equal(result.checks.some((check) => check.id === 'artifact-version' && check.status === 'fail'), true);
});

test('runBackupRestorePreflight fails when the target database is not writable', async () => {
    const serialized = await serializeBackupArtifact(basePayload);
    const { result } = await runBackupRestorePreflight(JSON.parse(serialized), createDeps({ dbWritable: false }));

    assert.equal(result.ok, false);
    assert.equal(result.checks.some((check) => check.id === 'target-db-writable' && check.status === 'fail'), true);
    assert.match(result.error ?? '', /scrivibile/i);
});
