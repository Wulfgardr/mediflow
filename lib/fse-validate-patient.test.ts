import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function bootstrapDatabaseFile(dataDir: string): void {
    fs.mkdirSync(dataDir, { recursive: true });
    const sqlite = new Database(path.join(dataDir, 'medical.db'));
    try {
        const migrationsDir = path.join(ROOT_DIR, 'drizzle');
        const migrationFiles = fs
            .readdirSync(migrationsDir)
            .filter((file) => file.endsWith('.sql'))
            .sort((left, right) => left.localeCompare(right));
        for (const fileName of migrationFiles) {
            const sql = fs
                .readFileSync(path.join(migrationsDir, fileName), 'utf8')
                .replace(/^-->\s+statement-breakpoint\s*$/gm, '');
            if (sql.trim().length > 0) sqlite.exec(sql);
        }
    } finally {
        sqlite.close();
    }
}

test('validatePatientExport ignores soft-deleted therapies and observations', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-fse-validate-'));
    bootstrapDatabaseFile(dataDir);
    process.env.MEDIFLOW_DATA_DIR = dataDir;

    const [{ dbServer }, schema, { validatePatientExport }] = await Promise.all([
        import('./db-server.ts'),
        import('./schema.ts'),
        import('./fse-validate-patient.ts'),
    ]);

    const patientId = 'patient-fse-soft-delete';
    const deletedAt = new Date('2026-07-08T09:00:00.000Z');
    dbServer.insert(schema.patients).values({
        id: patientId,
        firstName: 'Giulia',
        lastName: 'Bianchi',
        taxCode: 'BNCGLI80A41F205X',
        version: 1,
    }).run();
    dbServer.insert(schema.therapies).values({
        id: 'therapy-deleted-invalid',
        patientId,
        drugName: '',
        dosage: 'n/a',
        status: 'active',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        atc: 'BAD',
        deletedAt,
        deletionReason: 'test',
    }).run();
    dbServer.insert(schema.observations).values({
        id: 'observation-deleted-invalid',
        patientId,
        codeSystem: 'SNOMED-CT',
        code: 'invalid',
        display: 'Invalid',
        unitSystem: 'BAD',
        unitCode: 'bad',
        value: 'not numeric',
        observedAt: new Date('2026-01-02T00:00:00.000Z'),
        deletedAt,
        deletionReason: 'test',
    }).run();

    const result = await validatePatientExport(patientId);

    assert.ok(result);
    assert.equal(result.hasErrors, false);
    assert.equal(result.hasWarnings, false);
    assert.equal(result.therapyMedication.total, 0);
    assert.equal(result.observationVitals.total, 0);
});
