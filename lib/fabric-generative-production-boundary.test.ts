/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativeUrl: string): string {
    return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

test('production consumers do not invoke legacy generative write paths', () => {
    const consumers = [
        source('../components/patient-entry-composer.tsx'),
        source('../components/document-insights-panel.tsx'),
        source('../components/patient-smart-import-fabric-preview-card.tsx'),
        source('../components/document-upload.tsx'),
        source('../components/treatment-reasoning-panel.tsx'),
    ];

    for (const consumer of consumers) {
        assert.doesNotMatch(
            consumer,
            /refreshPatientSummaryIfEnabled|generatePatientTreatmentReasoningDraft|synthesizeDocument/u,
        );
    }
});

test('the frozen generative catalog points at the authenticated preview routes', () => {
    const catalog = source('./ai-providers/fabric/generative-catalog.ts');

    assert.doesNotMatch(
        catalog,
        /'lib\/ai-summary-service\.ts'|'lib\/domain\/documents\/document-synthesis-service\.ts'|'lib\/treatment-reasoning-service\.ts'/u,
    );
});

test('Smart Import renders its Fabric receipt and provenance without an apply seam', () => {
    const card = source('../components/patient-smart-import-fabric-preview-card.tsx');

    assert.doesNotMatch(card, /\bdb\.|\bapply\w*\s*\(/u);
});
