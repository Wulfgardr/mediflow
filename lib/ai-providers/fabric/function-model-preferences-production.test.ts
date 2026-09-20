/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createHostProviderLifecycleService } from './provider-lifecycle-service.ts';
import { createFunctionModelDispatch, FUNCTION_MODEL_CHOICE_HEADER, functionModelBindingSettings } from './function-model-dispatch.ts';
import { FUNCTION_PREFERENCES_KEY } from './function-model-preferences.ts';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-function-model-production-'));
process.env.MEDIFLOW_DATA_DIR = directory;
const disk = new Database(path.join(directory, 'medical.db'));
for (const file of fs.readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) {
    disk.exec(fs.readFileSync(path.join('drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
for (const [key, value] of Object.entries({ aiProvider: 'ollama', aiUrl: 'http://127.0.0.1:11434', aiModel_clinical: 'synthetic-clinical:1',
    aiModel_reasoning: 'synthetic-reasoning:1', aiPatientInsightKillSwitch: 'enabled', aiSmartImportKillSwitch: 'enabled', aiDocumentSynthesisKillSwitch: 'enabled',
    aiTreatmentReasoningKillSwitch: 'disabled', 'network.mode': 'local-only', clinicName: 'Synthetic fixture' })) {
    disk.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run(key,value);
}
const lifecycle = createHostProviderLifecycleService({ appDataDir: directory });
lifecycle.control.admit({ expectedVersion: 0, onboarding: { schemaVersion: 'mediflow.ai.provider-onboarding.v1', provider: 'ollama', credentialClass: 'local_model', step: 'enabled', attestation: 'available_unqualified' } });
const { functionModelPreferencesService: service, readProductionFunctionModelSources } = await import('./function-model-preferences-production.ts');
const { createHostLocalProviderBindingService } = await import('../host-local-provider-binding.ts');
test.after(() => { disk.close(); fs.rmSync(directory, { recursive: true, force: true }); });

const command = () => {
    const view = service.read();
    return { schemaVersion: 'mediflow.function-preferences-command.v1', commandId: randomUUID(), expectedRevision: view.revision,
        expectedCatalogRevision: view.catalogRevision, action: 'set', functionId: 'patient_insight', enabled: true,
        defaultModelOptionId: view.functions[0].options[1].modelOptionId };
};

test('production settings owner persists only dedicated preferences and existing switch, and the real binding reader consumes the selection', async () => {
    const before = disk.prepare('SELECT key,value FROM settings ORDER BY key').all();
    const initial = service.read(); const selected = command(); const saved = service.apply(selected);
    assert.deepEqual(service.read(), saved); assert.deepEqual(service.apply(selected), saved);
    assert.deepEqual(disk.prepare('SELECT key,value FROM settings WHERE key != ? ORDER BY key').all(FUNCTION_PREFERENCES_KEY), before);
    const consume = createFunctionModelDispatch({ authenticate: async () => 'synthetic-session', readSources: readProductionFunctionModelSources })('patient_insight', async () => {
        const binding = await createHostLocalProviderBindingService().readClinical();
        assert.equal(binding.status, 'available');
        if (binding.status !== 'available') throw new Error('Fixture binding denied');
        return Response.json({ model: binding.resolution.receipt.model, provider: binding.resolution.receipt.provider, fallback: binding.resolution.fallback.strategy });
    });
    const defaultResponse = await consume(new Request('http://localhost/api/ai/patient-insight/preview', { method: 'POST' }));
    assert.equal(defaultResponse.status, 200); assert.deepEqual(await defaultResponse.json(), { model: 'synthetic-reasoning:1', provider: 'ollama', fallback: 'none' });
    const override = await consume(new Request('http://localhost/api/ai/patient-insight/preview', { method: 'POST', headers: {
        [FUNCTION_MODEL_CHOICE_HEADER]: JSON.stringify({ modelOptionId: initial.functions[0].options[0].modelOptionId, expectedCatalogRevision: saved.catalogRevision }) } }));
    assert.equal(override.status, 200); assert.equal((await override.json()).model, 'synthetic-clinical:1'); assert.deepEqual(service.read(), saved);
});

test('Document Synthesis sealed binding consumes the scoped reasoning choice with synthetic attestation only', async () => {
    const { createDocumentSynthesisProviderBindingForTest, resolveDocumentSynthesisProviderBinding } = await import('./document-synthesis-provider-binding.ts');
    const view = service.read();
    const handler = createFunctionModelDispatch({ authenticate: async () => 'synthetic-session', readSources: readProductionFunctionModelSources })('document_synthesis', async () => {
        const binder = createDocumentSynthesisProviderBindingForTest({
            readSettings: async () => {
                const current = readProductionFunctionModelSources().settings;
                return functionModelBindingSettings({ aiProvider: current.aiProvider, aiUrl: current.aiUrl, aiModel_reasoning: current.aiModel_reasoning }, 'reasoning');
            },
            attest: async (_endpoint: string, model: string) => ({ authorityPlane: 'clinical_application', provider: 'ollama', executionMode: 'local', endpointClass: 'loopback',
                requestedModel: model, canonicalModel: model, digest: 'sha256:synthetic', serverVersion: 'synthetic', checkedAt: '2026-09-07T00:00:00.000Z' }),
        });
        const bound = await binder.bind(); assert.equal(bound.status, 'available');
        if (bound.status !== 'available') throw new Error('Synthetic binding denied');
        const resolved = resolveDocumentSynthesisProviderBinding(bound.token);
        return Response.json({ model: resolved?.receipt.model, task: resolved?.receipt.task, fallback: resolved?.fallback.strategy });
    });
    const result = await handler(new Request('http://localhost/api/ai/document-synthesis/preview', { method: 'POST', headers: {
        [FUNCTION_MODEL_CHOICE_HEADER]: JSON.stringify({ modelOptionId: view.functions[0].options[0].modelOptionId, expectedCatalogRevision: view.catalogRevision }) } }));
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { model: 'synthetic-clinical:1', task: 'reasoning', fallback: 'none' });
});

test('production catalog read and preset never change provider lifecycle; terminal revoke invalidates saved binding', () => {
    const before = lifecycle.service.read(); const view = service.read();
    const request = { schemaVersion: 'mediflow.function-preferences-command.v1', commandId: randomUUID(), expectedRevision: view.revision,
        expectedCatalogRevision: view.catalogRevision, action: 'preset', presetId: 'all_off' };
    service.preview(request); assert.deepEqual(lifecycle.service.read(), before);
    lifecycle.control.revoke({ expectedVersion: 1 });
    assert.throws(() => service.apply(request), /catalog_stale/);
    assert.equal(service.read().functions[0].bindingState, 'stale');
    const current = lifecycle.service.read(); assert.equal(current.status, 'available');
    if (current.status === 'available') assert.equal(current.record.lifecycle.status, 'revoked');
});
