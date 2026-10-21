import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    createProductionMcpAgentLauncherWithPreSpawnedChildV1,
    createProductionMiniAgentLauncherWithPreSpawnedChildV1,
} from './security/authenticated-headless-agent-launcher-production';
import { AIP_OPERATION_RPC_LATE_BIND_ENV_V1 } from '../packages/aip/src/child-ipc-contract.ts';
import { openVersionedSqliteDatabase } from './sqlite-schema-open';
import { readTerritorialPacks, requireTerritorialPack } from './territorial-pack-store';
import { TERRITORIAL_PACK_SCHEMA } from './territorial-packs';

const root = process.cwd();
const directory = mkdtempSync(path.join(process.env.MEDIFLOW_DATA_DIR!, 'production-territorial-channels-'));
const db = openVersionedSqliteDatabase(path.join(directory, 'medical.db'));
const before = readTerritorialPacks(db);
const command = { schemaVersion: TERRITORIAL_PACK_SCHEMA, preset: 'core+it+lom', expectedRevision: 0, confirmed: true };
const operationId = 'mediflow.territorial-packs.transition.v1';
const loader = pathToFileURL(path.join(root, 'scripts/register-strip-types-loader.mjs')).href;
const egressProbe = pathToFileURL(path.join(root, 'scripts/fixtures/territorial-egress-probe.mjs')).href;
process.env.MEDIFLOW_DATA_DIR = directory;
const { dbServer, openDbServer } = await import('./db-server.ts');
const { bindSyntheticArchiveSessions } = await import('./security/web-auth-lifecycle-owner-test-fixture.ts');
openDbServer(); bindSyntheticArchiveSessions('synthetic-production-territorial-web');
const { createHostProstheticPrescription } = await import('./prosthetic-prescription-write.ts');
const originalFetch = globalThis.fetch;
let external = 0;
globalThis.fetch = async () => { external++; throw new Error('Unexpected parent egress'); };
test.after(() => { globalThis.fetch = originalFetch; db.close(); dbServer.$client.close(); });

async function boundChild(kind: 'mini' | 'mcp' | 'aip') {
    const data = mkdtempSync(path.join(directory, `${kind}-`));
    const aipTarget = path.join(data, 'aip.mjs');
    writeFileSync(aipTarget, `
import { createOperationClient } from ${JSON.stringify(pathToFileURL(path.join(root, 'packages/mcp/src/operation-client.ts')).href)};
const client = createOperationClient();
await new Promise(resolve => process.on('message', frame => {
    if (typeof frame === 'string' && JSON.parse(frame).schemaVersion === 'mediflow.aip.bootstrap.result.v1') resolve();
}));
const catalog = await client.publicCatalog();
process.stdout.write(JSON.stringify({catalog})+'\\n');
process.on('message', frame => {
    if (typeof frame !== 'string') return;
    const reply = JSON.parse(frame);
    if (reply.requestId === 'rpc_territorial_probe') process.stdout.write(JSON.stringify(reply)+'\\n');
});
process.stdin.once('data', () => process.send(JSON.stringify({schemaVersion:'mediflow.aip.operation.request.v1',
    method:'call',requestId:'rpc_territorial_probe',operationId:${JSON.stringify(operationId)},input:${JSON.stringify(command)}})));
`);
    const target = kind === 'mini' ? 'packages/mini/src/cli.ts' : kind === 'mcp' ? 'scripts/intelligent-host-mcp-stdio.mjs' : aipTarget;
    const child = spawn(process.execPath, ['--import', loader, '--import', egressProbe, target, ...(kind === 'mini' ? ['--session'] : [])], {
        cwd: root, env: { PATH: process.env.PATH, NODE_ENV: 'test', MEDIFLOW_DATA_DIR: data,
            MEDIFLOW_AIP_OPERATION_RPC: AIP_OPERATION_RPC_LATE_BIND_ENV_V1, MEDIFLOW_TEST_EGRESS_REPORT_DIR: data },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    let buffer = '', stderr = '';
    const queued: unknown[] = [];
    const waiting: Array<(value: unknown) => void> = [];
    child.stderr!.on('data', chunk => { stderr += chunk; });
    child.stdout!.on('data', chunk => {
        buffer += chunk;
        for (;;) {
            const newline = buffer.indexOf('\n'); if (newline < 0) break;
            const reply = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
            const receive = waiting.shift(); if (receive) receive(reply); else queued.push(reply);
        }
    });
    const next = () => new Promise<Record<string, any>>((resolve, reject) => {
        if (queued.length) { resolve(queued.shift() as Record<string, any>); return; }
        const timer = setTimeout(() => reject(new Error(`Child response timed out: ${stderr}`)), 5000);
        waiting.push(value => { clearTimeout(timer); resolve(value as Record<string, any>); });
    });
    const context = { status: 'available', userRef: 'user.synthetic.territorial.0001', parentRef: 'parent.synthetic.territorial.0001',
        purposeCode: 'care_coordination', patientId: 'synthetic-patient', ambulatoryId: 'synthetic-ambulatory',
        generation: 1, revocationGeneration: 0, selectionEpoch: 1, restartGeneration: 1, parentGeneration: 1,
        policyGeneration: 1, bootstrapExpiresAt: Date.now() + 5000, expiresAt: Date.now() + 60000 };
    const port = {
        connection: Object.freeze(Object.create(null)),
        subscribe: (listener: (value: unknown) => void) => { child.on('message', listener); return () => { child.off('message', listener); }; },
        publish: (frame: string) => { child.send(frame); },
        onClose: (listener: () => void) => { child.on('exit', listener); return () => { child.off('exit', listener); }; },
        terminate: () => { if (child.connected) child.disconnect(); if (child.exitCode === null) child.kill(); },
    };
    const create = kind === 'mini' ? createProductionMiniAgentLauncherWithPreSpawnedChildV1 : createProductionMcpAgentLauncherWithPreSpawnedChildV1;
    const session = await create({ readHostContext: () => ({ ...context }), writeAudit: () => {},
        commitTerminalAudit: () => { throw new Error('Unexpected semantic execution'); } }, port).launch();
    let id = 0;
    const request = async (value: unknown) => { const response = next(); child.stdin!.write(JSON.stringify(value) + '\n'); return response; };
    const tool = (name: string, args: unknown) => request({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: {
        name, arguments: args, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'synthetic-territorial', version: '1' } },
    } });
    const close = async () => {
        const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit');
        session.close(); await exited;
        const reports = readdirSync(data).filter(name => name.startsWith('egress-'));
        assert.equal(reports.length, 1, 'child egress probe must have run');
        for (const name of reports) assert.deepEqual(JSON.parse(readFileSync(path.join(data, name), 'utf8')), []);
    };
    return { request, tool, next, close };
}

