/* @Codex */
import { HEADLESS_CANONICAL_CAPABILITY_DESCRIPTORS } from './canonical-capability-catalog';

export type HeadlessNetworkReadEvidenceCandidate = Readonly<{
  schema: 'mediflow.headless.network-read-evidence-candidate.v1';
  sourceRows: readonly number[];
  mappingEvidenceRows: readonly number[];
  mappingDisposition: 'assigned' | 'ambiguous' | 'unassigned';
  mappingReason: string;
  mappingEvidenceNeedle: string;
  method: 'GET';
  route: string;
  openApiOperationId: string;
  runtimeRef: string;
  positiveTestRef: string;
  mappingEvidenceRefs: readonly string[];
  integrationDisposition: 'candidate_not_integrated';
  headlessOperationId: null;
  applicationServiceRef: null;
  applyPolicy: 'none';
  writesPerformed: 0;
}>;

export type HeadlessCanonicalReadPlanEntry = Readonly<{
  schema: 'mediflow.headless.canonical-read-plan-entry.v1';
  anchorId: string;
  sourceRow: number;
  terminalDisposition: 'manual_only';
  integrationDisposition: 'candidate_not_integrated';
  readCandidates: readonly HeadlessNetworkReadEvidenceCandidate[];
  unresolved: readonly string[];
  operationId: null;
  applicationServiceRef: null;
  applyPolicy: 'none';
  writesPerformed: 0;
}>;

function record<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, value));
}

function list<T>(values: readonly T[]): readonly T[] {
  const output = Array.from(values);
  Object.setPrototypeOf(output, null);
  return Object.freeze(output);
}

type CandidateTuple = readonly [
  sourceRows: readonly number[],
  mappingDisposition: 'assigned' | 'ambiguous' | 'unassigned',
  mappingReason: string,
  route: string,
  openApiOperationId: string,
  runtimeRef: string,
  positiveTestRef: string,
  mappingEvidenceRows?: readonly number[],
];

