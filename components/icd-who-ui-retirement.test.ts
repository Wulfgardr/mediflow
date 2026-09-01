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