for (const kind of ['mini', 'aip', 'mcp', 'plugin'] as const) {
    test(`${kind}: production composition binds, then denies the specific territorial command with no writer or child egress`, {timeout: 10000}, async () => {
        const bound = await boundChild(kind === 'plugin' ? 'mcp' : kind);
        try {
            if (kind === 'mini') {
                const catalog = await bound.request({ command: 'capabilities', args: {} });
                assert.equal(catalog.ok, true);
                assert.ok(catalog.result.operations.length >= 5);
                assert.ok(catalog.result.operations.some((op: { operationId: string }) => op.operationId === 'mediflow.terminology.search.v1'));
                const denied = await bound.request({ command: 'territorial-packs', args: command });
                assert.equal(denied.error.code, 'INVALID_REQUEST');
            } else if (kind === 'aip') {
                const control = await bound.next();
                assert.ok(control.catalog.operations.length >= 5);
                assert.ok(control.catalog.operations.some((op: { operationId: string }) => op.operationId === 'mediflow.terminology.search.v1'));
                const denied = await bound.request({ attempt: true });
                assert.equal(denied.outcome, 'denied');
                assert.equal(denied.denialCode, 'operation_not_allowed');
            } else {
                const catalog = await bound.tool('mediflow.system.capabilities.v1', {});
                assert.equal(catalog.result.isError, undefined, JSON.stringify(catalog));
                assert.ok(catalog.result.structuredContent.operations.length >= 5);
                const denied = await bound.tool(kind === 'plugin' ? operationId : 'mediflow.system.capabilities.v1',
                    kind === 'plugin' ? command : { ...command, channel: 'supervisor' });
                if (kind === 'plugin') assert.deepEqual(denied.error, { code: -32602, message: `Tool ${operationId} not found` });
                else {
                    assert.equal(denied.result.isError, true);
                    assert.deepEqual(denied.result.content, [{ type: 'text', text: 'Input validation error: Invalid arguments for tool mediflow.system.capabilities.v1: Unrecognized keys: "schemaVersion", "preset", "expectedRevision", "confirmed", "channel"' }]);
                }
            }
            assert.deepEqual(readTerritorialPacks(db), before);
            assert.throws(() => db.transaction(() => requireTerritorialPack(db, 'lom')).immediate(), /pack_disabled/);
            const deniedWriter = await createHostProstheticPrescription({ request: new Request('http://localhost/writer'),
                session: { id: 'synthetic-production-territorial-web', userId: 'synthetic-user', username: ['synthetic', 'territorial'].join('-'), role: 'admin',
                    authChannel: 'web', createdAt: Date.now(), expiresAt: Date.now() + 60000 } },
                { patientId: 'synthetic-patient', prescribedAt: '2026-10-21', description: 'ENC:synthetic' });
            assert.equal(deniedWriter.status, 403);
            assert.equal(external, 0);
            assert.equal(db.prepare('SELECT count(*) FROM prosthetic_prescriptions').pluck().get(), 0);
        } finally { await bound.close(); }
    });
}
