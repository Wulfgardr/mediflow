/* @Codex: synthetic persistence regression for the ordinary clinical-functions save. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import * as owner from '../security/web-auth-lifecycle-owner-adapter';
import { createLocalProviderOnboardingService } from '../ai-providers/fabric/local-provider-onboarding-service';
import { createLocalProviderBindingReader, HOST_LOCAL_PROVIDER_SETTING_KEYS } from '../ai-providers/local-provider-binding-reader';
import { saveLocalOllamaBinding } from './use-ai-settings-controller';

test('il salvataggio ordinario persiste il provider Ollama esplicito richiesto dall onboarding', async () => {
    const settings = new Map<string, string>();
    const store = { put: async ({ key, value }: { key: string; value: string }) => { settings.set(key, value); return key; } };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-ai-settings-save-'));
    const database = new Database(path.join(root, 'medical.db'));
    database.exec('CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const control = owner.bootstrapControl()!;
    const attempt = owner.begin('login', { controlId: control.controlId, ifMatch: control.etag, idempotencyKey: `settings-${path.basename(root)}` })!;
    // @Codex: use the run-specific synthetic identity, as in the canonical onboarding fixture.
    const issued = owner.issue(attempt, { id: 'synthetic-operator', username: path.basename(root), role: 'user' })!;
    const active = owner.resolve(issued.sessionId, control.controlId);
    assert.equal(active.status, 'active');
    if (active.status !== 'active') throw new Error('synthetic owner unavailable');
    const service = createLocalProviderOnboardingService({
        appDataDir: root,
        authenticate: async () => active.projection,
        immediate: operation => database.transaction(operation).immediate(),
        readSettings: () => Object.fromEntries(settings),
    });

    try {
        const missing = await service.inspect();
        assert.equal(missing.state, 'configuration_missing');
        assert.equal(missing.canActivate, false);

        await saveLocalOllamaBinding({
            model_clinical: 'qwen3.5:35b-a3b',
            model_reasoning: 'qwen3.5:35b-a3b',
            url: 'http://127.0.0.1:11434/v1',
        }, store);

        assert.deepEqual(Object.fromEntries(settings), {
            aiProvider: 'ollama',
            aiModel_clinical: 'qwen3.5:35b-a3b',
            aiModel_reasoning: 'qwen3.5:35b-a3b',
            aiModel: 'qwen3.5:35b-a3b',
            aiUrl: 'http://127.0.0.1:11434/v1',
            ollamaUrl: 'http://127.0.0.1:11434/v1',
        });
        const configured = await service.inspect();
        assert.equal(configured.state, 'missing');
        assert.equal(configured.canActivate, true);
        assert.equal(configured.inference, 'not_run');
        assert.equal(configured.qualification, 'not_assessed');

        const binding = await createLocalProviderBindingReader({
            readSettings: async () => Object.fromEntries(HOST_LOCAL_PROVIDER_SETTING_KEYS.flatMap(key => {
                const value = settings.get(key);
                return value === undefined ? [] : [[key, value]];
            })),
        }).readClinical();
        assert.equal(binding.status, 'available', JSON.stringify(binding));
        if (binding.status === 'available') {
            assert.equal(binding.resolution.receipt.provider, 'ollama');
            assert.equal(binding.resolution.receipt.model, 'qwen3.5:35b-a3b');
        }
    } finally {
        owner.retireForUser(active.projection);
        database.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
