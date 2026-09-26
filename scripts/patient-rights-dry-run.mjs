#!/usr/bin/env node
/* @Codex: synthetic contract exploration only; no database, auth, export or clinical write. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const hold = (code) => Object.freeze({ status: 'HOLD', code });
const denied = () => Object.freeze({ status: 'DENIED', code: 'scope_or_authority_unavailable' });
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const ref = (value) => typeof value === 'string' && /^synthetic-[A-Za-z0-9-]+$/u.test(value);
const fields = (value) => Array.isArray(value) && value.length > 0
  && value.every((name) => typeof name === 'string' && /^[a-z][A-Za-z0-9]{0,63}$/u.test(name))
  && new Set(value).size === value.length;
const sourceDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function patientRightsDryRun(input) {
  if (!plain(input) || !plain(input.request) || !plain(input.actor) || !plain(input.snapshot))
    return hold('invalid_synthetic_input');
  const { request, actor, snapshot, policy } = input;
  if (!['access_export_review', 'correction_proposal'].includes(request.kind)
    || !ref(request.patientRef) || !fields(request.fields)
    || !Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1
    || !plain(request.expectedSourceVersions)
    || typeof request.cancelled !== 'boolean' || !ref(actor.patientRef)
    || !ref(snapshot.patientRef) || !Number.isSafeInteger(snapshot.version)
    || !plain(snapshot.fields) || !plain(snapshot.sources)
    || typeof snapshot.mixedSubject !== 'boolean') return hold('invalid_synthetic_input');
  if (request.cancelled) return hold('cancelled');
  const expectedAuthority = request.kind === 'access_export_review'
    ? 'synthetic_access_reviewer' : 'synthetic_correction_reviewer';
  if (request.patientRef !== snapshot.patientRef || actor.patientRef !== snapshot.patientRef
    || actor.authority !== expectedAuthority) return denied();
  if (!plain(policy) || policy.state !== 'defined_for_synthetic_fixture'
    || typeof policy.reference !== 'string' || !policy.reference.startsWith('synthetic-')
    || !fields(policy.allowedFields)) return hold('policy_undefined');
  if (request.expectedVersion !== snapshot.version) return hold('stale_version');
  if (snapshot.mixedSubject) return hold('mixed_subject');
  if (request.fields.some((name) => !policy.allowedFields.includes(name))) return hold('field_out_of_scope');

  const selected = [];
  for (const name of request.fields) {
    const field = Object.prototype.hasOwnProperty.call(snapshot.fields, name) ? snapshot.fields[name] : null;
    if (!plain(field) || typeof field.value !== 'string' || !ref(field.sourceRef)
      || typeof field.protectedThirdParty !== 'boolean') return hold('source_unavailable');
    const source = Object.prototype.hasOwnProperty.call(snapshot.sources, field.sourceRef)
      ? snapshot.sources[field.sourceRef] : null;
    if (!plain(source) || !ref(source.subjectRef) || typeof source.protectedThirdParty !== 'boolean')
      return hold('source_unavailable');
    if (field.protectedThirdParty || source.protectedThirdParty) return hold('protected_third_party');
    if (source.subjectRef !== snapshot.patientRef) return hold('mixed_subject');
    if (!Number.isSafeInteger(source.version) || source.version < 1 || !sourceDate(source.date))
      return hold('source_metadata_unavailable');
    if (!Object.prototype.hasOwnProperty.call(request.expectedSourceVersions, field.sourceRef)
      || request.expectedSourceVersions[field.sourceRef] !== source.version) return hold('stale_source');
    selected.push(Object.freeze({ name, value: field.value, sourceRef: field.sourceRef,
      sourceSubjectRef: source.subjectRef, sourceVersion: source.version, sourceDate: source.date }));
  }

  const base = { status: 'DRY_RUN_ONLY', kind: request.kind, reviewRequired: true,
    policyReference: policy.reference, patientRef: snapshot.patientRef, version: snapshot.version };
  if (request.kind === 'access_export_review') {
    if (request.correction !== undefined) return hold('invalid_synthetic_input');
    return Object.freeze({ ...base, selectedFields: Object.freeze(selected) });
  }
  const correction = request.correction;
  if (!plain(correction) || request.fields.length !== 1 || correction.field !== request.fields[0]
    || typeof correction.proposedValue !== 'string' || !correction.proposedValue.trim()
    || !ref(correction.evidenceRef)) return hold('invalid_synthetic_input');
  const proposalSource = Object.prototype.hasOwnProperty.call(snapshot.sources, correction.evidenceRef)
    ? snapshot.sources[correction.evidenceRef] : null;
  if (!plain(proposalSource) || !ref(proposalSource.subjectRef)
    || typeof proposalSource.protectedThirdParty !== 'boolean') return hold('source_unavailable');
  if (proposalSource.protectedThirdParty) return hold('protected_third_party');
  if (proposalSource.subjectRef !== snapshot.patientRef) return hold('mixed_subject');
  if (!Number.isSafeInteger(proposalSource.version) || proposalSource.version < 1
    || !sourceDate(proposalSource.date)) return hold('source_metadata_unavailable');
  if (!Object.prototype.hasOwnProperty.call(request.expectedSourceVersions, correction.evidenceRef)
    || request.expectedSourceVersions[correction.evidenceRef] !== proposalSource.version) return hold('stale_source');
  return Object.freeze({ ...base, correction: Object.freeze({ field: correction.field,
    original: selected[0], proposedValue: correction.proposedValue,
    proposalEvidenceRef: correction.evidenceRef, proposalSourceVersion: proposalSource.version,
    proposalSourceDate: proposalSource.date, action: 'proposal_only_preserve_original' }) });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length !== 2) {
    process.stderr.write('patient-rights-dry-run: arguments are not supported; only the bundled synthetic fixture is read\n');
    process.exit(2);
  }
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/patient-rights-synthetic.json', import.meta.url), 'utf8'));
  process.stdout.write(`${JSON.stringify({ schemaVersion: fixture.schemaVersion,
    cases: fixture.cases.map((item) => ({ id: item.id, result: patientRightsDryRun(item.input) })) }, null, 2)}\n`);
}
