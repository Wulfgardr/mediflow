import fs from 'node:fs';
import path from 'node:path';

export const UNIT_TEST_GROUPS = Object.freeze(['lib', 'components']);
export const UNIT_SCRIPT_TESTS = Object.freeze([
  // Explicit route registration; do not discover every app/** test.
  'app/api/patients/route.test.ts',
  'scripts/admin-route-auth-boundary.test.mjs',
  'scripts/check-never-regress-icd-who.test.mjs',
  'scripts/check-never-regress-ocr-retirement.test.mjs',
  'scripts/check-never-regress-tinetti-provenance.test.mjs',
  'scripts/inventory-first-party-code.test.mjs',
  'scripts/test-data-dir.test.mjs',
  'scripts/check-schema-drift.test.ts',
  'scripts/run-native-probe.test.mjs',
  'scripts/audit-quality-gate.test.mjs',
  'scripts/audit-test-config.test.mjs',
  'scripts/prosthetic-audit-guard.test.mjs',
  'scripts/service-audit-guard.test.mjs',
  'scripts/ambulatory-audit-guard.test.mjs',
  'scripts/prepare-e2e-db.test.mjs',
  'scripts/db-server-data-isolation.test.mjs',
  'scripts/native-first-install.test.mjs',
  'scripts/native-network-bounded-json.test.mjs',
  'scripts/native-network-attachment-budget.test.mjs',
  'scripts/checkup-parent-lifecycle.test.mjs',
  'scripts/checkup-parent-lifecycle-harness.test.mjs',
  'scripts/anydoc-consumer-diagnostic.test.mjs',
  'scripts/run-unit-suite.test.mjs',
  'scripts/network-catalog-smoke-cleanup.test.mjs',
  'scripts/e2e-quarantine.test.mjs',
  'scripts/run-strip-types.test.mjs',
  'scripts/check-motion-budget.test.mjs',
  'scripts/node-runtime-contract.test.mjs',
  'scripts/generate-runtime-payload-ledger.test.mjs',
  'scripts/unit-test-selection.test.mjs',
  'scripts/test-inventory.test.mjs',
  'scripts/native-decrypt-bridge-selection.test.mjs',
  'scripts/exemption-lazy-support-binding.test.mjs',
  'scripts/explicit-npm-test-selection.test.mjs',
  // Portable Node suites use the same local/CI strip-types runner.
  'scripts/anydoc-desktop-renderer-trace.test.mjs',
  'scripts/anydoc-pdf-smoke-diagnostics.test.mjs',
  'scripts/anydoc-windows-icu-preflight.test.mjs',
  'scripts/anydoc-windows-icu-text-smoke.test.mjs',
  'scripts/attachments-runtime-columns-migration.test.mjs',
  'scripts/build-apple-macos-app.test.mjs',
  'scripts/build-mobile-sim-app.test.mjs',
  'scripts/check-capability-mapping.test.mjs',
  'scripts/check-fabric-headless-plane-inventories.test.mjs',
  'scripts/check-headless-semantic-plane.test.mjs',
  'scripts/check-standalone-runtime-bundle.test.mjs',
  'scripts/check-who-local-sidecar-manifest.test.mjs',
  'scripts/icd-docker-packaging-retirement.test.mjs',
  'scripts/icd-docker-runtime-retirement.test.mjs',
  'scripts/launch-bundled-headless-supervisor.test.mjs',
  'scripts/mediflow-headless-supervisor.test.mjs',
  'scripts/patient-insight-revision-lifecycle.test.mjs',
  'scripts/patient-reference-lifecycle.test.mjs',
  'scripts/portable-supervisor-child-shutdown.test.mjs',
  'scripts/portable-supervisor-import-urls.test.mjs',
  'scripts/run-mini-desktop-acceptance.test.mjs',
  'scripts/seed-performance-baseline-currentness.test.mjs',
  'scripts/web-auth-control-test-client.test.mjs',
  'scripts/web-session-resource-reclamation.test.mjs',
  'scripts/mobile-home-base-interop-cas-relay.test.mjs',
  'scripts/mobile-home-base-interop-module-verifier.test.mjs',
  'scripts/mobile-home-base-interop-response-proxy.test.mjs',
  'scripts/mobile-home-base-interop.test.mjs',
  'scripts/who-local-loopback-transport.test.mjs',
  'scripts/who-local-onboarding-portability.test.mjs',
  'scripts/who-local-onboarding.test.mjs',
  'scripts/who-local-platform.test.mjs',
  'scripts/who-local-setup.test.mjs',
  'scripts/document-evidence-backfill-currentness-cas.test.ts',
  'scripts/local-chat-runtime.test.ts',
  'scripts/chatgpt-account/account-service.test.ts',
  'scripts/chatgpt-account/account-browser.test.ts',
  'scripts/chatgpt-account/account-session-http.test.ts',
  'scripts/chatgpt-account/account-transport.test.ts',
]);

// These two suites exercise the real fixed WHO loopback port and must not overlap.
export const UNIT_SERIAL_SCRIPT_TESTS = Object.freeze([
  'scripts/who-local-onboarding-portability.test.mjs',
  'scripts/who-local-onboarding.test.mjs',
]);

function walk(root, relative) {
  const files = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) files.push(...walk(root, child));
    else if (entry.isFile() && child.endsWith('.test.ts')) files.push(child);
  }
  return files;
}

// Shared by the real unit runner and the inventory guard. Discovery never imports tests.
export function collectUnitTestFiles(root) {
  const files = [];
  for (const group of UNIT_TEST_GROUPS) {
    let matches;
    try { matches = walk(root, group).sort(); }
    catch (cause) { throw new Error(`Cannot read required unit test group ${group}`, { cause }); }
    if (matches.length === 0) throw new Error(`Required unit test group ${group} is empty`);
    files.push(...matches);
  }
  for (const file of UNIT_SCRIPT_TESTS) {
    let stat;
    try { stat = fs.statSync(path.join(root, file)); }
    catch (cause) { throw new Error(`Cannot read required unit test file ${file}`, { cause }); }
    if (!stat.isFile()) throw new Error(`Required unit test path is not a file: ${file}`);
    files.push(file);
  }
  if (new Set(files).size !== files.length) throw new Error('Duplicate required unit test selection');
  return files;
}

export function unitTestArguments(root) {
  // Preserve the old glob expansion's absolute group paths and literal script paths.
  return ['scripts/run-strip-types.mjs', '--test', ...collectUnitTestFiles(root).map(file =>
    UNIT_TEST_GROUPS.some(group => file.startsWith(`${group}/`)) ? path.resolve(root, file) : file)];
}

export function unitTestInvocationArguments(root) {
  const args = unitTestArguments(root);
  return [args.filter(file => !UNIT_SERIAL_SCRIPT_TESTS.includes(file)),
    ...UNIT_SERIAL_SCRIPT_TESTS.map(file => ['scripts/run-strip-types.mjs', '--test', file])];
}
