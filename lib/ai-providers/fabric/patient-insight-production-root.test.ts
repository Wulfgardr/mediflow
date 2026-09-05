/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('roots the production consumer only in the authenticated proposal-only Patient Insight route', () => {
    const component = source('components/ai-patient-insight.tsx');
    const route = source('app/api/ai/patient-insight/preview/route.ts');
    const production = source('lib/ai-providers/fabric/patient-insight-authenticated-preview-production.ts');
    const legacy = source('lib/ai-summary-service.ts');

    assert.doesNotMatch(component, /ai-summary-service|regeneratePatientSummary|db\.patients\.update|autoRefresh|scheduleRefresh/u);
    assert.match(component, /\/api\/ai\/patient-insight\/preview/u);
    assert.match(component, /buildPatientInsightPreviewRequest|parsePatientInsightPreviewWireRoot/u);
    assert.match(component, /writesPerformed/u); assert.match(component, /reviewOnly/u);
    assert.match(route, /acquireAuthenticatedPatientInsightPreview|createPatientInsightPreviewHttpHandler/u);
    assert.match(production, /acquireAuthenticatedWebSessionProjectionOwnerContext/u);
    assert.match(production, /createHostProviderLifecycleService|createHostLocalProviderBindingService|observeClinical|routeHostResolvedCandidateCapability/u);
    assert.match(production, /AI_PATIENT_INSIGHT_KILL_SWITCH_KEY/u);
    assert.doesNotMatch(production, /update\(|insert\(|delete\(|aiSummary/u);
    assert.match(legacy, /db\.patients\.update/u, 'the legacy module remains identifiable but unreachable from the production consumer');
});
