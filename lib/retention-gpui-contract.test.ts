/* I corpi JSON che GPUI invia passano per la route reale della conservazione: sessione, SQLite e politica veri. */
import { syntheticExemptionRequest, syntheticExemptionSession } from '../scripts/fixtures/exemption-import-session';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FIXTURES = path.join(ROOT_DIR, 'experiments/gpui-patient-pilot/transport/tests/fixtures/retention');
const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')) as Record<string, unknown>;
const CLOSED_AT = Date.UTC(2012, 2, 1) / 1000;

const dataDir = fs.mkdtempSync(path.join(process.env.MEDIFLOW_DATA_DIR ?? os.tmpdir(), 'mediflow-retention-gpui-'));
const sqlite = new Database(path.join(dataDir, 'medical.db'));
for (const fileName of fs.readdirSync(path.join(ROOT_DIR, 'drizzle')).filter((file) => file.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(ROOT_DIR, 'drizzle', fileName), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gm, ''));
}
sqlite.close();
process.env.MEDIFLOW_DATA_DIR = dataDir;

test('GPUI windows, hold, release and discard bodies are accepted by the real retention route in order', async (t) => {
    const load = createRequire(import.meta.url);
    const auth = load('./security/server-auth.ts') as typeof import('./security/server-auth');
    const route = load('../app/api/system/retention/route.ts') as typeof import('../app/api/system/retention/route');
    const { dbServer } = await import('./db-server.ts');
    const session = syntheticExemptionSession();
    t.mock.method(auth, 'requireSession', async () => session);
    const raw = dbServer.$client;
    raw.prepare(`INSERT INTO patients (id, first_name, last_name, tax_code, is_archived, version, created_at, updated_at)
        VALUES ('retention-expired', 'ENC:synthetic', 'ENC:synthetic', 'ENC:synthetic', 1, 1, ?, ?)`).run(CLOSED_AT - 1000, CLOSED_AT);
    raw.prepare(`INSERT INTO entries (id, patient_id, type, date, content, created_at, updated_at)
        VALUES ('retention-expired-entry', 'retention-expired', 'visit', ?, 'ENC:synthetic', ?, ?)`).run(CLOSED_AT - 2000, CLOSED_AT - 2000, CLOSED_AT - 2000);
    const read = async () => (await route.GET()).json();
    const send = (method: 'PUT' | 'POST', body: unknown) => route[method](syntheticExemptionRequest('http://localhost/api/system/retention',
        { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

    const initial = await read();
    assert.equal(initial.status, 'ready');
    assert.equal(initial.windowsRevision, 0);
    assert.equal(initial.holdsRevision, 0);
    assert.ok(initial.profile.terms.ambulatory_record, 'the overview carries the profile GPUI renders');
    assert.deepEqual(initial.categories.map((c: { id: string }) => c.id), Object.keys(initial.profile.terms));

    assert.equal((await send('PUT', fixture('windows'))).status, 200);
    const expired = await read();
    const item = expired.review.find((entry: { patientId: string }) => entry.patientId === 'retention-expired');
    assert.equal(item?.status, 'expired');
    // GPUI fissa versione e scadenza viste nella revisione: sono quelle che l'host calcola.
    assert.equal(item.version, fixture('discard').expectedVersion);
    assert.equal(item.expiresAt, fixture('discard').expectedExpiresAt);

    assert.equal((await send('POST', fixture('hold-place'))).status, 200);
    const held = await read();
    assert.equal(held.holds.length, 1);
    const refused = await send('POST', fixture('discard'));
    assert.equal(refused.status, 409);
    assert.deepEqual(await refused.json(), { code: 'legal_hold' });

    // L'id del blocco lo assegna l'host: è l'unico campo che il test sostituisce nel corpo di GPUI.
    const release = { ...fixture('hold-release'), holdId: held.holds[0].id };
    assert.equal((await send('POST', release)).status, 200);
    assert.equal((await send('POST', fixture('discard'))).status, 200);
    assert.equal(raw.prepare("SELECT count(*) FROM patients WHERE id = 'retention-expired'").pluck().get(), 0);
    const again = await send('POST', fixture('discard'));
    assert.equal(again.status, 404);
});
