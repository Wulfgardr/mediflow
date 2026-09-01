/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('keeps the Fabric preview card phase-fenced, review-only, and outside legacy authority', () => {
    const source = readFileSync(new URL('./patient-smart-import-fabric-preview-card.tsx', import.meta.url), 'utf8');
    assert.match(source, /useState\(\(\) => createSmartImportReviewBrowserController\(\)\)/u); assert.match(source, /'idle' \| 'loading' \| 'confirm' \| 'running' \| 'terminal'/u);
    assert.match(source, /Carica contesto/u); assert.match(source, /Genera anteprima \(sola lettura\)/u); assert.match(source, /Reset anteprima/u); assert.match(source, /generation\.current/u);
    /* @Codex Provider is receipt disclosure, never caller authority or runtime
       configuration on this component boundary. */
    assert.match(source, /preview\.receipt\.provider/u);
    assert.doesNotMatch(source, /patient-smart-import-service|\bapply\b|\bdb\b|AIService|providerOverride|providerId|endpoint|\/api\//u);
});
