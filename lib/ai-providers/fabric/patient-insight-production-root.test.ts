import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('roots the production consumer only in the authenticated proposal-only Patient Insight route', () => {
    const component = source('components/ai-patient-insight.tsx');
    const production = source('lib/ai-providers/fabric/patient-insight-authenticated-preview-production.ts');

    assert.doesNotMatch(component, /ai-summary-service|regeneratePatientSummary|db\.patients\.update|autoRefresh|scheduleRefresh/u);
    assert.match(production, /AI_PATIENT_INSIGHT_KILL_SWITCH_KEY/u);
    assert.doesNotMatch(production, /update\(|insert\(|delete\(|aiSummary/u);
});
