import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { harness } from './ai-settings-controller.test-support.ts';
import { installNetworkPatientCookieFixture } from '../network-patient-authority-test-fixture';
import { syntheticLoopbackRequest } from '../security/loopback-ingress-test-fixture';
import { issueSyntheticWebSessionContext, retireSyntheticWebSession } from '../security/web-auth-lifecycle-owner-test-fixture';
import { readFunctionModelPreferences } from '../ai-providers/fabric/function-model-preferences';

const root = mkdtempSync(join(tmpdir(), 'mf-d06-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = root;
const cookieState = { cookies: new Map<string, string>(), headers: syntheticLoopbackRequest('http://127.0.0.1').headers };
const cleanup = installNetworkPatientCookieFixture(root, cookieState);
const load = createRequire(import.meta.url);
const { dbServer, openDbServer } = load('../db-server.ts') as typeof import('../db-server');
const { users } = load('../schema.ts') as typeof import('../schema');
const { currentArchiveGeneration } = load('../security/archive-session-generation.ts') as typeof import('../security/archive-session-generation');
const routes = load('../../app/api/settings/[key]/route.ts') as typeof import('../../app/api/settings/[key]/route');
const generic = load('../../app/api/settings/route.ts') as typeof import('../../app/api/settings/route');
const sql = openDbServer();
const actor = 'synthetic-d06-operator';
dbServer.insert(users).values({ id: actor, username: actor, role: 'admin', passwordHash: 'synthetic', salt: 'synthetic', encryptedMasterKey: 'synthetic' }).run();
const clientA = issueSyntheticWebSessionContext({ id: actor, username: actor, role: 'admin' }, 'd06-a');
const clientB = issueSyntheticWebSessionContext({ id: actor, username: actor, role: 'admin' }, 'd06-b');
let active = clientA;
let failRead = false;
const responses: number[] = [];
const seed = {
    aiModelDefaultVersion: 'qwen35-default-v1', hardwareProfile: 'high', aiProvider: 'ollama',
    aiModel_clinical: 'synthetic:clinical', aiModel_reasoning: 'synthetic:reasoning', aiModel: 'synthetic:clinical',
    aiUrl: 'http://127.0.0.1:11434/v1', ollamaUrl: 'http://127.0.0.1:11434/v1',
    documentRouterControlFlow: 'shadow', aiInsightMode: 'complete',
    aiInsightManualConfig: JSON.stringify({ maxDocuments: 6, maxDocumentSummaryChars: 260, maxDocumentContextChars: 2200, outputMaxTokens: 512 }),
    aiPatientInsightKillSwitch: 'disabled', aiDocumentSynthesisKillSwitch: 'disabled', aiSmartImportKillSwitch: 'disabled',
};
function reset() {
    sql.exec('DROP TRIGGER IF EXISTS synthetic_d06_failure; DELETE FROM settings;');
    const insert = sql.prepare('INSERT INTO settings(key,value) VALUES (?,?)');
    for (const [key, value] of Object.entries(seed)) insert.run(key, value);
    responses.length = 0;
    failRead = false;
}
const snapshot = () => ({ settings: sql.prepare('SELECT * FROM settings ORDER BY key').all(), audit: sql.prepare('SELECT * FROM audit_events ORDER BY rowid').all() });
const value = (key: string) => sql.prepare('SELECT value FROM settings WHERE key=?').pluck().get(key);
function request(url: string, options: RequestInit = {}) {
    cookieState.cookies.set('mediflow_session', active.session.id);
    cookieState.cookies.set('mediflow_auth_control', active.controlId);
    const input = syntheticLoopbackRequest('http://127.0.0.1' + url, { ...options, headers: {
        'content-type': 'application/json', origin: 'http://127.0.0.1', 'sec-fetch-site': 'same-origin',
        'x-mediflow-archive-generation': currentArchiveGeneration(), ...options.headers,
    } });
    cookieState.headers = input.headers;
    return input;
}
async function boundary(url: string | URL | Request, options?: RequestInit) {
    const path = String(url), input = request(path, options);
    if (failRead && path === '/api/settings/aiInsightMode' && !options?.method) return Response.json({}, { status: 503 });
    let response: Response;
    if (path === '/api/settings/ai/configuration' && existsSync('app/api/settings/ai/configuration/route.ts')) {
        const route = load('../../app/api/settings/ai/configuration/route.ts');
        response = await route.PUT(input);
    } else if (path === '/api/settings') response = await generic.POST(input);
    else {
        const context = { params: Promise.resolve({ key: decodeURIComponent(path.slice('/api/settings/'.length)) }) };
        response = await (options?.method === 'PUT' ? routes.PUT(input, context) : routes.GET(input, context));
    }
    responses.push(response.status);
    return response;
}
async function mount() {
    const fixture = harness(new EventTarget());
    fixture.render();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(fixture.render().aiSettingsLoadState, 'ready', 'real authenticated reads must succeed');
    return fixture;
}
test.after(() => { retireSyntheticWebSession(clientA.session); retireSyntheticWebSession(clientB.session); cleanup(); sql.close(); });

test('D06 two real settings clients reject a stale draft, preserve it, reread and explicitly confirm again', async t => {
    reset(); t.mock.method(globalThis, 'fetch', boundary);
    const a = await mount(), b = await mount(); t.after(a.close); t.after(b.close);
    b.render().setAiInsightSettings(previous => ({ ...previous, mode: 'balanced' }));
    a.render().setAiInsightSettings(previous => ({ ...previous, mode: 'full_auto' }));
    active = clientA; await a.render().saveAiConfig();
    assert.equal(value('aiInsightMode'), 'full_auto', 'ordinary fresh client save succeeds');
    const before = snapshot(); responses.length = 0;
    active = clientB; await b.render().saveAiConfig();
    assert.ok(responses.includes(409), 'stale save must return HTTP 409');
    assert.deepEqual(snapshot(), before, 'stale save writes neither settings nor audit');
    assert.equal(b.render().aiInsightSettings.mode, 'balanced', 'draft stays in its field');
    assert.equal(b.toasts.at(-1)?.tone, 'error');
    responses.length = 0;
    await b.render().saveAiConfig();
    assert.deepEqual(responses, [], 'no retry before explicit reread');
    failRead = true;
    await b.render().rereadAiConfig();
    assert.equal(b.render().aiSettingsLoadState, 'failed');
    assert.equal(b.render().aiInsightSettings.mode, 'balanced');
    assert.deepEqual(snapshot(), before, 'failed reread is read-only');
    failRead = false;
    await b.render().rereadAiConfig();
    assert.equal(b.render().aiSettingsLoadState, 'ready');
    assert.equal(b.render().aiInsightSettings.mode, 'balanced', 'reread preserves the draft');
    assert.equal(b.render().aiSettingsReadback?.aiInsightMode, 'full_auto');
    assert.deepEqual(snapshot(), before, 'reread is read-only');
    await b.render().saveAiConfig();
    assert.equal(value('aiInsightMode'), 'balanced');
    assert.equal(b.toasts.at(-1)?.tone, 'success');
});

test('D06 a storage failure on the third settings write rolls back all settings, generation and audit', async t => {
    reset(); t.mock.method(globalThis, 'fetch', boundary);
    active = clientA;
    const a = await mount(); t.after(a.close);
    a.render().applyHardwareProfile('low');
    a.render().setAiInsightSettings(previous => ({ ...previous, mode: 'balanced' }));
    const before = snapshot();
    sql.exec("CREATE TRIGGER synthetic_d06_failure BEFORE UPDATE ON settings WHEN NEW.key='aiModel_clinical' BEGIN SELECT RAISE(ABORT, 'synthetic D06 storage failure'); END;");
    try {
        responses.length = 0;
        await a.render().saveAiConfig();
        assert.ok(responses.includes(500), 'fault must reach the real writer');
        assert.deepEqual(snapshot(), before, 'a failed save must leave no partial settings or audit');
        assert.equal(a.render().aiInsightSettings.mode, 'balanced');
        assert.equal(a.toasts.at(-1)?.tone, 'error');
    } finally { sql.exec('DROP TRIGGER synthetic_d06_failure'); }
});

test('ordinary controller save is one atomic request and can be saved again without a false conflict', async t => {
    reset(); t.mock.method(globalThis, 'fetch', boundary); active = clientA;
    const a = await mount(); t.after(a.close);
    const before = snapshot().audit.length;
    a.render().applyHardwareProfile('low');
    responses.length = 0;
    await a.render().saveAiConfig();
    assert.deepEqual(responses, [200], 'one HTTP write for the whole configuration');
    assert.equal(value('hardwareProfile'), 'low');
    assert.equal(value('aiProvider'), 'ollama');
    assert.equal(value('aiModel_clinical'), 'qwen2.5:7b');
    assert.equal(snapshot().audit.length - before, 13);
    a.render().setAiInsightSettings(previous => ({ ...previous, mode: 'manual' }));
    await a.render().saveAiConfig();
    assert.equal(value('aiInsightMode'), 'manual');
    assert.equal(a.toasts.at(-1)?.tone, 'success');
});

test('the existing native per-key contract still writes and invalidates the Web read-set', async t => {
    reset(); t.mock.method(globalThis, 'fetch', boundary); active = clientB;
    const web = await mount(); t.after(web.close);
    web.render().setAiInsightSettings(previous => ({ ...previous, mode: 'balanced' }));
    active = clientA;
    for (const [key, setting] of Object.entries({ aiInsightMode: 'full_auto', aiInsightManualConfig: seed.aiInsightManualConfig, documentRouterControlFlow: 'active' })) {
        const response = await boundary('/api/settings/' + key, { method: 'PUT', body: JSON.stringify({ value: setting }) });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true, key, value: setting });
    }
    const before = snapshot(); active = clientB; responses.length = 0;
    await web.render().saveAiConfig();
    assert.deepEqual(responses, [409]);
    assert.deepEqual(snapshot(), before);
    assert.equal(web.render().aiInsightSettings.mode, 'balanced');
});

