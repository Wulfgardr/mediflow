/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { parseBackupArtifact } from './backup-artifact';
import { derivePatientAmbulatoryLinks } from './backup-patient-ambulatory-links';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('scheduled backup roundtrip restores both ambulatory memberships for one patient', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-scheduled-membership-'));
    const sourceDataDir = path.join(workDir, 'source');
    const targetDataDir = path.join(workDir, 'target');
    const backupDir = path.join(workDir, 'backups');

    try {
        for (const dataDir of [sourceDataDir, targetDataDir]) {
            execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], {
                cwd: ROOT_DIR,
                env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
                stdio: 'pipe',
            });
        }

        const sourceDb = new Database(path.join(sourceDataDir, 'medical.db'));
        let primaryAmbulatoryId: string;
        try {
            primaryAmbulatoryId = (sourceDb.prepare('SELECT id FROM ambulatories WHERE is_default = 1 LIMIT 1').get() as { id: string }).id;
            sourceDb.prepare('INSERT INTO ambulatories (id, name, type, is_default, created_at) VALUES (?, ?, ?, ?, ?)')
                .run('roundtrip-amb-secondary', 'Ambulatorio sintetico secondario', 'synthetic', 0, 1_700_000_000);
            sourceDb.prepare('INSERT INTO patients (id, first_name, last_name, tax_code, ambulatory_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run('roundtrip-patient', 'Synthetic', 'Membership', 'SYNTHETIC-ONLY', primaryAmbulatoryId, 1_700_000_000, 1_700_000_000);
            sourceDb.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id, assigned_at) VALUES (?, ?, ?)')
                .run('roundtrip-patient', primaryAmbulatoryId, 1_700_000_100);
            sourceDb.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id, assigned_at) VALUES (?, ?, ?)')
                .run('roundtrip-patient', 'roundtrip-amb-secondary', 1_700_000_200);
        } finally {
            sourceDb.close();
        }

        fs.mkdirSync(backupDir, { recursive: true });
        const runnerResult = JSON.parse(execFileSync(process.execPath, ['scripts/run-scheduled-backup.mjs'], {
            cwd: ROOT_DIR,
            env: {
                ...process.env,
                MEDIFLOW_DATA_DIR: sourceDataDir,
                MEDIFLOW_BACKUP_DEST_DIR: backupDir,
                MEDIFLOW_BACKUP_FORCE: '1',
            },
            encoding: 'utf8',
        })) as { ok: boolean; artifactPath?: string; message?: string };
        assert.equal(runnerResult.ok, true, runnerResult.message);
        assert.ok(runnerResult.artifactPath);

        const artifact = await parseBackupArtifact(JSON.parse(fs.readFileSync(runnerResult.artifactPath, 'utf8')));
        const patient = artifact.payload.patients.find((row) => row.id === 'roundtrip-patient');
        assert.deepEqual(patient?.assignedAmbulatoryIds, [primaryAmbulatoryId, 'roundtrip-amb-secondary'].sort());
        assert.deepEqual(patient?.assignedAmbulatoryMemberships, [
            { ambulatoryId: primaryAmbulatoryId, assignedAt: '2023-11-14T22:15:00.000Z' },
            { ambulatoryId: 'roundtrip-amb-secondary', assignedAt: '2023-11-14T22:16:40.000Z' },
        ].sort((left, right) => left.ambulatoryId.localeCompare(right.ambulatoryId)));

        const targetDb = new Database(path.join(targetDataDir, 'medical.db'));
        try {
            targetDb.transaction(() => {
                targetDb.prepare('DELETE FROM patients_to_ambulatories').run();
                targetDb.prepare('DELETE FROM patients').run();
                targetDb.prepare('DELETE FROM ambulatories').run();
                for (const ambulatory of artifact.payload.ambulatories) {
                    targetDb.prepare('INSERT INTO ambulatories (id, name, type, is_default, created_at) VALUES (?, ?, ?, ?, ?)')
                        .run(
                            ambulatory.id,
                            ambulatory.name,
                            ambulatory.type ?? null,
                            ambulatory.isDefault ?? null,
                            ambulatory.createdAt ?? null,
                        );
                }
                targetDb.prepare('INSERT INTO patients (id, first_name, last_name, tax_code, ambulatory_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                    .run(
                        patient?.id ?? null,
                        patient?.firstName ?? null,
                        patient?.lastName ?? null,
                        patient?.taxCode ?? null,
                        patient?.ambulatoryId ?? null,
                        patient?.createdAt ?? null,
                        patient?.updatedAt ?? null,
                    );
                for (const link of derivePatientAmbulatoryLinks(artifact.payload.patients)) {
                    targetDb.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id, assigned_at) VALUES (?, ?, ?)')
                        .run(link.patientId, link.ambulatoryId, Math.floor(link.assignedAt.getTime() / 1000));
                }
            })();

            const restored = targetDb.prepare('SELECT ambulatory_id, assigned_at FROM patients_to_ambulatories WHERE patient_id = ? ORDER BY ambulatory_id').all('roundtrip-patient') as Array<{ ambulatory_id: string; assigned_at: number }>;
            assert.deepEqual(restored, [
                { ambulatory_id: primaryAmbulatoryId, assigned_at: 1_700_000_100 },
                { ambulatory_id: 'roundtrip-amb-secondary', assigned_at: 1_700_000_200 },
            ].sort((left, right) => left.ambulatory_id.localeCompare(right.ambulatory_id)));
        } finally {
            targetDb.close();
        }
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
});
