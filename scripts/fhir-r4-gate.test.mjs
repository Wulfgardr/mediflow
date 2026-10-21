import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBaseProfiles, readOutcomes, assessIssues } from './fhir-r4-outcomes.mjs';
import { isNetworkDenial } from './fhir-validator-offline.mjs';
import { assertJavaVersion } from './validate-fhir-r4.mjs';

const artifacts = [{ id: 'synthetic', file: 'synthetic.json' }];
const issue = { severity: 'warning', identifier: 'UNKNOWN_EXTENSION', path: 'Bundle.entry[0].resource.extension[0]', message: 'Unknown synthetic extension' };
const baseline = { entries: [{ artifact: 'synthetic', ...issue, count: 1, reason: 'Synthetic test of reviewed exception' }] };
const results = issues => new Map([['synthetic.json', issues]]);
const outcome = { resourceType: 'Bundle', entry: [{ resource: {
  resourceType: 'OperationOutcome', extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/operationoutcome-file', valueString: '/synthetic/synthetic.json' }],
  issue: [{ severity: 'warning', code: 'invalid', details: { text: issue.message }, expression: [issue.path], extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/operationoutcome-message-id', valueCode: issue.identifier }] }],
} }] };

test('OperationOutcome issues, rather than process exit code, drive the result', () => {
  assert.deepEqual(readOutcomes(outcome, artifacts).get('synthetic.json'), [issue]);
  assert.equal(assessIssues(artifacts, results([issue]), { entries: [] }).passed, false);
  assert.equal(assessIssues(artifacts, results([{ ...issue, severity: 'error' }]), baseline).passed, false);
});
test('baseline is exact for artifact, severity, identifier, path, message and occurrence count', () => {
  assert.equal(assessIssues(artifacts, results([issue]), baseline).passed, true);
  for (const change of [{ severity: 'fatal' }, { path: 'Bundle.entry[1]' }, { message: 'Different warning' }, { identifier: 'OTHER' }]) {
    assert.equal(assessIssues(artifacts, results([{ ...issue, ...change }]), baseline).passed, false);
  }
  const duplicate = assessIssues(artifacts, results([issue, issue]), baseline);
  assert.equal(duplicate.new[0].count, 1);
  const stale = assessIssues(artifacts, results([]), baseline);
  assert.equal(stale.stale[0].action, 'REMOVE_FROM_BASELINE');
  assert.equal(stale.passed, false);
  assert.throws(() => assessIssues(artifacts, results([]), { entries: [{ ...baseline.entries[0], reason: '' }] }), /INVALID_REVIEWED_BASELINE/);
});
test('missing, duplicate or malformed outcomes are tool failures', () => {
  assert.throws(() => readOutcomes({ resourceType: 'OperationOutcome', issue: [] }, artifacts), /TOOL_OUTCOME_BUNDLE_REQUIRED/);
  assert.throws(() => readOutcomes({ resourceType: 'Bundle', entry: [] }, artifacts), /TOOL_MISSING_OUTCOME/);
  assert.throws(() => readOutcomes({ ...outcome, entry: [...outcome.entry, ...outcome.entry] }, artifacts), /TOOL_OUTCOME_SOURCE_MISMATCH/);
  const malformed = structuredClone(outcome); malformed.entry[0].resource.issue[0].severity = 'maybe';
  assert.throws(() => readOutcomes(malformed, artifacts), /TOOL_INVALID_ISSUE/);
  const foreign = structuredClone(outcome); foreign.entry[0].resource.extension[0].valueString = '/unexpected.json';
  assert.throws(() => readOutcomes(foreign, artifacts), /TOOL_OUTCOME_SOURCE_MISMATCH/);
});
test('unsupported profile claims, including IPS on a collection, are refused before validation', () => {
  assertBaseProfiles({ resourceType: 'Bundle', type: 'collection' });
  assertBaseProfiles({ resourceType: 'Patient', meta: { profile: ['http://hl7.org/fhir/StructureDefinition/Patient'] } });
  assert.throws(() => assertBaseProfiles({ resourceType: 'Bundle', type: 'collection', meta: { profile: ['http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-uv-ips'] } }), /UNLOCKED_PROFILE_CLAIM/);
  assert.throws(() => assertBaseProfiles({ resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', meta: { profile: ['http://synthetic.invalid/profile'] } } }] }), /UNLOCKED_PROFILE_CLAIM/);
});
test('Java must match the lock; local explicit override is never honored in CI', () => {
  assert.equal(assertJavaVersion('openjdk version "17.0.1"', { javaMajor: 17 }, {}).mismatchOverride, false);
  assert.throws(() => assertJavaVersion('openjdk version "25.0.2"', { javaMajor: 17 }, {}), /JAVA_LOCK_MISMATCH/);
  assert.equal(assertJavaVersion('openjdk version "25.0.2"', { javaMajor: 17 }, { MEDIFLOW_FHIR_ALLOW_JAVA_MISMATCH: '1' }).mismatchOverride, true);
  assert.throws(() => assertJavaVersion('openjdk version "25.0.2"', { javaMajor: 17 }, { CI: 'true', MEDIFLOW_FHIR_ALLOW_JAVA_MISMATCH: '1' }), /JAVA_LOCK_MISMATCH/);
});

test('network probes reject ambiguous failure and accept absent IPv6 only in a Linux namespace', () => {
  for (const platform of ['linux', 'darwin']) {
    for (const code of ['TIMEOUT', 'CONNECTED', 'ECONNREFUSED', 'ENOTFOUND']) assert.equal(isNetworkDenial(code, '::1', platform), false);
    assert.equal(isNetworkDenial('EPERM', '1.1.1.1', platform), true);
  }
  assert.equal(isNetworkDenial('EADDRNOTAVAIL', '::1', 'linux'), true);
  assert.equal(isNetworkDenial('EADDRNOTAVAIL', '1.1.1.1', 'linux'), false);
  assert.equal(isNetworkDenial('EADDRNOTAVAIL', '::1', 'darwin'), false);
});
