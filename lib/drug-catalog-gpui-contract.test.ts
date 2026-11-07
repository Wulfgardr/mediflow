/* Il corpo multipart che GPUI invia passa per la route reale: parser FormData, sessione dell'archivio e SQLite veri. */
import { syntheticExemptionRequest, syntheticExemptionSession } from '../scripts/fixtures/exemption-import-session';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FIXTURES = path.join(ROOT_DIR, 'experiments/gpui-patient-pilot/transport/tests/fixtures/drug-catalog');
const CONTENT_TYPE = 'multipart/form-data; boundary=mediflow-fixture';

const dataDir = fs.mkdtempSync(path.join(process.env.MEDIFLOW_DATA_DIR ?? os.tmpdir(), 'mediflow-drug-catalog-gpui-'));
const sqlite = new Database(path.join(dataDir, 'medical.db'));
for (const fileName of fs.readdirSync(path.join(ROOT_DIR, 'drizzle')).filter((file) => file.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(ROOT_DIR, 'drizzle', fileName), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gm, ''));
}
sqlite.close();
process.env.MEDIFLOW_DATA_DIR = dataDir;

test('the multipart bodies GPUI sends preview and replace the catalog through the real route', async (t) => {
    const load = createRequire(import.meta.url);
    const auth = load('./security/server-auth.ts') as typeof import('./security/server-auth');
    const { POST } = load('../app/api/drugs/catalog-import/route.ts') as typeof import('../app/api/drugs/catalog-import/route');
    const { getAifaCatalogSnapshot } = await import('./aifa-catalog-server.ts');
    const session = syntheticExemptionSession();
    t.mock.method(auth, 'requireSession', async () => session);
    const post = (name: string) => POST(syntheticExemptionRequest('http://localhost/api/drugs/catalog-import', {
        method: 'POST', headers: { 'content-type': CONTENT_TYPE }, body: fs.readFileSync(path.join(FIXTURES, name)) }));

    // GPUI fissa nel suo test lo snapshot del catalogo vuoto: è quello che l'host calcola.
    assert.equal(getAifaCatalogSnapshot(), '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b');
    const preview = await post('preview.multipart');
    assert.equal(preview.status, 200);
    const proposed = await preview.json();
    assert.deepEqual(proposed.header, ['code', 'name', 'active_ingredient', 'atc']);
    assert.deepEqual(proposed.mapping, { delimiter: ';', columns: { codice: 0, denominazione: 1, principio_attivo: 2, atc: 3 } });
    assert.equal(proposed.counts, null);

    const committed = await post('commit.multipart');
    assert.equal(committed.status, 200, JSON.stringify(await committed.clone().json()));
    const result = await committed.json();
    assert.equal(result.count, 2);
    assert.equal(result.imported.rowCount, 2);
    assert.equal(result.imported.agency, 'Agenzia inventata');
    assert.equal(result.imported.sha256, proposed.sha256);
    assert.notEqual(getAifaCatalogSnapshot(), proposed.current.snapshot);

    // Lo stesso corpo una seconda volta porta uno snapshot superato: nessuna sostituzione silenziosa.
    const stale = await post('commit.multipart');
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, 'DRUG_CATALOG_CHANGED');
});
