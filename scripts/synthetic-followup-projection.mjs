#!/usr/bin/env node
/* @Codex: read/proposal-only synthetic projection; no task, notification or clinical write. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const stages = Object.freeze(['planned', 'scheduled', 'performed', 'result_received', 'reviewed', 'closed']);
const hold = (code) => Object.freeze({ status: 'HOLD', code });
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const ref = (value) => typeof value === 'string' && /^synthetic-[a-zA-Z0-9-]+$/u.test(value);
const instant = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return null;
  const hours = value.endsWith('Z') ? 0 : Number(value.slice(-5, -3));
  const minutes = value.endsWith('Z') ? 0 : Number(value.slice(-2));
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
  const offset = (hours * 60 + minutes) * (value.slice(-6, -5) === '-' ? -1 : 1);
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) return null;
  const local = new Date(epoch + offset * 60_000).toISOString().slice(0, 19);
  return local === value.slice(0, 19) ? epoch : null;
};
const canonical = (value) => JSON.stringify(value, (key, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map((name) => [name, item[name]])) : item);

export function projectSyntheticFollowup(input) {
  if (!plain(input) || input.schemaVersion !== 'mediflow.synthetic_followup.fixture.v1'
    || input.workflow !== 'exam_report_review' || !ref(input.patientRef)
    || !Array.isArray(input.events) || !plain(input.expectedSourceVersions)
    || !plain(input.ownership) || typeof input.reminderDismissed !== 'boolean'
    || typeof input.cancelled !== 'boolean') return hold('invalid_input');
  const now = instant(input.now);
  const due = input.dueAt === null ? null : instant(input.dueAt);
  if (now === null || (input.dueAt !== null && due === null)) return hold('uncertain_date');
  if (input.cancelled) return hold('cancelled');
  const owner = input.ownership;
  if (!ref(owner.ownerRef) || !ref(owner.acknowledgedBy) || owner.acknowledgedBy !== owner.ownerRef)
    return hold('owner_unacknowledged');
  if (owner.handoff !== null) {
    const handoff = owner.handoff;
    if (!plain(handoff) || !ref(handoff.fromOwnerRef) || !ref(handoff.toOwnerRef)
      || handoff.fromOwnerRef === handoff.toOwnerRef
      || handoff.toOwnerRef !== owner.ownerRef || !ref(handoff.acknowledgedBy)
      || handoff.acknowledgedBy !== handoff.toOwnerRef || !ref(handoff.ackSourceRef)
      || !Number.isSafeInteger(handoff.ackSourceVersion) || handoff.ackSourceVersion < 1
      || instant(handoff.ackDate) === null || instant(handoff.ackDate) > now
      || input.expectedSourceVersions[handoff.ackSourceRef] !== handoff.ackSourceVersion)
      return hold('handoff_unacknowledged');
  }
  const unique = new Map();
  for (const event of input.events) {
    if (!plain(event) || !ref(event.eventId) || !stages.includes(event.stage)
      || !ref(event.ownerRef) || !plain(event.source) || !ref(event.source.ref)
      || !ref(event.source.subjectRef) || !Number.isSafeInteger(event.source.version)
      || event.source.version < 1) return hold('invalid_event');
    const occurred = instant(event.occurredAt), sourceDate = instant(event.source.date);
    if (occurred === null || sourceDate === null) return hold('uncertain_date');
    // scheduled.occurredAt is when the booking was documented, never the future appointment time.
    if (occurred > sourceDate || sourceDate > now) return hold('future_or_unrecorded_evidence');
    if (event.source.subjectRef !== input.patientRef) return hold('mixed_subject');
    if (input.expectedSourceVersions[event.source.ref] !== event.source.version) return hold('stale_source');
    if (event.ownerRef !== owner.ownerRef && (!plain(owner.handoff)
      || event.ownerRef !== owner.handoff.fromOwnerRef || occurred > instant(owner.handoff.ackDate)))
      return hold('ambiguous_owner');
    const key = `${event.eventId}\0${event.source.version}`;
    const previous = unique.get(key);
    if (previous && canonical(previous) !== canonical(event)) return hold('conflicting_duplicate');
    unique.set(key, event);
  }
  const events = [...unique.values()].sort((a, b) => stages.indexOf(a.stage) - stages.indexOf(b.stage)
    || a.eventId.localeCompare(b.eventId));
  const evidence = Object.fromEntries(stages.map((stage) => [stage, events.filter((event) => event.stage === stage)
    .map((event) => Object.freeze({ eventId: event.eventId, sourceRef: event.source.ref,
      sourceVersion: event.source.version, sourceDate: event.source.date, occurredAt: event.occurredAt }))]));
  const highestIndex = stages.reduce((high, stage, index) => evidence[stage].length ? index : high, -1);
  const missingEvidence = stages.slice(0, Math.max(0, highestIndex + 1))
    .filter((stage) => evidence[stage].length === 0);
  const chronologyInvalid = stages.slice(1).some((stage, index) => evidence[stage].length && evidence[stages[index]].length
    && Math.min(...events.filter((event) => event.stage === stage).map((event) => instant(event.occurredAt)))
      < Math.min(...events.filter((event) => event.stage === stages[index]).map((event) => instant(event.occurredAt))));
  const closed = evidence.closed.length > 0 && evidence.reviewed.length > 0
    && missingEvidence.length === 0 && !chronologyInvalid;
  const status = chronologyInvalid || (evidence.closed.length > 0 && !closed) ? 'HOLD' : 'PROPOSAL_ONLY';
  return Object.freeze({ status, patientRef: input.patientRef,
    highestEvidencedStage: highestIndex < 0 ? null : stages[highestIndex],
    missingEvidence: Object.freeze(missingEvidence), chronologyInvalid,
    closed, overdue: !closed && due !== null && now > due, reminderDismissed: input.reminderDismissed,
    ownerRef: owner.ownerRef, handoffAcknowledged: owner.handoff !== null,
    evidence: Object.freeze(evidence),
    proposal: status === 'PROPOSAL_ONLY' && !closed ? Object.freeze({
      requestEvidenceFor: stages.find((stage) => evidence[stage].length === 0) ?? null,
      apply: false, humanReviewRequired: true }) : null });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length !== 2) {
    process.stderr.write('synthetic-followup-projection: arguments are not supported\n');
    process.exit(2);
  }
  const input = JSON.parse(readFileSync(new URL('./fixtures/followup-synthetic.json', import.meta.url), 'utf8'));
  process.stdout.write(`${JSON.stringify(projectSyntheticFollowup(input), null, 2)}\n`);
}
