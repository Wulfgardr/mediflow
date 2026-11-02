import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import { clearAllSessions } from './security/server-session';
import { bindSyntheticArchiveSessions } from './security/web-auth-lifecycle-owner-test-fixture';
/* WUL-800, coorte 1: passaggi di stato di prescrizioni specialistiche e voci su SQLite reale. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import type { ServerSession } from './security/server-session.ts';
import {
    isServicePrescriptionForwardStep,
    isServicePrescriptionTransitionAllowed,
    SERVICE_PRESCRIPTION_TRANSITIONS,
} from './clinical-status-transitions.ts';
import { SERVICE_PRESCRIPTION_STATUSES } from './prescription-domain.ts';

const dir = mkdtempSync(join(process.env.MEDIFLOW_DATA_DIR!, 'service-transitions-'));
process.env.MEDIFLOW_DATA_DIR = dir;
const { dbServer, openDbServer } = await import('./db-server.ts');
openDbServer();
bindSyntheticArchiveSessions('synthetic-session', 'synthetic-native', 'synthetic-local-api');
const { patients, ambulatories, patientsToAmbulatories, servicePrescriptions, servicePrescriptionItems } = await import('./schema.ts');
const cookieState = { cookies: new Map<string, string>() };
const cleanupCookies = installNetworkPatientCookieFixture(dir, cookieState);
const writer = await import('./service-prescription-write.ts');
const sql = new Database(join(dir, 'medical.db'));
let n = 0;
const next = (name: string) => `synthetic-transition-${++n}-${name}`;
const session: ServerSession = {
    id: 'synthetic-session', userId: 'synthetic-user', username: next('username'),
    role: 'admin', authChannel: 'web', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
};
const ambulatoryId = next('ambulatory');
const authority = syntheticNetworkPatientAuthority(dbServer, ambulatoryId, {
    userId: session.userId, clientId: 'synthetic-paired', requestId: 'synthetic-request',
    capabilities: ['network.replica.write-service-prescriptions'],
});
const request = new Request('http://localhost/test', { headers: { ...Object.fromEntries(authority.request.headers), 'x-mediflow-source-surface': 'job' } });
const host = { request, session };
const paired = { request, session: authority.session, pairedClient: authority.pairedClient, scopeAmbulatoryId: ambulatoryId };
cookieState.cookies.set('ambulatory_id', ambulatoryId);
dbServer.insert(ambulatories).values({ id: ambulatoryId, name: 'Synthetic ambulatory', type: 'live' }).run();
test.after(() => {
    clearAllSessions(); cleanupCookies(); sql.close();
    dbServer.$client.close();
});

type Seeded = { patientId: string; prescriptionId: string; itemIds: string[] };

function seed(parentStatus: string, itemStatuses: string[] = [], itemDates: Array<Date | null> = []): Seeded {
    const patientId = next('patient');
    const prescriptionId = next('prescription');
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: next('tax') }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId, ambulatoryId }).run();
    dbServer.insert(servicePrescriptions).values({
        id: prescriptionId, patientId, prescribedAt: new Date('2026-05-01'), serviceName: 'ENC:synthetic:parent',
        status: parentStatus, version: 3,
    }).run();
    const itemIds = itemStatuses.map((status, index) => {
        const id = next('item');
        dbServer.insert(servicePrescriptionItems).values({
            id, patientId, prescriptionId, serviceName: 'ENC:synthetic:item', status, version: 2,
            performedAt: itemDates[index] ?? null,
        }).run();
        return id;
    });
    return { patientId, prescriptionId, itemIds };
}

function parentRow(ids: Seeded) {
    return sql.prepare('SELECT status, version, performed_at FROM service_prescriptions WHERE id=?').get(ids.prescriptionId) as
        { status: string; version: number; performed_at: number | null };
}
function itemRows(ids: Seeded) {
    return ids.itemIds.map((id) => sql.prepare('SELECT id, status, version, performed_at FROM service_prescription_items WHERE id=?').get(id) as
        { id: string; status: string; version: number; performed_at: number | null });
}
function auditCount(ids: Seeded) {
    const refs = [ids.prescriptionId, ...ids.itemIds];
    return (sql.prepare(`SELECT count(*) AS total FROM audit_events WHERE subject_ref IN (${refs.map(() => '?').join(',')})`).get(...refs) as { total: number }).total;
}
function listed(ids: Seeded) {
    return itemRows(ids).map((row) => ({ id: row.id, version: row.version }));
}

/*
 * La decisione (WUL-800) sta in docs/domain/clinical-status-transitions.json,
 * separata dalla costante del prodotto e letta anche dai test Swift: se la
 * tabella cambia senza che cambi la decisione, questo test se ne accorge.
 */
const decision = JSON.parse(readFileSync(new URL('../docs/domain/clinical-status-transitions.json', import.meta.url), 'utf8')) as
    { servicePrescription: Record<string, string[]> };
