import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { openVersionedSqliteDatabase } from './sqlite-schema-open';
import { readSqliteArchiveGeneration } from './archive-generation';
import { createTerritorialPackHostOwner } from './territorial-pack-host';
import { createTerritorialPackHttpHandler } from './territorial-pack-http';
import { readTerritorialPacks } from './territorial-pack-store';
import { TERRITORIAL_PACK_SCHEMA as SCHEMA, TERRITORIAL_PACK_SETTING_KEY as KEY } from './territorial-packs';

// The body GPUI sends is pinned by its own test to this file (app/src/shell/local_host/network.rs).
const GPUI_COMMAND = JSON.parse(readFileSync(new URL(
    '../experiments/gpui-patient-pilot/transport/tests/fixtures/territorial-packs-command.json', import.meta.url), 'utf8'));

const directory = mkdtempSync(path.join(process.env.MEDIFLOW_DATA_DIR!, 'territorial-gpui-'));
const db = openVersionedSqliteDatabase(path.join(directory, 'medical.db'));
const generation = readSqliteArchiveGeneration(db);
// GPUI on the archive computer authenticates through the Web login, so the host sees a Web session.
const owner = createTerritorialPackHostOwner({ database: () => db, currentWebSession: async () => (
    { userId: 'synthetic-user', authChannel: 'web', expiresAt: Date.now() + 600_000, archiveGeneration: generation }) });
const http = createTerritorialPackHttpHandler(owner);
const put = (body: unknown) => http(new Request('http://localhost/api/system/territorial-packs', { method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-mediflow-archive-generation': generation }, body: JSON.stringify(body) }));
test.after(() => db.close());

test('the host accepts the exact body GPUI sends and refuses it once the revision has moved', async () => {
    db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .run(KEY, JSON.stringify({ schemaVersion: SCHEMA, revision: 3, preset: 'core+it+lom' }));
    assert.deepEqual(readTerritorialPacks(db), { schemaVersion: SCHEMA, revision: 3, preset: 'core+it+lom', status: 'ready' });

    const accepted = await put(GPUI_COMMAND);
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { schemaVersion: SCHEMA, revision: 4, preset: 'core', status: 'ready' });
    const audit = db.prepare("SELECT redacted_metadata FROM audit_events WHERE event_type='territorial.packs.changed'").pluck().all();
    assert.deepEqual(audit, [JSON.stringify({ flags: ['before:core+it+lom', 'after:core'] })]);

    const stale = await put(GPUI_COMMAND);
    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), { code: 'conflict' });
    assert.equal(readTerritorialPacks(db).revision, 4);
});
