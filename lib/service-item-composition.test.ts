import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'mediflow-service-item-composition-'));
process.env.MEDIFLOW_DATA_DIR = directory;
process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const { dbServer, openDbServer } = await import('./db-server.ts');
openDbServer();
const fixture = await import('./test-fixtures/clinical-writer-composition.ts');
const writers = await import('./service-prescription-write.ts');
fixture.seedComposition();
test.after(() => { dbServer.$client.close(); rmSync(directory, { recursive: true, force: true }); });
const context = { request: new Request('http://127.0.0.1/synthetic-service-items'), session: fixture.session };
type Tx = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];
const before = () => ['service_prescriptions', 'service_prescription_items', 'audit_events'].map(table => dbServer.$client.prepare(`SELECT * FROM ${table}`).all());
function compose(tx: Tx, prefix: string) {
    const parent = writers.createHostServicePrescriptionInTransaction(tx, context, { id: prefix, patientId: fixture.patientId,
        prescribedAt: '2026-11-17', serviceName: 'ENC:synthetic:service' });
    assert.equal(parent.status, 201);
    const body = { id: prefix + '-item', prescriptionId: prefix, ordinal: 1, serviceName: 'ENC:synthetic:item' };
    const sync = Reflect.get(writers, 'createHostServicePrescriptionItemInTransaction');
    const result = typeof sync === 'function' ? sync(tx, context, body) : writers.createHostServicePrescriptionItem(context, body);
    if (result instanceof Promise) { void result.catch(() => undefined); throw new Error('SYNCHRONOUS_ITEM_CORE_REQUIRED'); }
    assert.equal(result.status, 201);
}
test('a prescription and its item can commit through synchronous cores in one caller transaction', () => {
    const count = before().map(rows => rows.length);
    dbServer.transaction(tx => compose(tx, 'synthetic-item-success'), { behavior: 'immediate' });
    assert.deepEqual(before().map((rows, index) => rows.length - count[index]), [1, 1, 2]);
});
test('an error after the item leaves neither prescription, item nor audit', () => {
    const snapshot = before();
    assert.throws(() => dbServer.transaction(tx => { compose(tx, 'synthetic-item-failure'); throw new Error('SYNTHETIC_COMMIT_FAILURE'); },
        { behavior: 'immediate' }), /SYNTHETIC_COMMIT_FAILURE/);
    assert.deepEqual(before(), snapshot);
});
test('failure of the item audit rolls back its parent and every success audit', () => {
    const snapshot = before();
    dbServer.$client.exec("CREATE TRIGGER synthetic_item_audit_failure BEFORE INSERT ON audit_events WHEN NEW.event_type='service.prescription_item.created' BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_ITEM_AUDIT_FAILURE'); END");
    try { assert.throws(() => dbServer.transaction(tx => compose(tx, 'synthetic-item-audit'), { behavior: 'immediate' }), /SYNTHETIC_ITEM_AUDIT_FAILURE/); }
    finally { dbServer.$client.exec('DROP TRIGGER synthetic_item_audit_failure'); }
    assert.deepEqual(before(), snapshot);
});