const DECIDED_TRANSITIONS = new Set(Object.entries(decision.servicePrescription)
    .flatMap(([from, targets]) => targets.map((to) => `${from}>${to}`)));

test('the product table is exactly the decided one', () => {
    const product = new Set(Object.entries(SERVICE_PRESCRIPTION_TRANSITIONS)
        .flatMap(([from, targets]) => targets.map((to) => `${from}>${to}`)));
    assert.deepEqual([...product].sort(), [...DECIDED_TRANSITIONS].sort());
});

test('every pair of states is accepted or refused on the server exactly as decided', async () => {
    for (const from of SERVICE_PRESCRIPTION_STATUSES) {
        for (const to of SERVICE_PRESCRIPTION_STATUSES) {
            const expected = from === to || DECIDED_TRANSITIONS.has(`${from}>${to}`);
            assert.equal(isServicePrescriptionTransitionAllowed(from, to), expected, `${from} -> ${to}`);

            const parent = seed(from);
            const parentResult = await writer.updateHostServicePrescription({ ...host, id: parent.prescriptionId }, { version: 3, status: to });
            assert.equal(parentResult.status, expected ? 200 : 409, `prescrizione ${from} -> ${to}`);
            assert.equal(parentRow(parent).status, expected ? to : from);

            const item = seed('prescribed', [from]);
            const itemResult = await writer.updateNetworkScopedServicePrescriptionItem({ ...paired, itemId: item.itemIds[0] }, { version: 2, status: to });
            assert.equal(itemResult.status, expected ? 200 : 409, `voce ${from} -> ${to}`);
            assert.equal(itemRows(item)[0].status, expected ? to : from);
        }
    }
});

test('a refused transition says why and writes nothing, not even audit', async () => {
    const ids = seed('performed', ['performed']);
    const before = { parent: parentRow(ids), items: itemRows(ids), audit: auditCount(ids) };
    const result = await writer.updateNetworkScopedServicePrescription({ ...paired, prescriptionId: ids.prescriptionId },
        { version: 3, status: 'cancelled', items: listed(ids) });
    assert.equal(result.status, 409);
    assert.deepEqual(result.value, {
        error: 'Status transition not allowed', code: 'status_transition_not_allowed',
        entity: 'service_prescription', from: 'performed', to: 'cancelled',
    });
    assert.deepEqual({ parent: parentRow(ids), items: itemRows(ids), audit: auditCount(ids) }, before);
});

test('a legacy row with an unknown status can be brought back to a valid one', async () => {
    const ids = seed('prescribed');
    sql.prepare("UPDATE service_prescriptions SET status='in_corso' WHERE id=?").run(ids.prescriptionId);
    const result = await writer.updateHostServicePrescription({ ...host, id: ids.prescriptionId }, { version: 3, status: 'booked' });
    assert.equal(result.status, 200);
    assert.equal(parentRow(ids).status, 'booked');
});

test('the prescription and the items in its state change together; an item moved on its own stays put', async () => {
    const ownDate = new Date('2026-06-02T08:00:00.000Z');
    const ids = seed('booked', ['booked', 'booked', 'cancelled'], [null, ownDate, null]);
    const performedAt = '2026-06-10T09:30:00.000Z';
    const result = await writer.updateHostServicePrescription({ ...host, id: ids.prescriptionId },
        { version: 3, status: 'performed', performedAt, items: listed(ids) });
    assert.equal(result.status, 200);
    assert.equal(parentRow(ids).status, 'performed');
    const [first, second, cancelled] = itemRows(ids);
    assert.deepEqual([first.status, first.version, first.performed_at], ['performed', 3, Date.parse(performedAt) / 1000]);
    assert.deepEqual([second.status, second.version, second.performed_at], ['performed', 3, ownDate.getTime() / 1000]);
    assert.deepEqual([cancelled.status, cancelled.version], ['cancelled', 2]);
    assert.equal(auditCount(ids), 3);
});

test('a stale or incomplete list of items makes the whole change a conflict', async () => {
    const stale = seed('prescribed', ['prescribed', 'prescribed']);
    const staleList = listed(stale).map((item, index) => index === 1 ? { ...item, version: 1 } : item);
    const staleResult = await writer.updateHostServicePrescription({ ...host, id: stale.prescriptionId },
        { version: 3, status: 'booked', items: staleList });
    assert.equal(staleResult.status, 409);
    assert.equal(staleResult.value.code, 'VERSION_CONFLICT');

    const incomplete = seed('prescribed', ['prescribed', 'prescribed']);
    const incompleteResult = await writer.updateNetworkScopedServicePrescription({ ...paired, prescriptionId: incomplete.prescriptionId },
        { version: 3, status: 'booked', items: listed(incomplete).slice(0, 1) });
    assert.equal(incompleteResult.status, 409);
    assert.equal(incompleteResult.value.code, 'service_prescription_items_changed');

    for (const ids of [stale, incomplete]) {
        assert.equal(parentRow(ids).status, 'prescribed');
        assert.deepEqual(itemRows(ids).map((row) => [row.status, row.version]), [['prescribed', 2], ['prescribed', 2]]);
        assert.equal(auditCount(ids), 0);
    }
});

