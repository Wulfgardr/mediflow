import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('ICD autocomplete uses bounded public errors and contains no active Docker guidance', () => {
    const autocomplete = source('./icd-autocomplete.tsx');
    assert.doesNotMatch(autocomplete, /Docker|127\.0\.0\.1:8888|ICD_BASE_URL|API locale/iu);
});

test('diagnostic hub checks readiness only and never emits a synthetic diagnosis query', () => {
    const diagnostic = source('./diagnostic-hub.tsx');
    assert.doesNotMatch(diagnostic, /\/api\/icd\/proxy\?q=|diabete|Docker|API locali/iu);
});

test('service architecture and catalog surfaces describe the governed WHO boundary', () => {
    const architecture = source('./service-architecture-panel.tsx');
    assert.doesNotMatch(architecture, /Docker|8888|\?uri=|docker compose|env:\s*['"]docker['"]/iu);

    const catalogs = source('./kree8/areas/repertori-area.tsx');
    assert.doesNotMatch(catalogs, /ICD-11 locale|porta 8888|gestito dal launcher/iu);
});

test('document upload E2E saves the source without WHO or automatic provider requests', () => {
    const documentImport = source('../e2e/document-import.spec.ts');
    assert.doesNotMatch(
        documentImport,
        /mediflow\.reference-data\.icd11-search-(?:response|receipt)\.v1|destinationEntities|theCode/u,
    );
});
