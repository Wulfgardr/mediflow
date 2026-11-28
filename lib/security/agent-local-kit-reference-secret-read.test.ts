import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { AGENT_OPERATIONS } from '../agent-mandate-contract';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-reference-secret-read-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const actor = 'synthetic-reference-secret-doctor';
const authSeam = join(dataDir, 'auth.cjs');
writeFileSync(authSeam, `
exports.requireSessionOrLocalToken=async()=>({id:'synthetic-web',userId:'${actor}',role:'admin',authChannel:'web'});
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});`, { mode: 0o600 });
const { registerHooks } = load('node:module') as {
    registerHooks: (hooks: { resolve: (specifier: string, context: unknown,
        next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister: () => void };
};
const hooks = registerHooks({ resolve(specifier, context, next) {
    return specifier === '@/lib/security/server-auth' ? { url: pathToFileURL(authSeam).href, shortCircuit: true } : next(specifier, context);
} });
const { dbServer, openDbServer } = load('../db-server.ts') as typeof import('../db-server.ts');
const database = openDbServer();
const { createAgentLocalKitStore, LOCAL_KIT_PATIENT_REFERENCE_KEY_SETTING_KEY } = load('../agent-local-kit-store.ts') as typeof import('../agent-local-kit-store.ts');
const { readSqliteArchiveGeneration } = load('../archive-generation.ts') as typeof import('../archive-generation.ts');
const settingByKey = load('../../app/api/settings/[key]/route.ts') as typeof import('../../app/api/settings/[key]/route.ts');
const settingsCollection = load('../../app/api/settings/route.ts') as Record<string, unknown>;
test.after(() => { hooks.deregister(); dbServer.$client.close(); rmSync(dataDir, { recursive: true, force: true }); });

test('the patient reference secret is never returned by a settings read after the kit is connected', async () => {
    database.prepare('INSERT INTO users(id,username,role,password_hash,encrypted_master_key,salt) VALUES (?,?,?,?,?,?)')
        .run(actor, 'synthetic-reference-secret-account', 'admin', 'unused', 'synthetic-wrapped-master', 'synthetic-salt');
    const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const publicKey = Buffer.from(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))).toString('base64');
    const connection = createAgentLocalKitStore(database).connect({ id: randomUUID(), durationMs: 86400000, operations: [...AGENT_OPERATIONS],
        provider: 'openai', allowsClinicalEgress: true, publicKey, wrappedPrivateKey: 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(64) },
    actor, readSqliteArchiveGeneration(database));
    const secret = connection.patientReferenceKey;
    assert.equal((database.prepare('SELECT value FROM settings WHERE key=?').get(LOCAL_KIT_PATIENT_REFERENCE_KEY_SETTING_KEY) as { value: string }).value, secret);

    const direct = await settingByKey.GET(new Request('http://127.0.0.1/api/settings/' + LOCAL_KIT_PATIENT_REFERENCE_KEY_SETTING_KEY),
        { params: Promise.resolve({ key: LOCAL_KIT_PATIENT_REFERENCE_KEY_SETTING_KEY }) });
    assert.equal(direct.status, 404);
    assert.equal((await direct.text()).includes(secret), false);

    const everyKey = (database.prepare('SELECT key FROM settings').all() as Array<{ key: string }>).map(row => row.key);
    assert.ok(everyKey.includes('agent.localKitAgentRef'));
    for (const key of everyKey) {
        const response = await settingByKey.GET(new Request('http://127.0.0.1/api/settings/' + encodeURIComponent(key)), { params: Promise.resolve({ key }) });
        assert.equal((await response.text()).includes(secret), false, key);
    }
    assert.equal(settingsCollection.GET, undefined);
});
