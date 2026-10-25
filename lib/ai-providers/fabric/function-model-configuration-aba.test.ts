/* Real settings HTTP owners and SQLite; synthetic auth/handler dependencies only.
 * No provider process, model artifact, native UI or cloud qualification. */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { test, mock, after } from 'node:test';
import { randomUUID } from 'node:crypto';

const parent = process.env.MEDIFLOW_DATA_DIR!;
assert.ok(parent && path.isAbsolute(parent));
process.env.MEDIFLOW_DATA_DIR = mkdtempSync(path.join(parent, 'configuration-aba-'));
const { dbServer, openDbServer } = await import('../../db-server.ts');
const { settings } = await import('../../schema.ts');
openDbServer();
const lifecycle = (await import('./provider-lifecycle-service.ts')).createHostProviderLifecycleService();
lifecycle.control.admit({ expectedVersion: 0, onboarding: { schemaVersion: 'mediflow.ai.provider-onboarding.v1', provider: 'ollama', credentialClass: 'local_model', step: 'enabled', attestation: 'available_unqualified' } });
for (const [key, value] of Object.entries({ aiProvider: 'ollama', aiUrl: 'http://127.0.0.1:11434', aiModel_clinical: 'synthetic-A:1',
    aiModel_reasoning: 'synthetic-reasoning:1', aiPatientInsightKillSwitch: 'enabled', aiSmartImportKillSwitch: 'enabled',
    aiDocumentSynthesisKillSwitch: 'enabled', aiTreatmentReasoningKillSwitch: 'disabled' }))
    dbServer.insert(settings).values({ key, value }).run();
const fixture = await import('../../security/web-auth-lifecycle-owner-test-fixture.ts');
const auth = await import('../../security/server-auth.ts');
const generation = await import('../../security/archive-session-generation.ts');
const syntheticUser = `synthetic-config-${randomUUID()}`;
const web = fixture.issueSyntheticWebSession({ id: syntheticUser, username: syntheticUser, role: 'admin' }, randomUUID());
mock.method((auth as unknown as { default?: typeof auth }).default ?? auth, 'requireSessionOrLocalToken', async () => web);
after(() => { mock.restoreAll(); fixture.retireSyntheticWebSession(web); });
const { POST } = await import('../../../app/api/settings/route.ts');
const { PUT } = await import('../../../app/api/settings/[key]/route.ts');
const { createFunctionModelDispatch } = await import('./function-model-dispatch.ts');
const { readProductionFunctionModelSources: readSources } = await import('./function-model-preferences-production.ts');
const { createNativeFabricExecution } = await import('../../chatgpt-product/native-fabric-execution.ts');
const { readOrdinaryCloudSettings } = await import('../../chatgpt-product/ordinary-settings.ts');
async function write(key: string, value: string, method: 'POST' | 'PUT') {
    const request = new Request('http://localhost/api/settings' + (method === 'PUT' ? '/' + key : ''), { method,
        headers: { 'content-type': 'application/json', 'x-mediflow-archive-generation': generation.currentArchiveGeneration() },
        body: JSON.stringify(method === 'POST' ? { key, value } : { value }) });
    const response = method === 'POST' ? await POST(request) : await PUT(request, { params: Promise.resolve({ key }) });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
}
async function aba(key = 'aiModel_clinical', a = 'synthetic-A:1', b = 'synthetic-B:1') {
    await write(key, b, 'POST');
    await write(key, a, 'PUT');
}
const request = () => new Request('http://localhost/api/ai/patient-insight/preview', { method: 'POST' });
test('P2 shared dispatch: real POST/PUT A-B-A while awaiting without intermediate verify cannot publish', async () => {
    let calls = 0;
    const handler = createFunctionModelDispatch({ authenticate: async () => web.id, readSources })('patient_insight', async () => {
        calls++; await aba(); return Response.json({ synthetic: true });
    });
    const response = await handler(request());
    assert.equal(calls, 1); assert.equal(response.status, 409); assert.equal((await response.json()).code, 'binding_stale');
});
test('P2 native execution: real settings A-B-A invalidates the captured preparation without observing B', async () => {
    const controller = new AbortController();
    const context = { sources: {}, session: web, request: { functionId: 'patient_insight' }, selection: { expiresAt: Date.now() + 60_000 } };
    const service = createNativeFabricExecution({ readSources, confirm: () => {}, sourceSignal: () => controller.signal,
        close: () => controller.abort(), execute: async () => { await aba(); return Response.json({ preview: { status: 'available' } }); } });
    service.prepare(web as never).bind(context as never);
    const selected = service.capture('patient_insight');
    const ready = await service.ready(context as never, selected).json();
    await assert.rejects(service.generate(request(), web as never, ready.attemptId), /binding_stale/);
});
test('P2 ordinary governance revision changes after a real kill-switch disable-enable ABA', async () => {
    const before = await readOrdinaryCloudSettings();
    await aba('aiPatientInsightKillSwitch', 'enabled', 'disabled');
    const after = await readOrdinaryCloudSettings();
    assert.notEqual(after.revision, before.revision); assert.deepEqual(after.lanes, before.lanes);
});

test('generation advances only for effective host AI writes and cannot be set by the caller', async () => {
    const { FUNCTION_MODEL_CONFIGURATION_GENERATION_KEY: key } = await import('./function-model-configuration-generation.ts');
    const read = () => openDbServer().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    const before = read()?.value;
    await write('aiModel_clinical', 'synthetic-A:1', 'POST');
    await write('clinicName', 'Ambulatorio sintetico', 'PUT');
    assert.equal(read()?.value, before);
    const request = new Request('http://localhost/api/settings', { method: 'POST', headers: { 'content-type': 'application/json',
        'x-mediflow-archive-generation': generation.currentArchiveGeneration() }, body: JSON.stringify({ key, value: '0' }) });
    assert.equal((await POST(request)).status, 403); assert.equal(read()?.value, before);
});
test('configuration and generation commit atomically: a failed generation write rolls back the model', async () => {
    const disk = openDbServer();
    disk.exec("CREATE TEMP TRIGGER synthetic_generation_failure BEFORE UPDATE ON settings WHEN NEW.key='ai.fabric.configurationGeneration' BEGIN SELECT RAISE(ABORT, 'synthetic_generation_failure'); END");
    try {
        const { writeSettingWithFunctionModelGeneration } = await import('./function-model-settings-write.ts');
        assert.throws(() => writeSettingWithFunctionModelGeneration('aiModel_clinical', 'synthetic-rollback:1'), /synthetic_generation_failure/);
        assert.equal((disk.prepare('SELECT value FROM settings WHERE key=?').get('aiModel_clinical') as { value: string }).value, 'synthetic-A:1');
    } finally { disk.exec('DROP TRIGGER synthetic_generation_failure'); }
});
