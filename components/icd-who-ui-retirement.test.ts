/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('ICD autocomplete uses bounded public errors and contains no active Docker guidance', () => {
    const autocomplete = source('./icd-autocomplete.tsx');
    assert.match(autocomplete, /icdClientErrorMessage/u);
    assert.match(autocomplete, /catch\(\(error\)/u);
    assert.doesNotMatch(autocomplete, /Docker|127\.0\.0\.1:8888|ICD_BASE_URL|API locale/iu);
});

test('diagnostic hub checks readiness only and never emits a synthetic diagnosis query', () => {
    const diagnostic = source('./diagnostic-hub.tsx');
    assert.match(diagnostic, /getICDReadiness/u);
    assert.match(diagnostic, /icdReadinessMessage/u);
    assert.match(diagnostic, /status\s*!==\s*['"]available['"]/u);
    assert.doesNotMatch(diagnostic, /\/api\/icd\/proxy\?q=|diabete|Docker|API locali/iu);
});

test('service architecture and catalog surfaces describe the governed WHO boundary', () => {
    const architecture = source('./service-architecture-panel.tsx');
    assert.match(architecture, /getICDReadiness/u);
    assert.match(architecture, /icdReadinessMessage/u);
    assert.doesNotMatch(architecture, /Docker|8888|\?uri=|docker compose|env:\s*['"]docker['"]/iu);

    const catalogs = source('./kree8/areas/repertori-area.tsx');
    assert.match(catalogs, /ICD-11 WHO/u);
    assert.match(catalogs, /readiness governata/u);
    assert.doesNotMatch(catalogs, /ICD-11 locale|porta 8888|gestito dal launcher/iu);
});

test('document import E2E mocks the exact MediFlow WHO envelope and no raw provider payload', () => {
    const documentImport = source('../e2e/document-import.spec.ts');
    assert.match(documentImport, /schemaVersion:\s*['"]mediflow\.reference-data\.icd11-search-response\.v1['"]/u);
    assert.match(documentImport, /entries:\s*\[/u);
    assert.match(documentImport, /code:\s*['"]5A11['"]/u);
    assert.match(documentImport, /description:\s*diagnosisLabel/u);
    assert.match(documentImport, /system:\s*['"]ICD-11['"]/u);
    assert.match(documentImport, /schemaVersion:\s*['"]mediflow\.reference-data\.icd11-search-receipt\.v1['"]/u);
    assert.match(documentImport, /operation:\s*['"]mediflow\.reference_data\.icd11\.search\.v1['"]/u);
    assert.match(documentImport, /releaseId:\s*['"]2026-01['"]/u);
    assert.match(documentImport, /language:\s*['"]en['"]/u);
    assert.match(documentImport, /source:\s*['"]live['"]/u);
    assert.match(documentImport, /resultCount:\s*1/u);
    assert.match(documentImport, /latencyMs:\s*\d+/u);
    assert.match(documentImport, /completedAt:\s*['"][^'"]+['"]/u);
    assert.doesNotMatch(documentImport, /destinationEntities|theCode/u);
});
