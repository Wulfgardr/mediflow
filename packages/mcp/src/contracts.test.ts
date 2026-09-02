/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FOLLOW_UP_PROPOSAL_OPERATION_ID, OPEN_LOOPS_OPERATION_ID, OPERATION_DESCRIPTORS, TERMINOLOGY_OPERATION_ID,
  capabilitiesOutputSchema, followUpProposalArgumentsSchema, followUpProposalOutputSchema,
  headlessStatusOutputSchema, openLoopsOutputSchema, publicCatalog, selectBoundOperations,
  terminologyArgumentsSchema, terminologyOutputSchema,
} from './contracts.ts';

const terminology = (items: unknown[]) => ({
  schemaVersion: 'mediflow.terminology.search.output.v1', operationId: TERMINOLOGY_OPERATION_ID,
  capabilityId: TERMINOLOGY_OPERATION_ID, applicationServiceRef: 'AipTerminologySearchServiceV1', outcome: 'read', items,
  receipt: { schemaVersion: 'mediflow.terminology.search.receipt.v1', receiptRef: 'aiptr_synthetic_0001',
    operationId: TERMINOLOGY_OPERATION_ID, capabilityId: TERMINOLOGY_OPERATION_ID, outcome: 'read', system: 'LOINC',
    resultCount: items.length, catalogSource: 'local-pilot-catalog', egress: 'none', writesPerformed: 0,
    fabricDependency: 'none', timestamp: 1_000 },
});
const item = (code: string, display = 'Synthetic display') => ({
  system: 'LOINC', code, display, version: null,
});

test('bounds normalized terminology inputs and service outputs in UTF-8 bytes', () => {
  assert.equal(terminologyArgumentsSchema.safeParse({ system: 'LOINC', query: '   ', limit: 1 }).success, false);
  assert.equal(terminologyArgumentsSchema.safeParse({ system: 'LOINC', query: 'é'.repeat(49), limit: 1 }).success, false);
  assert.equal(terminologyOutputSchema.safeParse(terminology([item('code', 'é'.repeat(129))])).success, false);
});

test('keeps non-PHI status and capability catalog outputs exact and versioned', () => {
  assert.equal(headlessStatusOutputSchema.safeParse({ schemaVersion: 'mediflow.system.headless-status.v1',
    candidateVersion: '0.8.5', protocolVersion: '2026-07-28', dataScope: 'non_phi_system_status',
    writes: 0, apply: 'none' }).success, true);
  assert.equal(capabilitiesOutputSchema.safeParse({ schemaVersion: 'mediflow.system.capabilities.v1', operations: [],
    patientId: 'caller-selected' }).success, false);
});

test('rejects duplicate terminology codes and duplicate open-loop references', () => {
  assert.equal(terminologyOutputSchema.safeParse(terminology([item('same'), item('same')])).success, false);
  const loop = { loopRef: `aipl_${'1'.repeat(64)}`, kind: 'results_pending', temporalState: 'open',
    openedAt: 900, dueAt: 1_100, revision: 1 };
  const loops = { schemaVersion: 'mediflow.patient.open_loops.read.result.v1',
    operationId: OPEN_LOOPS_OPERATION_ID, capabilityId: OPEN_LOOPS_OPERATION_ID, outcome: 'read',
    items: [loop, loop], truncated: false, snapshotRevision: 7,
    receipt: { schemaVersion: 'mediflow.patient.open_loops.read.receipt.v1', receiptRef: `aipr_${'2'.repeat(64)}`,
      operationId: OPEN_LOOPS_OPERATION_ID, capabilityId: OPEN_LOOPS_OPERATION_ID, outcome: 'read',
      ownerRefHash: `sha256:${'3'.repeat(64)}`, leaseRefHash: `sha256:${'4'.repeat(64)}`,
      receiptRefHash: `sha256:${'5'.repeat(64)}`, generation: 1, revocationGeneration: 0, selectionEpoch: 2,
      snapshotRevision: 7, itemCount: 2, truncated: false, timestamp: 1_000 },
  };
  assert.equal(openLoopsOutputSchema.safeParse(loops).success, false);
});

