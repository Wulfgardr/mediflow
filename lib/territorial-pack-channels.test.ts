import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseMiniRequest } from '../packages/mini/src/protocol.ts';
import { resolveApplicationOperation } from './headless/application-operation-registry.ts';
import { createAipOperationRpcHostV1 } from '../packages/aip/src/operation-rpc.ts';
import { spawn, spawnSync } from 'node:child_process';
import { openVersionedSqliteDatabase } from './sqlite-schema-open';
import { readSqliteArchiveGeneration } from './archive-generation';
import { createTerritorialPackHostOwner, type TerritorialPackWebSession } from './territorial-pack-host';
import { createTerritorialPackHttpHandler } from './territorial-pack-http';
import { readTerritorialPacks } from './territorial-pack-store';
import { TERRITORIAL_PACK_SCHEMA as SCHEMA, TERRITORIAL_PACK_SETTING_KEY as KEY, TERRITORIAL_PACK_INITIALIZATION_KEY as INIT } from './territorial-packs';
import { evaluateSettingsWrite } from './security/settings-write-policy';
import { bindSyntheticArchiveSessions } from './security/web-auth-lifecycle-owner-test-fixture';
import type { ServerSession } from './security/server-session';

const directory = mkdtempSync(path.join(process.env.MEDIFLOW_DATA_DIR!, 'territorial-channels-'));
process.env.MEDIFLOW_DATA_DIR = directory;
const file = path.join(directory, 'medical.db');
const db = openVersionedSqliteDatabase(file);
const generation = readSqliteArchiveGeneration(db);
const web = { userId: 'synthetic-user', authChannel: 'web', expiresAt: Date.now() + 600_000, archiveGeneration: generation };
let current: TerritorialPackWebSession | null = web;
const owner = createTerritorialPackHostOwner({ database: () => db, currentWebSession: async () => current });
const http = createTerritorialPackHttpHandler(owner);
const command = (preset = 'core+it+lom', expectedRevision = 0) => ({ schemaVersion: SCHEMA, expectedRevision, preset, confirmed: true });
function request(body: unknown, header = generation) {
    return new Request('http://localhost/api/system/territorial-packs', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-mediflow-archive-generation': header }, body: JSON.stringify(body) });
}
const { dbServer, openDbServer } = await import('./db-server.ts');
openDbServer(); bindSyntheticArchiveSessions('synthetic-territorial-web', 'synthetic-territorial-native');
const writer = await import('./prosthetic-prescription-write.ts');
const session = { id: 'synthetic-territorial-web', userId: web.userId, username: ['synthetic', 'territorial'].join('-'), role: 'admin', authChannel: 'web', createdAt: Date.now(), expiresAt: web.expiresAt } as ServerSession;
db.prepare("INSERT INTO patients (id,first_name,last_name,tax_code) VALUES ('synthetic-patient','Synthetic','Patient','SYNTHETIC')").run();
let external = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { external++; throw new Error('Unexpected external call'); };
test.after(() => { globalThis.fetch = originalFetch; db.close(); dbServer.$client.close(); });
let serial = 0;
async function write(cached?: unknown) {
    return writer.createHostProstheticPrescription({ request: new Request('http://localhost/writer', { headers: cached ? { 'x-mediflow-territorial-packs': JSON.stringify(cached) } : {} }), session },
        { id: `synthetic-territorial-${serial++}`, patientId: 'synthetic-patient', prescribedAt: '2026-10-21', description: 'ENC:synthetic' });
}
async function assertDisabled(before: unknown) {
    assert.deepEqual(readTerritorialPacks(db), before);
    assert.equal((await write()).status, 403);
    assert.equal(db.prepare('SELECT count(*) FROM prosthetic_prescriptions').pluck().get(), 0);
    assert.equal(external, 0);
}

test('core denies the real territorial writer; trusted Web requires a live session, archive and explicit confirmation', async () => {
    const before = readTerritorialPacks(db);
    await assertDisabled(before);
    for (const absent of [null, { ...web, authChannel: 'native' }, { ...web, authChannel: 'system' }, { ...web, expiresAt: 0 }]) {
        current = absent; assert.equal((await http(request(command()))).status, 403); await assertDisabled(before);
    }
    current = web;
    assert.equal((await http(request({ ...command(), confirmed: false }))).status, 400);
    assert.equal((await http(request(command(), 'stale-archive'))).status, 409);
    await assertDisabled(before);
});

test('all five protesica mutation entrypoints deny core, including paired operations', async () => {
    const request = new Request('http://localhost/writer');
    const native = { ...session, id: 'synthetic-territorial-native', authChannel: 'native' as const };
    const paired = { request, session: native, pairedClient: { clientId: 'synthetic-paired' }, scopeAmbulatoryId: 'synthetic-scope' } as Parameters<typeof writer.createNetworkScopedProstheticPrescription>[0];
    const host = { request, session, id: 'synthetic-prescription' };
    const body = { patientId: 'synthetic-patient', prescribedAt: '2026-10-21', description: 'ENC:synthetic' };
    const results = [
        await writer.createHostProstheticPrescription(host, body),
        await writer.updateHostProstheticPrescription(host, { version: 1, description: 'ENC:synthetic' }),
        await writer.deleteHostProstheticPrescription(host, 1),
        await writer.createNetworkScopedProstheticPrescription({ ...paired, patientId: 'synthetic-patient' }, body),
        await writer.updateNetworkScopedProstheticPrescription({ ...paired, prescriptionId: 'synthetic-prescription' }, { version: 1, description: 'ENC:synthetic' }),
    ];
    assert.deepEqual(results.map(result => result.status), [403, 403, 403, 403, 403]);
    await assertDisabled(readTerritorialPacks(db));
});

for (const channel of ['generic-settings', 'paired-client', 'client-declaration', 'cache', 'plugin', 'mcp', 'headless']) {
    test(`${channel} cannot reactivate: capability unchanged, real writer denied, zero egress`, async () => {
        const before = readTerritorialPacks(db);
        if (channel === 'generic-settings') {
            for (const key of [KEY, INIT]) for (const authChannel of ['web', 'native', 'system'] as const) {
                assert.equal(evaluateSettingsWrite(key, { ...session, authChannel }).allowed, false);
            }
        } else if (channel === 'paired-client') {
            current = { ...web, authChannel: 'native' };
            assert.equal((await http(request(command()))).status, 403);
        } else {
            if (channel === 'plugin') await attemptTerritorialMcpCall('mediflow.territorial-packs.transition.v1', command());
            if (channel === 'mcp') await attemptTerritorialMcpCall('mediflow.system.capabilities.v1', { ...command(), channel: 'supervisor' });
            if (channel === 'headless') {
                assert.throws(() => parseMiniRequest(new TextEncoder().encode(JSON.stringify({ command: 'territorial-packs', args: command() }))));
                assert.equal(resolveApplicationOperation('territorial-packs', 'territorial-packs').status, 'denied');
                const frames: string[] = [];
                let receive!: (frame: unknown) => void;
                const rpc = createAipOperationRpcHostV1({ operations: [{ operationId: 'mediflow.system.status.v1', capabilityId: 'mediflow.system.status.v1', serviceRef: 'SyntheticStatusServiceV1', maximumStage: 'read_only', timeoutMs: 100, execute: () => ({ status: 'ready' }) }] });
                rpc.attach({ subscribe: (listener: (frame: unknown) => void) => { receive = listener; return () => {}; }, publish: (frame: string) => { frames.push(frame); } });
                receive(JSON.stringify({ schemaVersion: 'mediflow.aip.operation.request.v1', method: 'call', requestId: 'rpc_territorial', operationId: 'mediflow.territorial-packs.transition.v1', input: command() }));
                assert.equal(JSON.parse(frames[0]).denialCode, 'operation_not_allowed');
            }
            current = web;
            const attempts = [
                { ...command(), channel },
                { ...command(), capability: { schemaVersion: SCHEMA, preset: 'core+it+lom', revision: 99 }, source: channel },
            ];
            for (const input of attempts) assert.equal((await http(request(input))).status, 400);
            current = null;
            assert.equal((await http(request(command()))).status, 403, 'a declaration without a trusted session is not authority');
        }
        current = web;
        await assertDisabled(before);
    });
}

test('both admitted channels transition and audit; cached pre-disable capabilities do not authorize a write', async () => {
    current = web;
    let response = await http(request(command()));
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const cached = await response.json();
    assert.equal(cached.preset, 'core+it+lom');
    assert.equal((await write()).status, 201);
    db.prepare('DELETE FROM prosthetic_prescriptions').run();
    response = await http(request(command('core', 1))); assert.equal(response.status, 200);
    await assertDisabled(readTerritorialPacks(db));
    assert.equal((await write(cached)).status, 403);
    assert.equal((await http(request({ ...command(), cached }))).status, 400);
    await assertDisabled(readTerritorialPacks(db));
    const unconfirmed = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', 'scripts/mediflow-headless-supervisor.mjs',
        '--territorial-packs', 'core+it+lom', '--expected-revision', '2'], {
        cwd: process.cwd(), env: { ...process.env, MEDIFLOW_DATA_DIR: directory }, encoding: 'utf8', timeout: 20_000,
    });
    assert.notEqual(unconfirmed.status, 0);
    await assertDisabled(readTerritorialPacks(db));
    const cli = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', 'scripts/mediflow-headless-supervisor.mjs',
        '--territorial-packs', 'core+it+lom', '--expected-revision', '2', '--confirm'], {
        cwd: process.cwd(), env: { ...process.env, MEDIFLOW_DATA_DIR: directory }, encoding: 'utf8', timeout: 20_000,
    });
    assert.equal(cli.status, 0, cli.stderr + cli.stdout);
    assert.equal(readTerritorialPacks(db).preset, 'core+it+lom');
    assert.equal((await write()).status, 201);
    const audit = db.prepare("SELECT actor_type,source_surface,redacted_metadata FROM audit_events WHERE event_type='territorial.packs.changed' ORDER BY rowid").all() as { actor_type: string; source_surface: string; redacted_metadata: string }[];
    assert.equal(audit.length, 3);
    assert.deepEqual(audit.map(row => row.source_surface), ['web', 'web', 'job']);
    assert.deepEqual(JSON.parse(audit[2].redacted_metadata).flags, ['before:core', 'after:core+it+lom']);
    assert.equal(external, 0);
});