test('a failure on the second item rolls back the prescription and the first item', async () => {
    const ids = seed('prescribed', ['prescribed', 'prescribed']);
    const before = { parent: parentRow(ids), items: itemRows(ids), audit: auditCount(ids) };
    sql.exec(`CREATE TRIGGER synthetic_second_item_fault BEFORE UPDATE ON service_prescription_items
        WHEN OLD.id = '${ids.itemIds[1]}' BEGIN SELECT RAISE(FAIL, 'synthetic item failure'); END`);
    try {
        await assert.rejects(writer.updateHostServicePrescription({ ...host, id: ids.prescriptionId },
            { version: 3, status: 'booked', scheduledAt: '2026-06-01T10:00:00.000Z', items: listed(ids) }));
    } finally {
        sql.exec('DROP TRIGGER synthetic_second_item_fault');
    }
    assert.deepEqual({ parent: parentRow(ids), items: itemRows(ids), audit: auditCount(ids) }, before);
});

test('the items list must name each current item once; a stale item blocks even if it would not move', async () => {
    const duplicated = seed('prescribed', ['prescribed', 'prescribed']);
    const [first] = listed(duplicated);
    const duplicatedResult = await writer.updateHostServicePrescription({ ...host, id: duplicated.prescriptionId },
        { version: 3, status: 'booked', items: [first, first] });
    assert.equal(duplicatedResult.status, 409);
    assert.equal(duplicatedResult.value.code, 'service_prescription_items_changed');

    const stale = seed('prescribed', ['prescribed', 'cancelled']);
    const staleList = listed(stale).map((item, index) => index === 1 ? { ...item, version: 1 } : item);
    const staleResult = await writer.updateHostServicePrescription({ ...host, id: stale.prescriptionId },
        { version: 3, status: 'booked', items: staleList });
    assert.equal(staleResult.status, 409);
    assert.equal(staleResult.value.code, 'VERSION_CONFLICT');

    for (const ids of [duplicated, stale]) {
        assert.equal(parentRow(ids).status, 'prescribed');
        assert.equal(auditCount(ids), 0);
    }

    const empty = seed('prescribed');
    const emptyResult = await writer.updateHostServicePrescription({ ...host, id: empty.prescriptionId },
        { version: 3, status: 'booked', items: [] });
    assert.equal(emptyResult.status, 200);
    assert.equal(parentRow(empty).status, 'booked');
});

test('a refused audit during the cascade rolls back everything', async () => {
    const ids = seed('booked', ['booked', 'booked']);
    const before = { parent: parentRow(ids), items: itemRows(ids), audit: auditCount(ids) };
    sql.exec(`CREATE TRIGGER synthetic_cascade_audit_fault BEFORE INSERT ON audit_events
        WHEN NEW.subject_ref = '${ids.itemIds[1]}' BEGIN SELECT RAISE(FAIL, 'synthetic audit failure'); END`);
    try {
        await assert.rejects(writer.updateNetworkScopedServicePrescription({ ...paired, prescriptionId: ids.prescriptionId },
            { version: 3, status: 'performed', items: listed(ids) }));
    } finally {
        sql.exec('DROP TRIGGER synthetic_cascade_audit_fault');
    }
    assert.deepEqual({ parent: parentRow(ids), items: itemRows(ids), audit: auditCount(ids) }, before);
});

test('a cascade needs a status to cascade', async () => {
    const ids = seed('prescribed', ['prescribed']);
    const result = await writer.updateHostServicePrescription({ ...host, id: ids.prescriptionId }, { version: 3, items: listed(ids) });
    assert.equal(result.status, 400);
    assert.equal(parentRow(ids).version, 3);
});

test('the actions offered by the Web are forward steps inside the table', () => {
    const offered = (from: string) => ({
        book: isServicePrescriptionForwardStep(from, 'booked'),
        perform: isServicePrescriptionForwardStep(from, 'performed'),
        report: isServicePrescriptionForwardStep(from, 'report_received'),
    });
    assert.deepEqual(offered('prescribed'), { book: true, perform: true, report: true });
    assert.deepEqual(offered('booked'), { book: false, perform: true, report: true });
    assert.deepEqual(offered('performed'), { book: false, perform: false, report: true });
    assert.deepEqual(offered('report_received'), { book: false, perform: false, report: false });
    assert.deepEqual(offered('cancelled'), { book: false, perform: false, report: false });
});
