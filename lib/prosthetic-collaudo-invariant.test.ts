import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import { clearAllSessions } from './security/server-session';
import { bindSyntheticArchiveSessions } from './security/web-auth-lifecycle-owner-test-fixture';
/* Rischio #6 (censimento macchine a stati, 11/11): creazione e aggiornamento che aggirano l'invariante collaudo/stato. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import type { ServerSession } from './security/server-session.ts';
import { PROSTHETIC_TRANSITIONS, isProstheticTransitionAllowed } from './clinical-status-transitions.ts';
import { PROSTHETIC_PRESCRIPTION_STATUSES } from './prescription-domain.ts';

const dir = mkdtempSync(join(process.env.MEDIFLOW_DATA_DIR!, 'prosthetic-bypass-'));
process.env.MEDIFLOW_DATA_DIR = dir;
const { dbServer, openDbServer } = await import('./db-server.ts');
openDbServer();
const { commitTerritorialPackTransition } = await import('./territorial-pack-store.ts');
commitTerritorialPackTransition(openDbServer(), { schemaVersion: 'mediflow.territorial-packs.v1', expectedRevision: 0, preset: 'core+it+lom', confirmed: true },
    { actorType: 'system', actorRef: 'synthetic-supervisor', sourceSurface: 'job' }, () => {});
bindSyntheticArchiveSessions('synthetic-session', 'synthetic-native', 'synthetic-local-api');
const { patients, ambulatories, patientsToAmbulatories, prostheticPrescriptions } = await import('./schema.ts');
const cookieState = { cookies: new Map<string, string>() };
const cleanupCookies = installNetworkPatientCookieFixture(dir, cookieState);
const writer = await import('./prosthetic-prescription-write.ts');
const sql = new Database(join(dir, 'medical.db'));

const decision = JSON.parse(readFileSync(new URL('../docs/domain/clinical-status-transitions.json', import.meta.url), 'utf8')) as
    { prostheticPrescription: Record<string, string[]> };
let n = 0;
const next = (name: string) => `synthetic-prosthetic-bypass-${++n}-${name}`;
const session: ServerSession = { id: 'synthetic-session', userId: 'synthetic-user', username: next('operator'), role: 'admin',
    authChannel: 'web', createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
const ambulatoryId = next('ambulatory');
const authority = syntheticNetworkPatientAuthority(dbServer, ambulatoryId, {
    userId: session.userId, clientId: 'synthetic-paired', requestId: 'synthetic-request',
    capabilities: ['network.replica.write-prosthetic-prescriptions'],
});
const request = new Request('http://localhost/test', { headers: Object.fromEntries(authority.request.headers) });
cookieState.cookies.set('ambulatory_id', ambulatoryId);
dbServer.insert(ambulatories).values({ id: ambulatoryId, name: 'Synthetic ambulatory', type: 'live' }).run();
test.after(() => { clearAllSessions(); cleanupCookies(); sql.close(); dbServer.$client.close(); });

const savedCollaudo = new Date('2026-05-20T00:00:00.000Z');
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

function seed(status: string, collaudoAt: Date | null = null, collaudoOutcome: string | null = null): string {
    const patientId = next('patient'); const id = next('prescription');
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: next('tax') }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId, ambulatoryId }).run();
    dbServer.insert(prostheticPrescriptions).values({ id, patientId, prescribedAt: new Date('2026-05-01'), description: 'ENC:synthetic:aid',
        status, collaudoAt, collaudoOutcome, version: 2 }).run();
    return id;
}
function row(id: string) {
    return sql.prepare('SELECT status, version, collaudo_at AS collaudoAt, collaudo_outcome AS collaudoOutcome FROM prosthetic_prescriptions WHERE id=?').get(id) as
        { status: string; version: number; collaudoAt: number | null; collaudoOutcome: string | null };
}
function update(id: string, body: Record<string, unknown>) {
    return writer.updateHostProstheticPrescription({ request, session, id }, { version: 2, ...body });
}
const { countClinicalStatusIncoherence } = await import('./clinical-status-incoherence.ts');

// L'invariante che il contatore WUL-800 sorveglia: solo una protesica in stato
// «tested» ha la data di collaudo. Una scrittura del prodotto non deve poterla
// violare: o rifiuta, o non salva la data.
test('una protesica creata come bozza con data di collaudo non viola l\'invariante collaudo/stato', async () => {
    const patientId = next('patient');
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: next('tax') }).run();
    const created = await writer.createHostProstheticPrescription({ request, session },
        { patientId, prescribedAt: '2026-05-01', description: 'ENC:synthetic:aid', status: 'draft', collaudoAt: '2026-10-01' });
    if (created.status === 201) {
        const stored = row((created.value as { id: string }).id);
        assert.equal(stored.status, 'draft');
        assert.equal(stored.collaudoAt, null, 'una bozza non collaudata non ha data di collaudo');
    } else assert.ok(created.status >= 400 && created.status < 500, `rifiuto atteso 4xx, ricevuto ${created.status}`);
    assert.equal(countClinicalStatusIncoherence(sql).prostheticCollaudoOnUntestedStatus, 0);
});

test('un aggiornamento prescribed -> delivered con data di collaudo non viola l\'invariante collaudo/stato', async () => {
    const id = seed('prescribed');
    const result = await update(id, { status: 'delivered', collaudoAt: '2026-10-01' });
    if (result.status === 200) {
        assert.equal(row(id).status, 'delivered');
        assert.equal(row(id).collaudoAt, null, 'una protesica consegnata ma non collaudata non ha data di collaudo');
    } else assert.equal(result.status, 409);
    assert.equal(countClinicalStatusIncoherence(sql).prostheticCollaudoOnUntestedStatus, 0);
});