test('rejects impossible open-loop temporal shapes at the output boundary', () => {
  const invalid = { loopRef: `aipl_${'1'.repeat(64)}`, kind: 'series_stalled', temporalState: 'overdue',
    openedAt: 900, dueAt: null, revision: 1 };
  const output = { schemaVersion: 'mediflow.patient.open_loops.read.result.v1',
    operationId: OPEN_LOOPS_OPERATION_ID, capabilityId: OPEN_LOOPS_OPERATION_ID, outcome: 'read',
    items: [invalid], truncated: false, snapshotRevision: 7,
    receipt: { schemaVersion: 'mediflow.patient.open_loops.read.receipt.v1', receiptRef: `aipr_${'2'.repeat(64)}`,
      operationId: OPEN_LOOPS_OPERATION_ID, capabilityId: OPEN_LOOPS_OPERATION_ID, outcome: 'read',
      ownerRefHash: `sha256:${'3'.repeat(64)}`, leaseRefHash: `sha256:${'4'.repeat(64)}`,
      receiptRefHash: `sha256:${'5'.repeat(64)}`, generation: 1, revocationGeneration: 0, selectionEpoch: 2,
      snapshotRevision: 7, itemCount: 1, truncated: false, timestamp: 1_000 },
  };
  assert.equal(openLoopsOutputSchema.safeParse(output).success, false);
});

test('binds one closed-world proposal-only follow-up contract without publishing its service ref', () => {
  const descriptor = {
    operationId: FOLLOW_UP_PROPOSAL_OPERATION_ID, capabilityId: FOLLOW_UP_PROPOSAL_OPERATION_ID,
    serviceRef: 'PatientOpenLoopsFollowUpProposalServiceV1', maximumStage: 'proposal_only',
    inputSchema: 'mediflow.patient.open_loops.follow_up.propose.input.v1',
    outputSchema: 'mediflow.patient.open_loops.follow_up.proposal.v1',
  } as const;
  assert.deepEqual(OPERATION_DESCRIPTORS[2], descriptor);
  assert.equal(followUpProposalArgumentsSchema.safeParse({}).success, true);
  assert.equal(followUpProposalArgumentsSchema.safeParse({ patientId: 'caller-selected' }).success, false);
  const item = { loopRef: `aipl_${'1'.repeat(64)}`, action: 'review_result' };
  const output = {
    schemaVersion: 'mediflow.patient.open_loops.follow_up.proposal.v1',
    operationId: FOLLOW_UP_PROPOSAL_OPERATION_ID, capabilityId: FOLLOW_UP_PROPOSAL_OPERATION_ID,
    applicationServiceRef: 'PatientOpenLoopsFollowUpProposalServiceV1', outcome: 'proposed',
    maximumStage: 'proposal_only', reviewRequired: true, writesPerformed: 0, apply: 'none',
    proposalRef: `aipfp_${'2'.repeat(64)}`, basedOnSnapshotRevision: 7, items: [item],
    receipt: { schemaVersion: 'mediflow.patient.open_loops.follow_up.proposal.receipt.v1',
      receiptRef: `aipfr_${'3'.repeat(64)}`, operationId: FOLLOW_UP_PROPOSAL_OPERATION_ID,
      capabilityId: FOLLOW_UP_PROPOSAL_OPERATION_ID,
      applicationServiceRef: 'PatientOpenLoopsFollowUpProposalServiceV1', outcome: 'proposed',
      proposalRefHash: `sha256:${'4'.repeat(64)}`, receiptRefHash: `sha256:${'5'.repeat(64)}`,
      sourceReceiptRefHash: `sha256:${'6'.repeat(64)}`, basedOnSnapshotRevision: 7,
      itemCount: 1, truncated: false, maximumStage: 'proposal_only', reviewRequired: true,
      writesPerformed: 0, apply: 'none', egress: 'none', timestamp: 1_000 },
  };
  assert.equal(followUpProposalOutputSchema.safeParse(output).success, true);
  assert.equal(followUpProposalOutputSchema.safeParse({ ...output, diagnosis: 'forbidden' }).success, false);
  assert.equal(followUpProposalOutputSchema.safeParse({ ...output, items: [item, item],
    receipt: { ...output.receipt, itemCount: 2 } }).success, false);
  const selected = selectBoundOperations(OPERATION_DESCRIPTORS.map(
    ({ operationId, capabilityId, serviceRef, maximumStage }) =>
      ({ operationId, capabilityId, serviceRef, maximumStage })));
  const published = publicCatalog(selected);
  assert.deepEqual(selected, OPERATION_DESCRIPTORS);
  assert.equal(capabilitiesOutputSchema.safeParse(published).success, true);
  assert.doesNotMatch(JSON.stringify(published), /serviceRef/u);
});
