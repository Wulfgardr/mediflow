/* @Codex */
import { z } from 'zod';

export const TERMINOLOGY_OPERATION_ID = 'mediflow.terminology.search.v1' as const;
export const OPEN_LOOPS_OPERATION_ID = 'mediflow.patient.open_loops.read.v1' as const;
export const FOLLOW_UP_PROPOSAL_OPERATION_ID = 'mediflow.patient.open_loops.follow_up.propose.v1' as const;
export const SEMANTIC_QUERY_OPERATION_ID = 'mediflow.semantic_query_plan.execute.v1' as const;
export const CHECKUP_STATUS_TRANSITION_OPERATION_ID = 'mediflow.patient.checkup.status.transition.v1' as const;
export const HEADLESS_STATUS_TOOL_ID = 'mediflow.system.headless_status.v1' as const;
export const CAPABILITIES_TOOL_ID = 'mediflow.system.capabilities.v1' as const;
export const RPC_REQUEST_SCHEMA = 'mediflow.aip.operation.request.v1' as const;
export const RPC_RESULT_SCHEMA = 'mediflow.aip.operation.result.v1' as const;

const encoder = new TextEncoder();
const safeText = (maximumBytes: number) => z.string().refine((value) => value.length > 0
  && !/[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(value)
  && encoder.encode(value).byteLength <= maximumBytes);
const safeInteger = z.number().int().safe().nonnegative();
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

export const OPERATION_DESCRIPTORS = Object.freeze([Object.freeze({
  operationId: TERMINOLOGY_OPERATION_ID,
  capabilityId: TERMINOLOGY_OPERATION_ID,
  serviceRef: 'AipTerminologySearchServiceV1',
  maximumStage: 'read_only' as const,
  inputSchema: 'mediflow.terminology.search.input.v1',
  outputSchema: 'mediflow.terminology.search.output.v1',
}), Object.freeze({
  operationId: OPEN_LOOPS_OPERATION_ID,
  capabilityId: OPEN_LOOPS_OPERATION_ID,
  serviceRef: 'PatientOpenLoopsReadServiceV1',
  maximumStage: 'read_only' as const,
  inputSchema: 'mediflow.patient.open_loops.read.input.v1',
  outputSchema: 'mediflow.patient.open_loops.read.result.v1',
}), Object.freeze({
  operationId: FOLLOW_UP_PROPOSAL_OPERATION_ID,
  capabilityId: FOLLOW_UP_PROPOSAL_OPERATION_ID,
  serviceRef: 'PatientOpenLoopsFollowUpProposalServiceV1',
  maximumStage: 'proposal_only' as const,
  inputSchema: 'mediflow.patient.open_loops.follow_up.propose.input.v1',
  outputSchema: 'mediflow.patient.open_loops.follow_up.proposal.v1',
}), Object.freeze({
  operationId: CHECKUP_STATUS_TRANSITION_OPERATION_ID,
  capabilityId: CHECKUP_STATUS_TRANSITION_OPERATION_ID,
  serviceRef: 'HeadlessCheckupStatusTransitionServiceV1',
  maximumStage: 'proposal_only' as const,
  inputSchema: 'mediflow.patient.checkup.status.transition.input.v1',
  outputSchema: 'mediflow.patient.checkup.status.transition.preview-result.v1',
}), Object.freeze({
  operationId: SEMANTIC_QUERY_OPERATION_ID,
  capabilityId: SEMANTIC_QUERY_OPERATION_ID,
  serviceRef: 'SemanticQueryOperationServiceV1',
  maximumStage: 'read_only' as const,
  inputSchema: 'mediflow.semantic-query-operation.input.v1',
  outputSchema: 'mediflow.semantic-query-execution.result.v1',
})]);
export type OperationDescriptor = (typeof OPERATION_DESCRIPTORS)[number];

export const systemArgumentsSchema = z.object({}).strict();
export const HEADLESS_STATUS = Object.freeze({
  schemaVersion: 'mediflow.system.headless-status.v1' as const,
  candidateVersion: '0.8.5' as const,
  protocolVersion: '2026-07-28' as const,
  dataScope: 'non_phi_system_status' as const,
  writes: 0 as const,
  apply: 'none' as const,
});
export const headlessStatusOutputSchema = z.object({
  schemaVersion: z.literal(HEADLESS_STATUS.schemaVersion),
  candidateVersion: z.literal(HEADLESS_STATUS.candidateVersion),
  protocolVersion: z.literal(HEADLESS_STATUS.protocolVersion),
  dataScope: z.literal(HEADLESS_STATUS.dataScope), writes: z.literal(0), apply: z.literal('none'),
}).strict();

export const rpcOperationSchema = z.object({
  operationId: z.string(), capabilityId: z.string(), serviceRef: z.string(),
  maximumStage: z.enum(['read_only', 'proposal_only']),
}).strict();
const publicOperationSchema = z.object({
  operationId: z.string(), capabilityId: z.string(), maximumStage: z.enum(['read_only', 'proposal_only']),
  inputSchema: z.string(), outputSchema: z.string(),
}).strict();
export const capabilitiesOutputSchema = z.object({
  schemaVersion: z.literal('mediflow.system.capabilities.v1'),
  operations: z.array(publicOperationSchema).max(32),
}).strict();

export const terminologyArgumentsSchema = z.object({
  system: z.enum(['LOINC', 'UCUM']),
  query: safeText(512).refine((value) => {
    const bytes = encoder.encode(value.trim().replace(/\s+/gu, ' ')).byteLength;
    return bytes >= 1 && bytes <= 96;
  }),
  limit: z.number().int().min(1).max(10),
}).strict();

const terminologyItemSchema = z.object({
  system: z.enum(['LOINC', 'UCUM']), code: safeText(64), display: safeText(256),
  displayIt: safeText(256).optional(), defaultUnit: safeText(64).optional(),
  version: safeText(32).nullable(),
}).strict();
const terminologyReceiptSchema = z.object({
  schemaVersion: z.literal('mediflow.terminology.search.receipt.v1'),
  receiptRef: z.string().regex(/^[a-z][a-z0-9._-]{15,127}$/u),
  operationId: z.literal(TERMINOLOGY_OPERATION_ID), capabilityId: z.literal(TERMINOLOGY_OPERATION_ID),
  outcome: z.literal('read'), system: z.enum(['LOINC', 'UCUM']), resultCount: safeInteger.max(10),
  catalogSource: z.literal('local-pilot-catalog'), egress: z.literal('none'),
  writesPerformed: z.literal(0), fabricDependency: z.literal('none'), timestamp: safeInteger,
}).strict();
export const terminologyOutputSchema = z.object({
  schemaVersion: z.literal('mediflow.terminology.search.output.v1'),
  operationId: z.literal(TERMINOLOGY_OPERATION_ID), capabilityId: z.literal(TERMINOLOGY_OPERATION_ID),
  applicationServiceRef: z.literal('AipTerminologySearchServiceV1'), outcome: z.literal('read'),
  items: z.array(terminologyItemSchema).max(10), receipt: terminologyReceiptSchema,
}).strict().superRefine((value, context) => {
  const codes = new Set(value.items.map((item) => item.code));
  if (value.items.length !== value.receipt.resultCount || codes.size !== value.items.length
      || value.items.some((item) => item.system !== value.receipt.system)) {
    context.addIssue({ code: 'custom', message: 'receipt_mismatch' });
  }
  if (encoder.encode(JSON.stringify(value)).byteLength > 16 * 1024) {
    context.addIssue({ code: 'custom', message: 'output_oversized' });
  }
});

export const openLoopsArgumentsSchema = z.object({}).strict();
export const followUpProposalArgumentsSchema = z.object({}).strict();
export const checkupStatusTransitionArgumentsSchema = z.object({
  checkupRef: z.string().regex(/^hcsr_[0-9a-f]{64}$/u),
  targetStatus: z.enum(['completed', 'cancelled']),
  expectedRevision: z.number().int().safe().min(1).max(Number.MAX_SAFE_INTEGER - 1),
}).strict();
const checkupStatusTransitionDenialSchema = z.enum(['invalid_input', 'operation_unavailable',
  'resource_unavailable', 'scope_changed', 'session_unavailable', 'role_unavailable', 'preview_expired',
  'confirmation_required', 'proof_unavailable', 'proof_replayed', 'revision_conflict',
  'transition_unavailable', 'idempotency_conflict', 'audit_unavailable', 'commit_unavailable',
  'restart_changed']);
export const checkupStatusTransitionOutputSchema = z.discriminatedUnion('outcome', [z.object({
  schemaVersion: z.literal('mediflow.patient.checkup.status.transition.preview-result.v1'),
  operationId: z.literal(CHECKUP_STATUS_TRANSITION_OPERATION_ID), outcome: z.literal('proposed'),
  proposalRef: z.string().regex(/^hcsp_[0-9a-f]{64}$/u), expiresAt: safeInteger.min(1),
}).strict(), z.object({
  schemaVersion: z.literal('mediflow.patient.checkup.status.transition.preview-result.v1'),
  operationId: z.literal(CHECKUP_STATUS_TRANSITION_OPERATION_ID), outcome: z.literal('denied'),
  denialCode: checkupStatusTransitionDenialSchema,
}).strict()]);
const openLoopItemSchema = z.object({
  loopRef: z.string().regex(/^aipl_[0-9a-f]{64}$/u),
  kind: z.enum(['results_pending', 'series_stalled', 'registered_expectation']),
  temporalState: z.enum(['open', 'overdue', 'unscheduled']), openedAt: safeInteger,
  dueAt: safeInteger.nullable(), revision: z.number().int().safe().min(1),
}).strict();
const openLoopsReceiptSchema = z.object({
  schemaVersion: z.literal('mediflow.patient.open_loops.read.receipt.v1'),
  receiptRef: z.string().regex(/^aipr_[0-9a-f]{64}$/u), operationId: z.literal(OPEN_LOOPS_OPERATION_ID),
  capabilityId: z.literal(OPEN_LOOPS_OPERATION_ID), outcome: z.literal('read'),
  ownerRefHash: digest, leaseRefHash: digest, receiptRefHash: digest,
  generation: z.number().int().safe().min(1), revocationGeneration: safeInteger,
  selectionEpoch: safeInteger, snapshotRevision: z.number().int().safe().min(1),
  itemCount: safeInteger.max(32), truncated: z.boolean(), timestamp: safeInteger,
}).strict();
export const openLoopsOutputSchema = z.object({
  schemaVersion: z.literal('mediflow.patient.open_loops.read.result.v1'),
  operationId: z.literal(OPEN_LOOPS_OPERATION_ID), capabilityId: z.literal(OPEN_LOOPS_OPERATION_ID),
  outcome: z.literal('read'), items: z.array(openLoopItemSchema).max(32), truncated: z.boolean(),
  snapshotRevision: z.number().int().safe().min(1), receipt: openLoopsReceiptSchema,
}).strict().superRefine((value, context) => {
  const references = new Set(value.items.map((item) => item.loopRef));
  const temporalInvalid = value.items.some((item) => item.openedAt > value.receipt.timestamp
    || (item.temporalState === 'unscheduled' && item.dueAt !== null)
    || (item.temporalState === 'overdue' && (item.dueAt === null || item.dueAt < item.openedAt
      || item.dueAt >= value.receipt.timestamp))
    || (item.temporalState === 'open' && (item.dueAt === null || item.dueAt < item.openedAt)));
  if (value.items.length !== value.receipt.itemCount || references.size !== value.items.length || temporalInvalid
      || value.truncated !== value.receipt.truncated
      || value.snapshotRevision !== value.receipt.snapshotRevision) {
    context.addIssue({ code: 'custom', message: 'receipt_mismatch' });
  }
});

const followUpProposalItemSchema = z.object({
  loopRef: z.string().regex(/^aipl_[0-9a-f]{64}$/u),
  action: z.enum(['review_result', 'review_measurement_series', 'review_expected_follow_up']),
}).strict();
const followUpProposalReceiptSchema = z.object({
  schemaVersion: z.literal('mediflow.patient.open_loops.follow_up.proposal.receipt.v1'),
  receiptRef: z.string().regex(/^aipfr_[0-9a-f]{64}$/u),
  operationId: z.literal(FOLLOW_UP_PROPOSAL_OPERATION_ID),
  capabilityId: z.literal(FOLLOW_UP_PROPOSAL_OPERATION_ID),
  applicationServiceRef: z.literal('PatientOpenLoopsFollowUpProposalServiceV1'),
  outcome: z.literal('proposed'), proposalRefHash: digest, receiptRefHash: digest, sourceReceiptRefHash: digest,
  basedOnSnapshotRevision: z.number().int().safe().min(1), itemCount: safeInteger.max(32), truncated: z.boolean(),
  maximumStage: z.literal('proposal_only'), reviewRequired: z.literal(true), writesPerformed: z.literal(0),
  apply: z.literal('none'), egress: z.literal('none'), timestamp: safeInteger,
}).strict();
export const followUpProposalOutputSchema = z.object({
  schemaVersion: z.literal('mediflow.patient.open_loops.follow_up.proposal.v1'),
  operationId: z.literal(FOLLOW_UP_PROPOSAL_OPERATION_ID),
  capabilityId: z.literal(FOLLOW_UP_PROPOSAL_OPERATION_ID),
  applicationServiceRef: z.literal('PatientOpenLoopsFollowUpProposalServiceV1'), outcome: z.literal('proposed'),
  maximumStage: z.literal('proposal_only'), reviewRequired: z.literal(true), writesPerformed: z.literal(0),
  apply: z.literal('none'), proposalRef: z.string().regex(/^aipfp_[0-9a-f]{64}$/u),
  basedOnSnapshotRevision: z.number().int().safe().min(1), items: z.array(followUpProposalItemSchema).max(32),
  receipt: followUpProposalReceiptSchema,
}).strict().superRefine((value, context) => {
  const references = new Set(value.items.map((item) => item.loopRef));
  if (references.size !== value.items.length || value.items.length !== value.receipt.itemCount
      || value.basedOnSnapshotRevision !== value.receipt.basedOnSnapshotRevision) {
    context.addIssue({ code: 'custom', message: 'receipt_mismatch' });
  }
  if (encoder.encode(JSON.stringify(value)).byteLength > 16 * 1024) {
    context.addIssue({ code: 'custom', message: 'output_oversized' });
  }
});

const semanticStepRef = z.string().regex(/^step_[a-z0-9_]{1,48}$/u);
const semanticBudgetSchema = z.object({
  maxSteps: z.number().int().min(1).max(2), maxDurationMs: z.number().int().min(1).max(250),
  maxOutputBytes: z.number().int().min(1).max(32 * 1024),
}).strict();
const semanticQueryStepSchema = z.discriminatedUnion('operationId', [z.object({
  stepRef: semanticStepRef, operationId: z.literal(TERMINOLOGY_OPERATION_ID), input: terminologyArgumentsSchema,
}).strict(), z.object({
  stepRef: semanticStepRef, operationId: z.literal(OPEN_LOOPS_OPERATION_ID), input: openLoopsArgumentsSchema,
}).strict()]);
export const semanticQueryArgumentsSchema = z.object({
  budget: semanticBudgetSchema,
  explanation: safeText(512).refine((value) => value.length >= 8 && value.trim() === value),
  steps: z.array(semanticQueryStepSchema).min(1).max(2),
}).strict().superRefine((value, context) => {
  if (value.steps.length !== value.budget.maxSteps
      || new Set(value.steps.map((step) => step.stepRef)).size !== value.steps.length) {
    context.addIssue({ code: 'custom', message: 'plan_mismatch' });
  }
});

const semanticOutputStepSchema = z.discriminatedUnion('operationId', [z.object({
  stepRef: semanticStepRef, operationId: z.literal(TERMINOLOGY_OPERATION_ID), output: terminologyOutputSchema,
}).strict(), z.object({
  stepRef: semanticStepRef, operationId: z.literal(OPEN_LOOPS_OPERATION_ID), output: openLoopsOutputSchema,
}).strict()]);
const semanticReceiptSchema = z.object({
  schemaVersion: z.literal('mediflow.headless.receipt.v1'),
  requestRef: z.string().regex(/^sqrq_[0-9a-f]{64}$/u), actionRef: z.string().regex(/^sqra_[0-9a-f]{64}$/u),
  capabilityId: z.literal(SEMANTIC_QUERY_OPERATION_ID), outcome: z.literal('orchestration'),
  policyDecision: z.literal('allowed'), revisionBinding: z.object({
    generation: z.number().int().safe().min(1), revocationGeneration: safeInteger, selectionEpoch: safeInteger,
  }).strict(), operationCount: z.number().int().min(1).max(2), durationMs: safeInteger, createdAt: safeInteger,
  writesPerformed: z.literal(0), applyPolicy: z.literal('none'),
}).strict();
export const semanticQueryOutputSchema = z.object({
  schemaVersion: z.literal('mediflow.semantic-query-execution.result.v1'), outcome: z.literal('read_completed'),
  steps: z.array(semanticOutputStepSchema).min(1).max(2), receipt: semanticReceiptSchema,
}).strict().superRefine((value, context) => {
  if (value.steps.length !== value.receipt.operationCount
      || new Set(value.steps.map((step) => step.stepRef)).size !== value.steps.length
      || value.steps.some((step) => step.operationId === OPEN_LOOPS_OPERATION_ID
        && (step.output.receipt.generation !== value.receipt.revisionBinding.generation
          || step.output.receipt.revocationGeneration !== value.receipt.revisionBinding.revocationGeneration
          || step.output.receipt.selectionEpoch !== value.receipt.revisionBinding.selectionEpoch
          || step.output.receipt.timestamp > value.receipt.createdAt))) {
    context.addIssue({ code: 'custom', message: 'receipt_mismatch' });
  }
  if (encoder.encode(JSON.stringify(value)).byteLength > 32 * 1024) {
    context.addIssue({ code: 'custom', message: 'output_oversized' });
  }
});

export function selectBoundOperations(value: unknown): readonly OperationDescriptor[] {
  const parsed = z.array(rpcOperationSchema).max(32).safeParse(value);
  if (!parsed.success) return Object.freeze([]);
  return Object.freeze(OPERATION_DESCRIPTORS.filter((expected) => parsed.data.some((actual) =>
    actual.operationId === expected.operationId && actual.capabilityId === expected.capabilityId
    && actual.serviceRef === expected.serviceRef && actual.maximumStage === expected.maximumStage)));
}

export function publicCatalog(operations: readonly OperationDescriptor[]) {
  return Object.freeze({ schemaVersion: 'mediflow.system.capabilities.v1' as const,
    operations: Object.freeze(operations.map(({ operationId, capabilityId, maximumStage, inputSchema, outputSchema }) =>
      Object.freeze({ operationId, capabilityId, maximumStage, inputSchema, outputSchema }))) });
}
