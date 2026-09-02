/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPEN_LOOPS_OPERATION_ID, TERMINOLOGY_OPERATION_ID, capabilitiesOutputSchema,
  headlessStatusOutputSchema, openLoopsOutputSchema, terminologyArgumentsSchema, terminologyOutputSchema,
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
