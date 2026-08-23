/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('keeps the Fabric preview card inert, review-only, and outside legacy authority', () => {
    const source = readFileSync(new URL('./patient-smart-import-fabric-preview-card.tsx', import.meta.url), 'utf8');
    assert.match(source, /Carica contesto/u); assert.match(source, /Genera anteprima \(sola lettura\)/u); assert.match(source, /0 scritture/u);
    assert.doesNotMatch(source, /patient-smart-import-service|\bapply\b|\bdb\b|AIService|provider|\/api\//u);
});