test('required audit failure after configuration revocation rolls back the whole save', async t => {
    reset(); t.mock.method(globalThis, 'fetch', boundary); active = clientA;
    const a = await mount(); t.after(a.close);
    a.render().applyHardwareProfile('low');
    const before = snapshot();
    sql.exec("CREATE TRIGGER synthetic_d06_audit_failure BEFORE INSERT ON audit_events WHEN NEW.subject_ref='aiInsightMode' BEGIN SELECT RAISE(ABORT, 'synthetic D06 audit failure'); END;");
    try {
        responses.length = 0;
        await a.render().saveAiConfig();
        assert.deepEqual(responses, [500]);
        assert.deepEqual(snapshot(), before, 'configuration generation and earlier audit events roll back');
    } finally { sql.exec('DROP TRIGGER synthetic_d06_audit_failure'); }
});

for (const concurrentParameters of [false, true]) test(`confirmed preference switches refresh only their preconditions; concurrent parameters=${concurrentParameters}`, async t => {
    reset(); t.mock.method(globalThis, 'fetch', boundary); active = clientA;
    const a = await mount(); t.after(a.close);
    a.render().setAiInsightSettings(previous => ({ ...previous, mode: 'balanced' }));
    await boundary('/api/settings/aiPatientInsightKillSwitch', { method: 'PUT', body: JSON.stringify({ value: 'enabled' }) });
    if (concurrentParameters) await boundary('/api/settings/aiInsightMode', { method: 'PUT', body: JSON.stringify({ value: 'full_auto' }) });
    const rows = sql.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const dto = readFunctionModelPreferences({ settings: Object.fromEntries(rows.map(row => [row.key, row.value])), ollamaLifecycle: { status: 'denied', reason: 'missing' } }, 'v2');
    const before = snapshot();
    await a.render().syncFunctionPreferences(dto);
    assert.deepEqual(snapshot(), before, 'synchronizing the confirmed switches is read-only');
    assert.equal(a.render().aiInsightSettings.mode, 'balanced');
    responses.length = 0;
    await a.render().saveAiConfig();
    assert.deepEqual(responses, [concurrentParameters ? 409 : 200]);
    if (concurrentParameters) assert.deepEqual(snapshot(), before, 'switch readback cannot authorize a stale parameter draft');
    else { assert.equal(value('aiPatientInsightKillSwitch'), 'enabled'); assert.equal(value('aiInsightMode'), 'balanced'); }
});
