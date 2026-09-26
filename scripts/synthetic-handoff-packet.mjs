/* @Codex — removable synthetic-only handoff exploration, no export authority. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, 'fixtures/handoff-packet-synthetic.json');
const MAX_BYTES = 100_000;
const MAX_SOURCES = 30;
const CATEGORIES = ['problem', 'medication', 'allergyInformation', 'recentEvidence', 'outstandingTask'];
const FIELDS = {
  root: ['syntheticOnly', 'patient', 'request', 'sources'],
  patient: ['id', 'label', 'context', 'version'],
  request: ['patientId', 'expectedPatientVersion', 'recipient', 'purpose', 'asOfDate', 'selectedSourceIds', 'expectedVersions'],
  recipient: ['id', 'label'],
  source: ['id', 'subjectId', 'category', 'state', 'date', 'version', 'reviewStatus', 'exactQuote'],
};
const MAPPING = {
  problem: { ipsSectionCandidate: 'Problem List', resourceCandidate: 'Condition' },
  medication: { ipsSectionCandidate: 'Medication Summary', resourceCandidate: 'MedicationStatement' },
  allergyInformation: { ipsSectionCandidate: 'Allergies and Intolerances', resourceCandidate: null },
  recentEvidence: { ipsSectionCandidate: 'Diagnostic Results', resourceCandidate: 'Observation' },
  outstandingTask: { ipsSectionCandidate: 'Plan of Care', resourceCandidate: null },
};

export class PacketRejected extends Error {
  constructor(code) { super(`PACKET_REJECTED:${code}`); this.name = 'PacketRejected'; this.code = code; }
}
function reject(code) { throw new PacketRejected(code); }
function exactObject(value, keys, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) reject(code);
}
function text(value, code, max = 500) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) reject(code);
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) reject('INVALID_DATE');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) reject('INVALID_DATE');
}
function version(value) { if (!Number.isSafeInteger(value) || value < 1) reject('INVALID_VERSION'); }
function syntheticId(value, prefix) {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}[a-z0-9-]{1,48}$`, 'u').test(value)) reject('INVALID_SYNTHETIC_ID');
}
function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

/** Returns a reviewed derivative candidate; refusal contains only a code. */
export function buildSyntheticHandoffPacket(input) {
  exactObject(input, FIELDS.root, 'INVALID_INPUT');
  if (input.syntheticOnly !== true) reject('SYNTHETIC_ONLY');
  exactObject(input.patient, FIELDS.patient, 'INVALID_PATIENT');
  exactObject(input.request, FIELDS.request, 'INVALID_REQUEST');
  exactObject(input.request.recipient, FIELDS.recipient, 'INVALID_RECIPIENT');
  const { patient, request } = input;
  syntheticId(patient.id, 'synthetic-patient-');
  text(patient.label, 'INVALID_PATIENT'); text(patient.context, 'INVALID_PATIENT'); version(patient.version);
  syntheticId(request.patientId, 'synthetic-patient-');
  if (request.patientId !== patient.id) reject('WRONG_PATIENT');
  version(request.expectedPatientVersion);
  if (request.expectedPatientVersion !== patient.version) reject('STALE_PATIENT');
  syntheticId(request.recipient.id, 'synthetic-recipient-');
  text(request.recipient.label, 'MISSING_RECIPIENT');
  text(request.purpose, 'MISSING_PURPOSE');
  date(request.asOfDate);
  if (!Array.isArray(input.sources) || input.sources.length === 0 || input.sources.length > MAX_SOURCES) reject('SOURCE_VOLUME');
  if (!Array.isArray(request.selectedSourceIds) || request.selectedSourceIds.length === 0
    || request.selectedSourceIds.length > MAX_SOURCES) reject('INVALID_SELECTION');
  exactObject(request.expectedVersions, request.selectedSourceIds, 'INVALID_EXPECTED_VERSIONS');

  const sourceById = new Map();
  for (const source of input.sources) {
    exactObject(source, FIELDS.source, 'INVALID_SOURCE');
    syntheticId(source.id, 'synthetic-source-');
    syntheticId(source.subjectId, 'synthetic-patient-');
    if (source.subjectId !== patient.id) reject('MIXED_SUBJECT');
    if (sourceById.has(source.id)) reject('DUPLICATE_SOURCE');
    if (!CATEGORIES.includes(source.category)) reject('INVALID_CATEGORY');
    if (source.category === 'allergyInformation') {
      if (!['unknown', 'explicitlyAbsent'].includes(source.state)) reject('INVALID_ALLERGY_STATE');
    } else if (!['current', 'historical'].includes(source.state)) reject('INVALID_STATE');
    date(source.date);
    if (source.date > request.asOfDate) reject('FUTURE_SOURCE');
    version(source.version);
    if (!['reviewed', 'unreviewed'].includes(source.reviewStatus)) reject('INVALID_REVIEW_STATUS');
    text(source.exactQuote, 'MISSING_PROVENANCE', 1000);
    sourceById.set(source.id, source);
  }
  const selected = [];
  const seen = new Set();
  for (const id of request.selectedSourceIds) {
    if (seen.has(id)) reject('DUPLICATE_SELECTION');
    seen.add(id);
    const source = sourceById.get(id);
    if (!source) reject('MISSING_SOURCE');
    version(request.expectedVersions[id]);
    if (request.expectedVersions[id] !== source.version) reject('STALE_SOURCE');
    if (source.reviewStatus !== 'reviewed') reject('UNREVIEWED_SOURCE');
    selected.push(source);
  }
  if (CATEGORIES.some((category) => !selected.some((source) => source.category === category))) reject('INCOMPLETE_MINIMUM_PACKET');
  if (selected.filter((source) => source.category === 'allergyInformation').length !== 1) reject('AMBIGUOUS_ALLERGY_STATUS');
  if (!selected.some((source) => source.category === 'problem' && source.state === 'current')
    || !selected.some((source) => source.category === 'medication' && source.state === 'current')
    || !selected.some((source) => source.category === 'recentEvidence' && source.state === 'current')
    || !selected.some((source) => source.category === 'outstandingTask' && source.state === 'current')) reject('INCOMPLETE_CURRENT_CONTEXT');

  const claims = selected.map((source) => ({
    category: source.category, state: source.state, text: source.exactQuote,
    provenance: { sourceId: source.id, subjectId: source.subjectId, date: source.date,
      version: source.version, exactQuote: source.exactQuote, reviewStatus: source.reviewStatus },
  }));
  const allergy = claims.find((claim) => claim.category === 'allergyInformation');
  const candidateMapping = CATEGORIES.map((category) => ({
    category, ...MAPPING[category], sourceIds: selected.filter((source) => source.category === category).map((source) => source.id),
    status: 'candidate_mapping_only', coding: null, profileValidation: 'not_performed',
  }));
  return freezeDeep({
    artifact: 'synthetic_handoff_packet_review_required',
    authority: 'derivative_proposal_only_no_send_or_commit',
    patient: { id: patient.id, label: patient.label, context: patient.context, version: patient.version },
    intendedRecipient: { ...request.recipient }, purpose: request.purpose, asOfDate: request.asOfDate,
    selection: { selectedCount: selected.length, excludedCount: input.sources.length - selected.length },
    allergyInformationStatus: allergy.state,
    claims,
    ipsCandidate: { guide: 'HL7 IPS 2.0.1 / FHIR R4', guideUrl: 'https://hl7.org/fhir/uv/ips/2.0.1/',
      conformance: 'not_claimed', sections: candidateMapping },
    unsupportedFields: ['Verified terminology/codes and units', 'Italian profile and FSE overlay',
      'FHIR Bundle serialization or validation', 'Allergy resource representation for unknown/explicit absence',
      'Recipient identity resolution', 'Clinical sign-off and target ingestion'],
    reviewRequired: true,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) reject('CLI_ARGUMENTS_NOT_ALLOWED');
    const bytes = readFileSync(fixturePath);
    if (bytes.length > MAX_BYTES) reject('FIXTURE_VOLUME');
    process.stdout.write(`${JSON.stringify(buildSyntheticHandoffPacket(JSON.parse(bytes.toString('utf8'))), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof PacketRejected ? error.message : 'PACKET_REJECTED:INVALID_FIXTURE'}\n`);
    process.exitCode = 1;
  }
}