const CANDIDATES = [
  [[63], 'assigned', 'source row names the exact Network discovery route', '/api/v1/network/node', 'getNetworkNode', 'app/api/v1/network/node/route.ts', 'scripts/network-home-base-discovery-read.test.mjs'],
  [[], 'unassigned', 'the canonical source explicitly separates the session family', '/api/v1/network/session', 'getNetworkSession', 'app/api/v1/network/session/route.ts', 'scripts/network-home-base-readonly.test.mjs', [63]],
  [[63], 'assigned', 'source row names the exact Network discovery route', '/api/v1/network/capabilities', 'listNetworkCapabilities', 'app/api/v1/network/capabilities/route.ts', 'scripts/network-home-base-discovery-read.test.mjs'],
  [[63], 'assigned', 'source row names the exact Network discovery route', '/api/v1/network/identity', 'getNetworkIdentity', 'app/api/v1/network/identity/route.ts', 'scripts/network-home-base-discovery-read.test.mjs'],
  [[61], 'assigned', 'source row names the revision fingerprint surface', '/api/v1/network/revision', 'getNetworkRevision', 'app/api/v1/network/revision/route.ts', 'scripts/network-home-base-discovery-read.test.mjs'],
  [[44, 51], 'ambiguous', 'one response combines runtime configuration and kill-switch state', '/api/v1/network/ai-runtime', 'getNetworkAiRuntime', 'app/api/v1/network/ai-runtime/route.ts', 'scripts/network-home-base-diary-write.test.mjs'],
  [[37], 'assigned', 'source row names the pairing and operator login surface', '/api/v1/network/pairing-intents', 'listNetworkPairingIntents', 'app/api/v1/network/pairing-intents/route.ts', 'scripts/network-home-base-readonly.test.mjs'],
  [[27], 'assigned', 'source row names active ambulatory scope selection', '/api/v1/network/ambulatories', 'listNetworkAmbulatories', 'app/api/v1/network/ambulatories/route.ts', 'scripts/network-home-base-readonly.test.mjs'],
  [[24], 'assigned', 'source row names the AIFA drug catalog', '/api/v1/network/drugs', 'listNetworkDrugs', 'app/api/v1/network/drugs/route.ts', 'scripts/network-home-base-catalog-read.test.mjs'],
  [[23], 'assigned', 'source row names exemption code selection', '/api/v1/network/exemptions', 'listNetworkExemptions', 'app/api/v1/network/exemptions/route.ts', 'scripts/network-home-base-catalog-read.test.mjs'],
  [[26], 'assigned', 'source row names general terminology search', '/api/v1/network/terminology/search', 'searchNetworkTerminology', 'app/api/v1/network/terminology/search/route.ts', 'scripts/network-home-base-catalog-read.test.mjs'],
  [[26], 'assigned', 'source row names general terminology resolution', '/api/v1/network/terminology/resolve', 'resolveNetworkTerminology', 'app/api/v1/network/terminology/resolve/route.ts', 'scripts/network-home-base-catalog-read.test.mjs'],
  [[26], 'assigned', 'source row names terminology systems', '/api/v1/network/terminology/systems', 'listNetworkTerminologySystems', 'app/api/v1/network/terminology/systems/route.ts', 'scripts/network-home-base-catalog-read.test.mjs'],
  [[13], 'assigned', 'source row names service prescriptions', '/api/v1/network/service-prescriptions', 'listNetworkServicePrescriptions', 'app/api/v1/network/service-prescriptions/route.ts', 'scripts/network-home-base-prescriptions-write.test.mjs'],
  [[13], 'assigned', 'source row names service prescription items', '/api/v1/network/service-prescription-items', 'listNetworkServicePrescriptionItems', 'app/api/v1/network/service-prescription-items/route.ts', 'scripts/network-home-base-prescriptions-write.test.mjs'],
  [[57], 'assigned', 'source row names the exact service catalog family', '/api/v1/network/service-catalog', 'listNetworkServiceCatalog', 'app/api/v1/network/service-catalog/route.ts', 'scripts/network-home-base-prescriptions-write.test.mjs'],
  [[14], 'assigned', 'source row names prosthetic prescriptions', '/api/v1/network/prosthetic-prescriptions', 'listNetworkProstheticPrescriptions', 'app/api/v1/network/prosthetic-prescriptions/route.ts', 'scripts/network-home-base-prescriptions-write.test.mjs'],
  [[1], 'assigned', 'source row names patient list and search', '/api/v1/network/patients', 'listNetworkPatients', 'app/api/v1/network/patients/route.ts', 'scripts/network-home-base-readonly.test.mjs'],
  [[33], 'assigned', 'source row names the agenda view', '/api/v1/network/checkups', 'listNetworkScopedCheckups', 'app/api/v1/network/checkups/route.ts', 'scripts/network-home-base-aggregate-read.test.mjs'],
  [[34], 'assigned', 'source row names the cross-patient diary', '/api/v1/network/entries', 'listNetworkScopedEntries', 'app/api/v1/network/entries/route.ts', 'scripts/network-home-base-aggregate-read.test.mjs'],
  [[1], 'assigned', 'source row names patient detail', '/api/v1/network/patients/{id}', 'getNetworkPatient', 'app/api/v1/network/patients/[id]/route.ts', 'scripts/network-home-base-readonly.test.mjs'],
  [[3], 'assigned', 'source row names patient diary list', '/api/v1/network/patients/{id}/entries', 'listNetworkPatientEntries', 'app/api/v1/network/patients/[id]/entries/route.ts', 'scripts/network-home-base-diary-write.test.mjs'],
  [[3], 'assigned', 'source row names patient diary view', '/api/v1/network/patients/{id}/entries/{entryId}', 'getNetworkPatientEntry', 'app/api/v1/network/patients/[id]/entries/[entryId]/route.ts', 'scripts/network-home-base-diary-write.test.mjs'],
  [[8], 'assigned', 'source row names patient therapy list', '/api/v1/network/patients/{id}/therapies', 'listNetworkPatientTherapies', 'app/api/v1/network/patients/[id]/therapies/route.ts', 'scripts/network-home-base-therapy-write.test.mjs'],
  [[8], 'assigned', 'source row names patient therapy view', '/api/v1/network/patients/{id}/therapies/{therapyId}', 'getNetworkPatientTherapy', 'app/api/v1/network/patients/[id]/therapies/[therapyId]/route.ts', 'scripts/network-home-base-therapy-write.test.mjs'],
  [[10], 'assigned', 'source row names patient checkup list', '/api/v1/network/patients/{id}/checkups', 'listNetworkPatientCheckups', 'app/api/v1/network/patients/[id]/checkups/route.ts', 'scripts/network-home-base-checkup-write.test.mjs'],
  [[10], 'assigned', 'source row names patient checkup view', '/api/v1/network/patients/{id}/checkups/{checkupId}', 'getNetworkPatientCheckup', 'app/api/v1/network/patients/[id]/checkups/[checkupId]/route.ts', 'scripts/network-home-base-checkup-write.test.mjs'],
  [[12], 'assigned', 'source row names patient observation list', '/api/v1/network/patients/{id}/observations', 'listNetworkPatientObservations', 'app/api/v1/network/patients/[id]/observations/route.ts', 'scripts/network-home-base-observation-write.test.mjs'],
  [[12], 'assigned', 'source row names patient observation view', '/api/v1/network/patients/{id}/observations/{observationId}', 'getNetworkPatientObservation', 'app/api/v1/network/patients/[id]/observations/[observationId]/route.ts', 'scripts/network-home-base-observation-write.test.mjs'],
  [[15], 'assigned', 'source row names the patient document archive', '/api/v1/network/patients/{id}/attachments', 'listNetworkPatientAttachments', 'app/api/v1/network/patients/[id]/attachments/route.ts', 'scripts/network-home-base-documents-write.test.mjs'],
  [[15], 'assigned', 'source row names patient document view', '/api/v1/network/patients/{id}/attachments/{attachmentId}', 'getNetworkPatientAttachment', 'app/api/v1/network/patients/[id]/attachments/[attachmentId]/route.ts', 'scripts/network-home-base-documents-write.test.mjs'],
  [[21], 'assigned', 'source row names patient FSE export pre-check', '/api/v1/network/fse/validate-patient', 'validateNetworkFsePatientExport', 'app/api/v1/network/fse/validate-patient/route.ts', 'scripts/network-home-base-discovery-read.test.mjs'],
] as const satisfies readonly CandidateTuple[];

