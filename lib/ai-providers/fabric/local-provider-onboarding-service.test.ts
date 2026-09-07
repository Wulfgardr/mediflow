/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import Database from 'better-sqlite3';
import * as owner from '../../security/web-auth-lifecycle-owner-adapter';
import { createLocalProviderOnboardingService } from './local-provider-onboarding-service';
import { createHostProviderLifecycleService } from './provider-lifecycle-service';
import { OllamaLocalityError, attestLocalOllamaModel } from '../ollama-locality';
import { buildFunctionStatus } from '../../function-status';
import { buildFunctionModelCatalog } from './function-model-preferences';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function fixture(attest?: typeof attestLocalOllamaModel) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-local-onboarding-'));
    const db = new Database(path.join(root, 'medical.db'));
    db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    for (const [key, value] of Object.entries({ aiProvider: 'ollama', aiModel_clinical: 'synthetic-local', aiUrl: 'http://127.0.0.1:11434/v1' }))
        db.prepare('INSERT INTO settings VALUES (?, ?)').run(key, value);
    const control = owner.bootstrapControl()!;
    const attempt = owner.begin('login', { controlId: control.controlId, ifMatch: control.etag, idempotencyKey: `onboarding-${path.basename(root)}` })!;
    const issue = owner.issue(attempt, { id: 'synthetic-operator', username: path.basename(root), role: 'user' })!;
    const resolved = owner.resolve(issue.sessionId, control.controlId);
    assert.equal(resolved.status, 'active');
    if (resolved.status !== 'active') throw new Error('fixture failed');
    const session = resolved.projection;
    let calls = 0;
    const service = createLocalProviderOnboardingService({ appDataDir: root,
        authenticate: async () => {
            const reread = owner.resolve(issue.sessionId, control.controlId);
            return reread.status === 'active' ? reread.projection : null;
        },
        immediate: operation => db.transaction(operation).immediate(),
        readSettings: () => Object.fromEntries((db.prepare('SELECT key,value FROM settings').all() as { key: string; value: string }[]).map(row => [row.key, row.value])),
        attest: async (...args) => {
            calls++;
            assert.equal(args[0], 'http://127.0.0.1:11434'); assert.equal(args[1], 'synthetic-local');
            if (attest) return attest(...args);
            return { authorityPlane: 'clinical_application', provider: 'ollama', executionMode: 'local', endpointClass: 'loopback',
                requestedModel: args[1], canonicalModel: args[1], digest: 'a'.repeat(64), serverVersion: '0.33.3', checkedAt: new Date().toISOString() };
        },
    });
    const lifecycle = createHostProviderLifecycleService({ appDataDir: root });
    cleanup.push(() => { owner.retireForUser(session); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
    return { root, db, session, service, lifecycle, calls: () => calls };
}

test('ordinary authenticated operator explicitly admits once with receipt/version; read is inert; no inference claim', async () => {
    const f = fixture();
    const before = fs.readFileSync(path.join(f.root, 'medical.db'));
    const initial = await f.service.inspect();
    assert.equal(initial.state, 'missing'); assert.equal(initial.canActivate, true); assert.equal(f.calls(), 0);
    assert.equal(fs.existsSync(path.join(f.root, 'ai')), false);
    const admitted = await f.service.activate(initial.revision);
    assert.equal(admitted.state, 'available_unqualified'); assert.equal(admitted.version, 1);
    assert.match(admitted.receipt!, /^receipt_/); assert.equal(admitted.credentialClass, 'local_model');
    const catalog = buildFunctionModelCatalog({ settings: { aiProvider: 'ollama', aiModel_clinical: 'synthetic-local', aiUrl: 'http://127.0.0.1:11434' },
        ollamaLifecycle: f.lifecycle.service.read(), athenaLifecycle: { status: 'denied', reason: 'missing' }, athenaIdentity: 'synthetic', athenaAvailable: false });
    assert.equal(catalog.bindings.find(item => item.model === 'synthetic-local')?.available, true);
    assert.equal(catalog.bindings.find(item => item.provider === 'athena_mlx')?.available, false);
    assert.equal(admitted.inference, 'not_run'); assert.equal(admitted.qualification, 'not_assessed');
    assert.deepEqual(fs.readFileSync(path.join(f.root, 'medical.db')), before);
    assert.deepEqual(await f.service.activate(admitted.revision), admitted); assert.equal(f.calls(), 2);
    const functions = buildFunctionStatus({ platform: 'darwin', enabled: { patient_insight: true, smart_import: false, document_synthesis: false, treatment_reasoning: false },
        ollamaLifecycle: admitted.state, athenaLifecycle: 'missing', clinicalBinding: { state: 'configured', model: admitted.model }, athenaArtifact: false, who: 'disabled' }, new Date().toISOString());
    assert.equal(functions.functions.find(row => row.id === 'patient_insight')?.state, 'unverified');
    assert.equal(functions.functions.find(row => row.id === 'smart_import')?.state, 'off');
});

test('missing settings and unsupported local port cannot choose a fallback or contact provider', async () => {
    for (const change of ["DELETE FROM settings", "UPDATE settings SET value='http://127.0.0.1:8080' WHERE key='aiUrl'", "UPDATE settings SET value='other' WHERE key='aiProvider'"]) {
        const f = fixture(); f.db.exec(change);
        const status = await f.service.inspect(); assert.equal(status.canActivate, false);
        await assert.rejects(f.service.activate(status.revision)); assert.equal(f.calls(), 0);
        assert.equal(f.lifecycle.service.read().status, 'denied');
    }
});

test('ordinary network/model failure leaves lifecycle missing and redacts transport details', async () => {
    for (const [error, code] of [[new Error('private transport detail'), 'provider_unreachable'], [new OllamaLocalityError('model_not_local'), 'model_absent_or_not_local']] as const) {
        const f = fixture(async () => { throw error; });
        await assert.rejects(f.service.activate((await f.service.inspect()).revision), new RegExp(code));
        assert.equal(f.lifecycle.service.read().status, 'denied');
    }
});

test('binding change during attestation rejects before commit', async () => {
    const f = fixture(async () => { f.db.exec("UPDATE settings SET value='synthetic-replacement' WHERE key='aiModel_clinical'"); return {} as Awaited<ReturnType<typeof attestLocalOllamaModel>>; });
    await assert.rejects(f.service.activate((await f.service.inspect()).revision), /configuration_changed/);
    assert.equal(f.lifecycle.service.read().status, 'denied');
});

test('explicit recovery uses a new attestation; revoked remains terminal', async () => {
    const f = fixture(); const first = await f.service.activate((await f.service.inspect()).revision);
    f.lifecycle.control.degrade({ expectedVersion: first.version });
    const recovered = await f.service.activate((await f.service.inspect()).revision);
    assert.equal(recovered.version, 3); assert.equal(f.calls(), 2);
    f.lifecycle.control.revoke({ expectedVersion: 3 });
    const status = await f.service.inspect(); assert.equal(status.state, 'revoked'); assert.equal(status.canActivate, false);
    await assert.rejects(f.service.activate(status.revision), /revoked/); assert.equal(f.calls(), 2);
});

test('owner lock during attestation aborts and never writes', async () => {
    const f = fixture(async () => { owner.retireForUser(f.session); return {} as Awaited<ReturnType<typeof attestLocalOllamaModel>>; });
    await assert.rejects(f.service.activate((await f.service.inspect()).revision), /owner_locked|verification_interrupted/);
    assert.equal(f.lifecycle.service.read().status, 'denied');
    await assert.rejects(f.service.inspect(), /owner_locked/);
});

test('concurrent provider revocation is observed before activation commit', async () => {
    let revoke = false;
    const f = fixture(async () => {
        if (revoke) f.lifecycle.control.revoke({ expectedVersion: 1 });
        return {} as Awaited<ReturnType<typeof attestLocalOllamaModel>>;
    });
    const first = await f.service.activate((await f.service.inspect()).revision); revoke = true;
    await assert.rejects(f.service.activate(first.revision), /revoked/);
    const final = f.lifecycle.service.read(); assert.equal(final.status === 'available' && final.record.lifecycle.status, 'revoked');
});

test('timeout is bounded even if an ordinary transport finishes late; no lifecycle write', async context => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    let complete!: (value: Awaited<ReturnType<typeof attestLocalOllamaModel>>) => void;
    const f = fixture(async () => { started(); return new Promise(resolve => { complete = resolve; }); });
    const operation = f.service.activate((await f.service.inspect()).revision);
    const rejected = assert.rejects(operation, /verification_interrupted/);
    await waiting; context.mock.timers.tick(30_001); await rejected;
    complete({} as Awaited<ReturnType<typeof attestLocalOllamaModel>>);
    await Promise.resolve();
    assert.equal(f.lifecycle.service.read().status, 'denied');
});

