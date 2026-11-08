import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('keeps the Fabric preview card phase-fenced, review-only, and outside legacy authority', () => {
    const source = readFileSync(new URL('./patient-smart-import-fabric-preview-card.tsx', import.meta.url), 'utf8');
    assert.match(source, /useState\(\(\) => createSmartImportReviewBrowserController\(\{ fetch: picker\.client\.fetch \}\)\)/u);    /* Provider is receipt disclosure, never caller authority or runtime
       configuration on this component boundary. */
    assert.doesNotMatch(source, /patient-smart-import-service|\bapply\b|\bdb\b|AIService|providerOverride|providerId|endpoint|\/api\//u);
});
