/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');

test('roots Treatment Reasoning in authenticated selection, scoped revision, ATHENA lifecycle, and local runtime', () => {
    const root = source('./treatment-reasoning-production-root.ts');
    assert.match(root, /^import 'server-only';/u);
    for (const required of [
        'createTreatmentReasoningAuthenticatedProjectionBroker',
        'acquireAuthenticatedWebSessionProjectionOwnerContext',
        'registerServerSessionResource',
        'patientsToAmbulatories',
        "createHostProviderLifecycleService({ provider: 'athena_mlx' })",
        'isAthenaMlxModelAvailable',
        'generateWithAthenaMlx',
        'AI_TREATMENT_REASONING_KILL_SWITCH_KEY',
        'createTreatmentReasoningProductionService',
    ]) assert.match(root, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.doesNotMatch(root, /requireSession|generatePatientTreatmentReasoningDraft|callerPrompt|providerChoice|fetch\(|apply|persist/u);
});

test('exposes only the new authenticated ingest and preview routes', () => {
    const ingest = source('../../../app/api/ai/treatment-reasoning/ingest/route.ts');
    const preview = source('../../../app/api/ai/treatment-reasoning/preview/route.ts');
    assert.match(ingest, /createTreatmentReasoningIngestHttpHandler/u);
    assert.match(preview, /createTreatmentReasoningPreviewHttpHandler/u);
    assert.match(`${ingest}\n${preview}`, /treatment-reasoning-production-root/u);
    assert.doesNotMatch(`${ingest}\n${preview}`, /request\.json|requireSession|generateWithAthenaMlx|prompt|\bprovider\b|apply/u);
});