test('canonical attestor keeps version, tags, show, preload and running digest checks on synthetic metadata', async context => {
    const seen: string[] = [];
    const model = { name: 'synthetic-local', model: 'synthetic-local', size: 4096, digest: 'b'.repeat(64) };
    context.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input)); assert.equal(url.origin, 'http://127.0.0.1:11434'); seen.push(url.pathname);
        assert.equal(init?.redirect, 'error');
        if (url.pathname === '/api/generate') {
            assert.deepEqual(JSON.parse(init!.body as string), { model: 'synthetic-local', keep_alive: '30m' });
            return Response.json({ model: 'synthetic-local', done: true });
        }
        if (url.pathname === '/api/version') return Response.json({ version: '0.33.3' });
        if (url.pathname === '/api/tags' || url.pathname === '/api/ps') return Response.json({ models: [model] });
        if (url.pathname === '/api/show') return Response.json({ details: { family: 'synthetic' } });
        throw new Error('Unexpected metadata operation');
    });
    const f = fixture(attestLocalOllamaModel);
    const result = await f.service.activate((await f.service.inspect()).revision);
    assert.equal(result.state, 'available_unqualified');
    assert.deepEqual(seen, ['/api/version', '/api/tags', '/api/show', '/api/generate', '/api/ps']);
});