const EVIDENCE_NEEDLES = {
  getNetworkNode: 'app/api/v1/network/node/route.ts',
  getNetworkSession: 'famiglie boundary distinte da pairing-intents/confirm e session',
  listNetworkCapabilities: 'app/api/v1/network/capabilities/route.ts',
  getNetworkIdentity: 'app/api/v1/network/identity/route.ts',
  getNetworkRevision: 'GET /api/v1/network/revision',
  getNetworkAiRuntime: 'GET /api/v1/network/ai-runtime',
  listNetworkPairingIntents: 'pairing intent/confirm',
  listNetworkAmbulatories: 'GET /api/v1/network/ambulatories',
  listNetworkDrugs: 'GET /api/v1/network/drugs',
  listNetworkExemptions: 'GET /api/v1/network/exemptions',
  searchNetworkTerminology: 'GET /api/v1/network/terminology/search|resolve|systems',
  resolveNetworkTerminology: 'GET /api/v1/network/terminology/search|resolve|systems',
  listNetworkTerminologySystems: 'GET /api/v1/network/terminology/search|resolve|systems',
  listNetworkServicePrescriptions: 'GET/POST/PUT service-prescriptions e items',
  listNetworkServicePrescriptionItems: 'GET/POST/PUT service-prescriptions e items',
  listNetworkServiceCatalog: 'GET /api/v1/network/service-catalog',
  listNetworkProstheticPrescriptions: 'GET/POST/PUT prosthetic-prescriptions',
  listNetworkPatients: 'app/api/v1/network/patients/route.ts',
  listNetworkScopedCheckups: 'GET /api/v1/network/checkups',
  listNetworkScopedEntries: 'GET /api/v1/network/entries',
  getNetworkPatient: '[id]/route.ts',
  listNetworkPatientEntries: 'app/api/v1/network/patients/[id]/entries',
  getNetworkPatientEntry: 'app/api/v1/network/patients/[id]/entries',
  listNetworkPatientTherapies: 'GET/POST/PUT therapies',
  getNetworkPatientTherapy: 'GET/POST/PUT therapies',
  listNetworkPatientCheckups: 'GET/POST/PUT checkups',
  getNetworkPatientCheckup: 'GET/POST/PUT checkups',
  listNetworkPatientObservations: 'GET/POST/PUT observations',
  getNetworkPatientObservation: 'GET/POST/PUT observations',
  listNetworkPatientAttachments: 'lib/network-attachment-{read,write}',
  getNetworkPatientAttachment: 'lib/network-attachment-{read,write}',
  validateNetworkFsePatientExport: 'GET /api/v1/network/fse/validate-patient',
} as const satisfies Record<(typeof CANDIDATES)[number][4], string>;

