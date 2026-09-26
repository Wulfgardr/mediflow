/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectSyntheticFollowup } from './synthetic-followup-projection.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/followup-synthetic.json', import.meta.url), 'utf8'));
const event = (input, stage, id, at, sourceRef) => {
  input.expectedSourceVersions[sourceRef] = 1;
  input.events.push({ eventId: id, stage, occurredAt: at, ownerRef: input.ownership.ownerRef,
    source: { ref: sourceRef, subjectRef: input.patientRef, date: at, version: 1 } });
};

test('projects source evidence without inferring performed or reviewed from overdue and dismissal', () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = projectSyntheticFollowup(input);
  assert.equal(result.status, 'PROPOSAL_ONLY');
  assert.equal(result.highestEvidencedStage, 'result_received');
  assert.deepEqual(result.missingEvidence, []);
  assert.equal(result.closed, false);
  assert.equal(result.overdue, true);
  assert.equal(result.reminderDismissed, true);
  assert.equal(result.proposal.requestEvidenceFor, 'reviewed');
  assert.equal(result.proposal.apply, false);
  assert.deepEqual(input, before);
});

test('missing performed evidence stays missing even after a report arrives', () => {
  const input = fixture();
  input.events = input.events.filter((item) => item.stage !== 'performed');
  const result = projectSyntheticFollowup(input);
  assert.equal(result.highestEvidencedStage, 'result_received');
  assert.deepEqual(result.missingEvidence, ['performed']);
  assert.equal(result.closed, false);
});

test('closure requires explicit review, closure source and coherent chronology', () => {
  const input = fixture();
  event(input, 'reviewed', 'synthetic-event-reviewed', '2026-03-29T04:00:00+02:00', 'synthetic-review');
  event(input, 'closed', 'synthetic-event-closed', '2026-03-29T04:20:00+02:00', 'synthetic-closure');
  const closed = projectSyntheticFollowup(input);
  assert.equal(closed.closed, true);
  assert.equal(closed.highestEvidencedStage, 'closed');
  assert.equal(closed.overdue, false);
  assert.equal(closed.proposal, null);
  const premature = structuredClone(input);
  premature.events.find((item) => item.stage === 'closed').occurredAt = '2026-03-29T03:40:00+02:00';
  const prematureResult = projectSyntheticFollowup(premature);
  assert.equal(prematureResult.status, 'HOLD');
  assert.equal(prematureResult.closed, false);
  input.events = input.events.filter((item) => item.stage !== 'reviewed');
  const invalid = projectSyntheticFollowup(input);
  assert.equal(invalid.status, 'HOLD');
  assert.deepEqual(invalid.missingEvidence, ['reviewed']);
  assert.equal(invalid.closed, false);
});

test('explicit offsets across DST are compared as instants; uncertain dates hold', () => {
  const input = fixture();
  const result = projectSyntheticFollowup(input);
  assert.equal(result.chronologyInvalid, false);
  input.dueAt = '2026-03-29';
  assert.deepEqual(projectSyntheticFollowup(input), { status: 'HOLD', code: 'uncertain_date' });
  input.dueAt = '2026-03-29T02:30:00';
  assert.deepEqual(projectSyntheticFollowup(input), { status: 'HOLD', code: 'uncertain_date' });
  input.dueAt = '2026-03-29T03:30:00+00:60';
  assert.deepEqual(projectSyntheticFollowup(input), { status: 'HOLD', code: 'uncertain_date' });
  input.dueAt = '2026-03-29T03:30:00+14:01';
  assert.deepEqual(projectSyntheticFollowup(input), { status: 'HOLD', code: 'uncertain_date' });
});

