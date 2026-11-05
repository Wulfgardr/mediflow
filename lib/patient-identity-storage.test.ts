import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSqliteArchiveGeneration } from './archive-generation';
import { eq } from 'drizzle-orm';
import { openVersionedSqliteDatabase, CURRENT_SQLITE_SCHEMA_VERSION } from './sqlite-schema-open';
import { normalizePatientCreateInput, normalizePatientUpdateInput } from './patient-write-normalization';
import { ambulatories, patients, patientsToAmbulatories } from './schema';
import { PATIENT_PROFILE_UPDATE_OPERATION } from './patient-profile-update-contract';

const dir = mkdtempSync(join(tmpdir(), 'mfid-'));
process.env.MEDIFLOW_DATA_DIR = dir;
const load = createRequire(import.meta.url);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server');
openDbServer();
const { updatePatientOperation } = load('./patient-update-operation.ts') as typeof import('./patient-update-operation');
const { listNetworkScopedPatients } = load('./network-patient-read.ts') as typeof import('./network-patient-read');
const audit = { actorType: 'user', actorRef: 'synthetic-actor', sourceSurface: 'web', flags: [], archiveGeneration: readSqliteArchiveGeneration(dbServer.$client) } as const;
test.after(() => { dbServer.$client.close(); rmSync(dir, { recursive: true, force: true }); });