const evidenceCandidates: HeadlessNetworkReadEvidenceCandidate[] = [];
const candidatesByRow = new Map<number, HeadlessNetworkReadEvidenceCandidate[]>();
for (const [sourceRows, mappingDisposition, mappingReason, route, openApiOperationId, runtimeRef, positiveTestRef, evidenceRows = sourceRows] of CANDIDATES) {
  const candidate = record({
    schema: 'mediflow.headless.network-read-evidence-candidate.v1' as const,
    sourceRows: list(sourceRows),
    mappingEvidenceRows: list(evidenceRows),
    mappingDisposition,
    mappingReason: mappingDisposition === 'assigned'
      ? `parity boundary evidence directly links ${route} to source row ${sourceRows[0]}`
      : mappingReason,
    mappingEvidenceNeedle: EVIDENCE_NEEDLES[openApiOperationId],
    method: 'GET' as const,
    route,
    openApiOperationId,
    runtimeRef,
    positiveTestRef,
    mappingEvidenceRefs: list(evidenceRows.flatMap((sourceRow) => [
      `docs/apple-parity-matrix.json#/rows/${sourceRow - 1}`,
      `docs/capability-mapping/nodes/web-mini-crosswalk.v1.json#/records/${sourceRow - 1}`,
    ])),
    integrationDisposition: 'candidate_not_integrated' as const,
    headlessOperationId: null,
    applicationServiceRef: null,
    applyPolicy: 'none' as const,
    writesPerformed: 0 as const,
  });
  evidenceCandidates.push(candidate);
  if (mappingDisposition === 'assigned') {
    const sourceRow = sourceRows[0]!;
    const rowCandidates = candidatesByRow.get(sourceRow) ?? [];
    rowCandidates.push(candidate);
    candidatesByRow.set(sourceRow, rowCandidates);
  }
}

export const HEADLESS_NETWORK_READ_EVIDENCE_CANDIDATES = list(evidenceCandidates);

const readPlan: HeadlessCanonicalReadPlanEntry[] = [];
const byAnchor = new Map<string, HeadlessCanonicalReadPlanEntry>();
for (const descriptor of Array.from(HEADLESS_CANONICAL_CAPABILITY_DESCRIPTORS)) {
  const entry = record({
    schema: 'mediflow.headless.canonical-read-plan-entry.v1' as const,
    anchorId: descriptor.anchorId,
    sourceRow: descriptor.sourceRow,
    terminalDisposition: descriptor.manualDisposition,
    integrationDisposition: 'candidate_not_integrated' as const,
    readCandidates: list(candidatesByRow.get(descriptor.sourceRow) ?? []),
    unresolved: descriptor.unresolved,
    operationId: null,
    applicationServiceRef: null,
    applyPolicy: 'none' as const,
    writesPerformed: 0 as const,
  });
  readPlan.push(entry);
  byAnchor.set(entry.anchorId, entry);
}

export const HEADLESS_CANONICAL_READ_PLAN = list(readPlan);

/** Resolves an exact canonical anchor without normalizing, inferring, or granting authority. */
export function resolveHeadlessCanonicalReadPlan(anchorId: unknown): HeadlessCanonicalReadPlanEntry | null {
  return typeof anchorId === 'string' ? byAnchor.get(anchorId) ?? null : null;
}
