/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { patientRightsDryRun } from './patient-rights-dry-run.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/patient-rights-synthetic.json', import.meta.url), 'utf8'));
const access = () => fixture().cases[0].input;
const correction = () => fixture().cases[1].input;

test('access review returns only selected fields with exact source and version', () => {
  const result = patientRightsDryRun(access());
  assert.equal(result.status, 'DRY_RUN_ONLY');
  assert.deepEqual(result.selectedFields.map((field) => field.name), ['displayName', 'allergyDataStatus']);
  assert.equal(result.selectedFields[0].sourceRef, 'synthetic-form-1');
  assert.equal(result.version, 4, 'patient version remains distinct');
  assert.equal(result.selectedFields[0].sourceVersion, 1);
  assert.equal(result.selectedFields[0].sourceDate, '2026-01-10');
  assert.equal(JSON.stringify(result).includes('familyNote'), false);
  assert.equal(result.reviewRequired, true);
});

test('correction is a proposal preserving the original value and source', () => {
  const input = correction();
  const before = structuredClone(input);
  const result = patientRightsDryRun(input);
  assert.equal(result.status, 'DRY_RUN_ONLY');
  assert.equal(result.correction.action, 'proposal_only_preserve_original');
  assert.deepEqual(result.correction.original, {
    name: 'displayName', value: 'Soggeto sintetico A', sourceRef: 'synthetic-form-1',
    sourceSubjectRef: 'synthetic-A', sourceVersion: 1, sourceDate: '2026-01-10',
  });
  assert.equal(result.correction.proposedValue, 'Soggetto sintetico A');
  assert.equal(result.correction.proposalEvidenceRef, 'synthetic-correction-1');
  assert.equal(result.correction.proposalSourceVersion, 1);
  assert.equal(result.correction.proposalSourceDate, '2026-03-12');
  assert.deepEqual(input, before, 'dry-run must not mutate its source');
});

test('wrong patient and insufficient synthetic authority deny without disclosing fields', () => {
  for (const change of [
    (input) => { input.request.patientRef = 'synthetic-B'; },
    (input) => { input.actor.patientRef = 'synthetic-B'; },
    (input) => { input.actor.authority = 'synthetic_access_reviewer'; },
  ]) {
    const input = correction(); change(input);
    assert.deepEqual(patientRightsDryRun(input), { status: 'DENIED', code: 'scope_or_authority_unavailable' });
  }
});

test('undefined policy, stale version, cancellation and mixed subject hold without disclosure', () => {
  const scenarios = [
    [(input) => { delete input.policy; }, 'policy_undefined'],
    [(input) => { input.request.expectedVersion = 3; }, 'stale_version'],
    [(input) => { input.request.cancelled = true; }, 'cancelled'],
    [(input) => { input.snapshot.mixedSubject = true; }, 'mixed_subject'],
  ];
  for (const [change, code] of scenarios) {
    const input = access(); change(input);
    assert.deepEqual(patientRightsDryRun(input), { status: 'HOLD', code });
  }
});

test('protected third-party and cross-subject sources never reach a summary', () => {
  const thirdParty = access();
  thirdParty.policy.allowedFields.push('familyNote');
  thirdParty.request.fields = ['familyNote'];
  assert.deepEqual(patientRightsDryRun(thirdParty), { status: 'HOLD', code: 'protected_third_party' });

  const mixed = access();
  mixed.snapshot.sources['synthetic-form-1'].subjectRef = 'synthetic-B';
  assert.deepEqual(patientRightsDryRun(mixed), { status: 'HOLD', code: 'mixed_subject' });
});

test('correction rejects forged source, field scope and malformed proposal without disclosure', () => {
  const wrongSource = correction();
  wrongSource.request.correction.evidenceRef = 'synthetic-family-1';
  assert.deepEqual(patientRightsDryRun(wrongSource), { status: 'HOLD', code: 'source_unavailable' });

  const wrongField = correction();
  wrongField.request.fields = ['allergyDataStatus'];
  assert.deepEqual(patientRightsDryRun(wrongField), { status: 'HOLD', code: 'field_out_of_scope' });

  const malformed = correction();
  malformed.request.correction.proposedValue = '';
  assert.deepEqual(patientRightsDryRun(malformed), { status: 'HOLD', code: 'invalid_synthetic_input' });
});

test('source version and date are checked separately from patient version', () => {
  const staleSelected = access();
  staleSelected.request.expectedSourceVersions['synthetic-note-1'] = 1;
  assert.deepEqual(patientRightsDryRun(staleSelected), { status: 'HOLD', code: 'stale_source' });

  const missingSelected = access();
  delete missingSelected.snapshot.sources['synthetic-form-1'].date;
  assert.deepEqual(patientRightsDryRun(missingSelected), { status: 'HOLD', code: 'source_metadata_unavailable' });

  const staleCorrection = correction();
  delete staleCorrection.request.expectedSourceVersions['synthetic-correction-1'];
  assert.deepEqual(patientRightsDryRun(staleCorrection), { status: 'HOLD', code: 'stale_source' });

  const missingCorrection = correction();
  delete missingCorrection.snapshot.sources['synthetic-correction-1'].version;
  assert.deepEqual(patientRightsDryRun(missingCorrection), { status: 'HOLD', code: 'source_metadata_unavailable' });
});

test('missing third-party flag on correction evidence fails closed', () => {
  const input = correction();
  delete input.snapshot.sources['synthetic-correction-1'].protectedThirdParty;
  assert.deepEqual(patientRightsDryRun(input), { status: 'HOLD', code: 'source_unavailable' });
});

test('CLI refuses file arguments instead of implying arbitrary input is accepted', () => {
  const run = spawnSync(process.execPath, [new URL('./patient-rights-dry-run.mjs', import.meta.url).pathname,
    '/tmp/another-corpus.json'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /arguments are not supported/u);
});
