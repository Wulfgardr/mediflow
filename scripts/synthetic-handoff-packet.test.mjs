/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildSyntheticHandoffPacket, PacketRejected } from './synthetic-handoff-packet.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(here, 'fixtures/handoff-packet-synthetic.json'), 'utf8'));
const copy = () => structuredClone(fixture);
function refusal(input, code) {
  let caught;
  try { buildSyntheticHandoffPacket(input); } catch (error) { caught = error; }
  assert.ok(caught instanceof PacketRejected);
  assert.equal(caught.code, code);
  assert.equal(caught.message, `PACKET_REJECTED:${code}`);
  assert.doesNotMatch(caught.message, /Ipertensione|ramipril|Allergie/u);
}

test('review-required packet links each claim to exact selected source and exposes candidate mapping only', () => {
  const input = copy();
  const before = JSON.stringify(input);
  const packet = buildSyntheticHandoffPacket(input);
  assert.equal(JSON.stringify(input), before);
  assert.ok(Object.isFrozen(packet));
  assert.ok(Object.isFrozen(packet.claims[0].provenance));
  assert.equal(packet.reviewRequired, true);
  assert.equal(packet.authority, 'derivative_proposal_only_no_send_or_commit');
  assert.equal(packet.intendedRecipient.id, 'synthetic-recipient-a');
  assert.equal(packet.selection.selectedCount, 6);
  assert.equal(packet.allergyInformationStatus, 'unknown');
  for (const claim of packet.claims) {
    const source = input.sources.find((row) => row.id === claim.provenance.sourceId);
    assert.equal(claim.text, source.exactQuote);
    assert.equal(claim.provenance.subjectId, packet.patient.id);
    assert.equal(claim.provenance.date, source.date);
    assert.equal(claim.provenance.version, source.version);
    assert.equal(claim.provenance.reviewStatus, 'reviewed');
  }
  assert.ok(packet.claims.some((claim) => claim.category === 'medication' && claim.state === 'historical'));
  assert.ok(packet.claims.some((claim) => claim.category === 'medication' && claim.state === 'current'));
  assert.equal(packet.ipsCandidate.conformance, 'not_claimed');
  assert.equal(packet.ipsCandidate.sections.find((section) => section.category === 'allergyInformation').resourceCandidate, null);
  assert.equal(packet.ipsCandidate.sections.every((section) => section.coding === null), true);
  assert.equal(packet.resourceType, undefined);
});

test('selection excludes an unchosen historical medication without changing its status', () => {
  const input = copy();
  input.request.selectedSourceIds = input.request.selectedSourceIds.filter((id) => id !== 'synthetic-source-med-history');
  delete input.request.expectedVersions['synthetic-source-med-history'];
  const packet = buildSyntheticHandoffPacket(input);
  assert.equal(packet.selection.excludedCount, 1);
  assert.equal(packet.claims.some((claim) => claim.state === 'historical'), false);
  assert.equal(packet.claims.filter((claim) => claim.category === 'medication').length, 1);
});

test('unknown and explicitly absent allergy information stay distinct', () => {
  const input = copy();
  const allergy = input.sources.find((source) => source.category === 'allergyInformation');
  allergy.state = 'explicitlyAbsent';
  allergy.exactQuote = 'Nessuna allergia riferita nella revisione sintetica.';
  const packet = buildSyntheticHandoffPacket(input);
  assert.equal(packet.allergyInformationStatus, 'explicitlyAbsent');
  assert.equal(packet.claims.find((claim) => claim.category === 'allergyInformation').text, allergy.exactQuote);
});

test('wrong patient and mixed-subject sources fail without disclosed content', () => {
  const input = copy();
  input.request.patientId = 'synthetic-patient-b';
  refusal(input, 'WRONG_PATIENT');
  input.request.patientId = input.patient.id;
  input.sources[0].subjectId = 'synthetic-patient-b';
  refusal(input, 'MIXED_SUBJECT');
});

test('stale patient/source versions and future source fail closed', () => {
  const input = copy();
  input.patient.version += 1;
  refusal(input, 'STALE_PATIENT');
  input.patient.version -= 1;
  input.sources[0].version += 1;
  refusal(input, 'STALE_SOURCE');
  input.sources[0].version -= 1;
  input.sources[0].date = '2026-09-21';
  refusal(input, 'FUTURE_SOURCE');
});

test('missing provenance or selected source not reviewed fails closed', () => {
  const input = copy();
  input.sources[0].exactQuote = '';
  refusal(input, 'MISSING_PROVENANCE');
  input.sources[0].exactQuote = fixture.sources[0].exactQuote;
  input.sources[0].reviewStatus = 'unreviewed';
  refusal(input, 'UNREVIEWED_SOURCE');
});

test('recipient/purpose and minimum selected categories are required', () => {
  const input = copy();
  input.request.recipient.label = '';
  refusal(input, 'MISSING_RECIPIENT');
  input.request.recipient.label = 'Medico destinatario dimostrativo';
  input.request.purpose = '';
  refusal(input, 'MISSING_PURPOSE');
  input.request.purpose = fixture.request.purpose;
  input.request.selectedSourceIds = input.request.selectedSourceIds.filter((id) => id !== 'synthetic-source-allergy');
  delete input.request.expectedVersions['synthetic-source-allergy'];
  refusal(input, 'INCOMPLETE_MINIMUM_PACKET');
});

test('historical-only current context and two allergy statuses are not silently resolved', () => {
  const input = copy();
  input.sources.find((source) => source.id === 'synthetic-source-med-current').state = 'historical';
  refusal(input, 'INCOMPLETE_CURRENT_CONTEXT');
  input.sources.find((source) => source.id === 'synthetic-source-med-current').state = 'current';
  const second = structuredClone(input.sources.find((source) => source.category === 'allergyInformation'));
  second.id = 'synthetic-source-allergy-second';
  second.state = 'explicitlyAbsent';
  input.sources.push(second);
  input.request.selectedSourceIds.push(second.id);
  input.request.expectedVersions[second.id] = second.version;
  refusal(input, 'AMBIGUOUS_ALLERGY_STATUS');
});

test('CLI reads only bundled fixture; rejects paths with no packet disclosure', () => {
  const script = resolve(here, 'synthetic-handoff-packet.mjs');
  const good = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).reviewRequired, true);
  const bad = spawnSync(process.execPath, [script, '/tmp/patient.db'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.equal(bad.stdout, '');
  assert.match(bad.stderr, /^PACKET_REJECTED:CLI_ARGUMENTS_NOT_ALLOWED\n$/u);
});
