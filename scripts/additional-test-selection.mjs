import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export function collectChatgptFocusedTests(root, { browserOnly = false, browser = false, loopbackProxy = false } = {}) {
const tests = [];
if (browserOnly) {
    tests.push('e2e/chatgpt-synthesis-product.spec.ts', 'lib/chatgpt-account/account-product.browser.test.mjs');
} else {
    for (const folder of ['lib/chatgpt-product', 'lib/chatgpt-account', 'lib/chatgpt-execution']) {
        for (const entry of readdirSync(join(root, folder)).sort()) {
            if (!entry.endsWith('.test.ts') && !entry.endsWith('.test.cjs')) continue;
            if (entry === 'execution-egress-proxy.test.ts' && !loopbackProxy) continue;
            tests.push(`${folder}/${entry}`);
        }
    }
    tests.push('lib/security/native-inference.test.cjs', 'lib/security/native-ordinary-content.test.cjs', 'lib/security/native-ordinary-host-sources.test.cjs');
    tests.push('lib/ai-providers/fabric/chatgpt-synthetic-synthesis-binding.test.ts', 'components/settings/chatgpt-synthesis-panel.test.ts');
    if (browser) tests.push('e2e/chatgpt-synthesis-product.spec.ts', 'lib/chatgpt-account/account-product.browser.test.mjs');
}
return tests;
}

export const PROTOTYPE_TEST_FILES = Object.freeze([
  'scripts/patient-rights-dry-run.test.mjs',
  'prototypes/longitudinal-review/model.test.mjs',
  'scripts/synthetic-followup-projection.test.mjs',
  'lib/domain/documents/document-quality-corpus.test.mjs',
  'scripts/verify-fhir-validator-cache.test.mjs',
  'scripts/synthetic-handoff-packet.test.mjs',
  'scripts/synthetic-cohort-analysis.test.mjs',
]);

export const SOFT_DELETE_TS_FILES = Object.freeze([
    'lib/patient-lifecycle.test.ts',
    'lib/patient-cascade.test.ts',
    'lib/test-container-clear.test.ts',
]);

export const SOFT_DELETE_ROUTE_FILES = Object.freeze([
    'scripts/patient-soft-delete.test.mjs',
    'scripts/patient-cascade.test.mjs',
]);

export const UI06_DOMAIN_FILES = Object.freeze(['tests/ui06/scale-behavior.test.ts', 'tests/ui06/workspace-counters.test.ts', 'lib/patient-workspace.test.ts']);

export const SOAP_CHILD_FILES = Object.freeze({
  attach: 'lib/security/headless-soap-active-role-session-grant-attach-failure-fixture.ts',
  rejection: 'lib/security/headless-soap-active-role-session-grant-rejection-fixture.ts',
});
export function soapChildArguments(kind) {
  if (!Object.hasOwn(SOAP_CHILD_FILES, kind)) throw new Error('Unknown SOAP child');
  return ['scripts/run-strip-types.mjs', SOAP_CHILD_FILES[kind]];
}