test('d: migra CF STP ENI senza cambiare i valori, con versione nuova', () => {
    const file = join(dir, 'legacy.db');
    const legacy = openVersionedSqliteDatabase(file);
    for (const column of ['identifier_type', 'birth_date_precision', 'birth_year', 'identifier_history']) {
        if ((legacy.pragma('table_info(patients)') as { name: string }[]).some(row => row.name === column)) legacy.exec(`ALTER TABLE patients DROP COLUMN ${column}`);
    }
    const values = ['RSSMRA80A01H501U', 'STP0300010000123', 'ENI0300010000123'];
    values.forEach((code, index) => legacy.prepare('INSERT INTO patients(id,first_name,last_name,tax_code,birth_date) VALUES (?, ?, ?, ?, ?)').run(String(index), 'Ada', 'Sintetica', code, index === 0 ? 315532800 : null));
    legacy.pragma('user_version = 7'); legacy.close();
    const migrated = openVersionedSqliteDatabase(file);
    try {
        assert.ok(CURRENT_SQLITE_SCHEMA_VERSION > 7);
        assert.deepEqual(migrated.prepare('SELECT tax_code, identifier_type, birth_date_precision FROM patients ORDER BY id').all(), values.map((tax_code, i) => ({ tax_code, identifier_type: ['cf', 'stp', 'eni'][i], birth_date_precision: i === 0 ? 'exact' : 'unknown' })));
        assert.equal(migrated.pragma('user_version', { simple: true }), CURRENT_SQLITE_SCHEMA_VERSION);
    } finally { migrated.close(); }
    const reopened = openVersionedSqliteDatabase(file); reopened.close();
});
test('a storage: none con anno stimato si salva e si rilegge', () => {
    const normalized = normalizePatientCreateInput({ firstName: 'Ada', lastName: 'Sintetica', identifierType: 'none', taxCode: '', birthDatePrecision: 'estimated', birthYear: 1982 }, { id: 'none' });
    assert.equal(normalized.ok, true); if (!normalized.ok) return;
    dbServer.insert(patients).values(normalized.values).run();
    const row = dbServer.select().from(patients).where(eq(patients.id, 'none')).get()!;
    assert.equal(Reflect.get(row, 'birthYear'), 1982);
    assert.equal(Reflect.get(row, 'identifierType'), 'none');
});
test('e: STP diventa CF con CAS, storia precedente e audit; duplicato respinto', () => {
    dbServer.insert(ambulatories).values({ id: 'clinic', name: 'Sintetico' }).run();
    dbServer.insert(patients).values({ id: 'stp', firstName: 'Ada', lastName: 'Sintetica', taxCode: 'STP0300010000123', ambulatoryId: 'clinic' }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId: 'stp', ambulatoryId: 'clinic' }).run();
    const columns = dbServer.$client.pragma('table_info(patients)') as { name: string }[];
    if (columns.some(c => c.name === 'identifier_type')) dbServer.$client.prepare("UPDATE patients SET identifier_type='stp' WHERE id='stp'").run();
    const normalized = normalizePatientUpdateInput({ identifierType: 'cf', taxCode: 'RSSMRA80A01H501U' }, { expectedVersion: 1 });
    assert.equal(normalized.ok, true); if (!normalized.ok) return;
    const update = () => updatePatientOperation({ operationId: PATIENT_PROFILE_UPDATE_OPERATION.id, contractVersion: 1, patientId: 'stp', expectedVersion: 1, values: normalized.values, setPrimaryAmbulatory: false, audit: { ...audit, flags: [] } });
    assert.equal(update().status, 200);
    const changed = dbServer.select().from(patients).where(eq(patients.id, 'stp')).get()!;
    assert.equal(changed.id, 'stp'); assert.equal(changed.version, 2);
    const history = JSON.parse(Reflect.get(changed, 'identifierHistory') ?? '[]');
    assert.equal(history[0].previous.type, 'stp'); assert.equal(history[0].previous.value, 'STP0300010000123');
    const events = dbServer.$client.prepare("SELECT redacted_metadata FROM audit_events WHERE subject_ref='stp'").all() as { redacted_metadata: string }[];
    assert.ok(events.some(e => JSON.parse(e.redacted_metadata).flags?.includes('identifier-history:2')));
    assert.equal(update().status, 409);
    dbServer.insert(patients).values({ id: 'duplicate', firstName: 'Altra', lastName: 'Sintetica', taxCode: 'RSSMRA80A01H501U', ambulatoryId: 'clinic' }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId: 'duplicate', ambulatoryId: 'clinic' }).run();
    const conflict = updatePatientOperation({ operationId: PATIENT_PROFILE_UPDATE_OPERATION.id, contractVersion: 1, patientId: 'duplicate', expectedVersion: 1, values: normalized.values, setPrimaryAmbulatory: false, audit: { ...audit, flags: [] } });
    assert.equal(conflict.status, 409); assert.equal(conflict.value.code, 'PATIENT_IDENTIFIER_DUPLICATE');
    assert.equal(dbServer.select().from(patients).where(eq(patients.id, 'duplicate')).get()!.version, 1);
});
test('g: client v1 precedente legge ancora taxCode come stringa', async () => {
    if (!dbServer.select().from(ambulatories).where(eq(ambulatories.id, 'api-clinic')).get()) dbServer.insert(ambulatories).values({ id: 'api-clinic', name: 'Sintetico' }).run();
    dbServer.insert(patients).values({ id: 'api', firstName: 'Ada', lastName: 'Sintetica', taxCode: 'RSSMRA80A01H501U', ambulatoryId: 'api-clinic' }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId: 'api', ambulatoryId: 'api-clinic' }).run();
    const payload = JSON.parse(JSON.stringify(await listNetworkScopedPatients('api-clinic')));
    assert.equal(payload[0].taxCode, 'RSSMRA80A01H501U');
    assert.equal(payload[0].identifierType, 'cf');
    const { id, taxCode } = payload[0]; assert.equal(id, 'api'); assert.equal(typeof taxCode, 'string');
});
for (const fault of ['ABORT', 'IGNORE']) test(`e audit ${fault}: identificativo storia e versione restano invariati`, () => {
    const id = `audit-${fault}`;
    const input = normalizePatientCreateInput({ firstName: 'Ada', lastName: 'Sintetica', identifierType: 'stp', taxCode: 'STP0300010000123' }, { id });
    assert.equal(input.ok, true); if (!input.ok) return;
    dbServer.insert(patients).values(input.values).run();
    const before = dbServer.select().from(patients).where(eq(patients.id, id)).get();
    const normalized = normalizePatientUpdateInput({ identifierType: 'cf', taxCode: 'RSSMRA80A01H501U' }, { expectedVersion: 1 });
    assert.equal(normalized.ok, true); if (!normalized.ok) return;
    dbServer.$client.exec(`CREATE TRIGGER identity_audit_fault BEFORE INSERT ON audit_events BEGIN SELECT RAISE(${fault}${fault === 'ABORT' ? ", 'synthetic audit failure'" : ''}); END`);
    try {
        assert.throws(() => updatePatientOperation({ operationId: PATIENT_PROFILE_UPDATE_OPERATION.id, contractVersion: 1, patientId: id, expectedVersion: 1, values: normalized.values, setPrimaryAmbulatory: false, audit: { ...audit, flags: [] } }));
    } finally { dbServer.$client.exec('DROP TRIGGER identity_audit_fault'); }
    assert.deepEqual(dbServer.select().from(patients).where(eq(patients.id, id)).get(), before);
    assert.equal(dbServer.$client.prepare('SELECT count(*) AS n FROM audit_events WHERE subject_ref=?').pluck().get(id), 0);
});
