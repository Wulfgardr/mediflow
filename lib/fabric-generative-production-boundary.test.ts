/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativeUrl: string): string {
    return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

test('production consumers do not invoke legacy generative write paths', () => {
    const consumers = [
        source('../app/patients/[id]/entries/new/page.tsx'),
        source('../components/document-insights-panel.tsx'),
        source('./domain/documents/patient-smart-import-service.ts'),
        source('../components/document-upload.tsx'),
        source('../components/pdf-importer.tsx'),
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

    for (const route of [
        'app/api/ai/patient-insight/preview/route.ts',
        'app/api/ai/smart-import/preview/route.ts',
        'app/api/ai/document-synthesis/preview/route.ts',
        'app/api/ai/treatment-reasoning/preview/route.ts',
    ]) {
        assert.match(catalog, new RegExp(route.replaceAll('.', '\\.'), 'u'));
    }
    assert.doesNotMatch(
        catalog,
        /'lib\/ai-summary-service\.ts'|'lib\/domain\/documents\/document-synthesis-service\.ts'|'lib\/treatment-reasoning-service\.ts'/u,
    );
});

test('Smart Import renders its Fabric receipt and provenance without an apply seam', () => {
    const card = source('../components/patient-smart-import-fabric-preview-card.tsx');

    assert.match(card, /preview\.receipt/u);
    assert.match(card, /preview\.provenance/u);
    assert.match(card, /preview\.reviewRef/u);
    assert.doesNotMatch(card, /\bdb\.|\bapply\w*\s*\(/u);
});