test('route and trusted composition use the tested owner, never a client supplied channel', () => {
    const route = readFileSync('app/api/system/territorial-packs/route.ts', 'utf8');
    const production = readFileSync('lib/territorial-pack-production.ts', 'utf8');
    assert.match(route, /GET = territorialPackHttpHandler/); assert.match(route, /PUT = territorialPackHttpHandler/);
    assert.match(production, /await requireSession\(\)/); assert.match(production, /createTerritorialPackHostOwner/);
});

async function attemptTerritorialMcpCall(name: string, args: unknown): Promise<void> {
    const child = spawn(process.execPath, ['--import', './scripts/register-strip-types-loader.mjs', 'scripts/intelligent-host-mcp-stdio.mjs'],
        { cwd: process.cwd(), env: { PATH: process.env.PATH, NODE_ENV: 'test', MEDIFLOW_DATA_DIR: process.env.MEDIFLOW_DATA_DIR }, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const response = new Promise<Record<string, unknown>>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', code => { reject(new Error(`MCP child exited before response (${code}): ${stderr}`)); });
        child.stdout.on('data', chunk => {
            buffer += chunk;
            for (;;) {
                const end = buffer.indexOf('\n'); if (end < 0) break;
                const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
                try { const frame = JSON.parse(line); if (frame.id === 1) resolve(frame); } catch { reject(new Error('Invalid MCP response')); }
            }
        });
    });
    const timer = setTimeout(() => child.kill(), 10_000);
    try {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
            name, arguments: args, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'synthetic-territorial-test', version: '1' } },
        } }) + '\n');
        const frame = await response;
        assert.ok(frame.error || (frame.result as { isError?: boolean })?.isError === true, 'MCP must deny territorial reactivation');
    } finally { clearTimeout(timer); child.kill(); await new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('close', () => resolve()); }); }
}