test('future evidence and sources cannot establish a received result or review', () => {
  const futureEvent = fixture();
  futureEvent.events.at(-1).occurredAt = '2026-03-29T05:00:00+02:00';
  futureEvent.events.at(-1).source.date = '2026-03-29T05:00:00+02:00';
  assert.deepEqual(projectSyntheticFollowup(futureEvent), { status: 'HOLD', code: 'future_or_unrecorded_evidence' });
  const futureSource = fixture();
  futureSource.events.at(-1).source.date = '2026-03-29T05:00:00+02:00';
  assert.deepEqual(projectSyntheticFollowup(futureSource), { status: 'HOLD', code: 'future_or_unrecorded_evidence' });
  const earlySource = fixture();
  earlySource.events.at(-1).source.date = '2026-03-29T03:00:00+02:00';
  assert.deepEqual(projectSyntheticFollowup(earlySource), { status: 'HOLD', code: 'future_or_unrecorded_evidence' });
  const futureReview = fixture();
  event(futureReview, 'reviewed', 'synthetic-event-reviewed', '2026-03-29T05:00:00+02:00', 'synthetic-review');
  assert.deepEqual(projectSyntheticFollowup(futureReview), { status: 'HOLD', code: 'future_or_unrecorded_evidence' });
});

test('duplicate replay is stable after reload and conflicting same id/version is refused', () => {
  const input = fixture();
  const original = projectSyntheticFollowup(input);
  input.events.push(structuredClone(input.events[0]));
  assert.deepEqual(projectSyntheticFollowup(input), original);
  assert.deepEqual(projectSyntheticFollowup(structuredClone(input)), original);
  const reordered = input.events.at(-1);
  input.events[input.events.length - 1] = { source: reordered.source, ownerRef: reordered.ownerRef,
    occurredAt: reordered.occurredAt, stage: reordered.stage, eventId: reordered.eventId };
  assert.deepEqual(projectSyntheticFollowup(input), original);
  input.events.at(-1).stage = 'performed';
  assert.deepEqual(projectSyntheticFollowup(input), { status: 'HOLD', code: 'conflicting_duplicate' });
});

test('cancellation, missing owner and unacknowledged handoff hold without a task', () => {
  const cancelled = fixture(); cancelled.cancelled = true;
  assert.deepEqual(projectSyntheticFollowup(cancelled), { status: 'HOLD', code: 'cancelled' });
  const missing = fixture(); missing.ownership.acknowledgedBy = null;
  assert.deepEqual(projectSyntheticFollowup(missing), { status: 'HOLD', code: 'owner_unacknowledged' });
  const ambiguous = fixture(); ambiguous.events[0].ownerRef = 'synthetic-clinician-B';
  assert.deepEqual(projectSyntheticFollowup(ambiguous), { status: 'HOLD', code: 'ambiguous_owner' });
  const handoff = fixture();
  handoff.ownership.ownerRef = 'synthetic-clinician-B';
  handoff.ownership.acknowledgedBy = 'synthetic-clinician-B';
  handoff.ownership.handoff = { fromOwnerRef: 'synthetic-clinician-A', toOwnerRef: 'synthetic-clinician-B',
    acknowledgedBy: null, ackSourceRef: 'synthetic-handoff', ackSourceVersion: 1,
    ackDate: '2026-03-29T04:10:00+02:00' };
  handoff.expectedSourceVersions['synthetic-handoff'] = 1;
  assert.deepEqual(projectSyntheticFollowup(handoff), { status: 'HOLD', code: 'handoff_unacknowledged' });
  handoff.ownership.handoff.acknowledgedBy = 'synthetic-clinician-B';
  handoff.ownership.handoff.ackDate = '2026-03-29T05:00:00+02:00';
  assert.deepEqual(projectSyntheticFollowup(handoff), { status: 'HOLD', code: 'handoff_unacknowledged' });
  handoff.ownership.handoff.ackDate = '2026-03-29T04:10:00+02:00';
  assert.equal(projectSyntheticFollowup(handoff).handoffAcknowledged, true);
});

test('stale source, mixed subject and contradictory duplicate refuse publication', () => {
  const stale = fixture(); stale.expectedSourceVersions['synthetic-report'] = 1;
  assert.deepEqual(projectSyntheticFollowup(stale), { status: 'HOLD', code: 'stale_source' });
  const wrong = fixture(); wrong.events[0].source.subjectRef = 'synthetic-patient-B';
  assert.deepEqual(projectSyntheticFollowup(wrong), { status: 'HOLD', code: 'mixed_subject' });
});
