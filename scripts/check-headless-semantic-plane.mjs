/* @Codex */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validatePlaneInventories } from './check-fabric-headless-plane-inventories.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PATH = `${ROOT}/docs/headless/semantic-plane.v1.json`;
const json = () => JSON.parse(readFileSync(PATH, 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const fail = (message) => { throw new Error(`headless semantic plane: ${message}`); };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const exact = (value, keys, label) => { if (!value || !same(Object.keys(value).sort(), [...keys].sort())) fail(`${label} contract drifted`); };
const FLOW = ['intent', 'planner_orchestrator', 'capability_application_service_graph', 'policy_authority_boundary', 'execution', 'receipt', 'response'];
const OUTCOMES = ['discovery', 'read', 'query', 'orchestration', 'preview', 'proposal', 'denial'];
const GRAPH_SCOPE = ['application_topology', 'substrates', 'containers', 'modules', 'functions'];
const OPERATION_FIELDS = ['operationId', 'capabilityId', 'applicationServiceRef', 'inputSchema', 'outputSchema', 'maximumStage', 'authorityPolicy', 'sessionPolicy', 'casPolicy', 'idempotencyPolicy', 'limitPolicy', 'receiptPolicy', 'fabricDependency'];
const RECEIPT_FIELDS = ['requestRef', 'actionRef', 'capabilityId', 'outcome', 'policyDecision', 'revisionBinding', 'createdAt'];
const FORBIDDEN_RECEIPT = ['name', 'codiceFiscale', 'patientId', 'clinicalPayload', 'prompt', 'modelOutput', 'credential', 'cookie', 'token', 'sql'];

function source(value, ref, blob, count, label) {
  exact(value, count ? ['ref', 'gitBlob', 'expectedCount'] : ['ref', 'gitBlob'], label);
  if (value.ref !== ref || value.gitBlob !== blob || (count && value.expectedCount !== count) || git('rev-parse', ref) !== blob) fail(`${label} source drifted`);
}

export function validateHeadlessSemanticPlane(plane = json()) {
  validatePlaneInventories();
  exact(plane, ['schema', 'version', 'status', 'semanticIdentity', 'applyPolicy', 'writesPerformed', 'sources', 'intentAdapters', 'flow', 'graphScope', 'plannerPolicy', 'operationContract', 'boundaryPolicy', 'allowedOutcomes', 'transports', 'receipt', 'failurePolicy', 'claimCeiling'], 'plane');
  if (plane.schema !== 'mediflow.headless.semantic-plane.v1' || plane.version !== 1 || plane.status !== 'candidate_not_integrated' || plane.semanticIdentity !== 'canonical_application_function') fail('semantic identity is invalid');
  if (plane.applyPolicy !== 'none' || plane.writesPerformed !== 0) fail('apply or write is forbidden');
  exact(plane.sources, ['adr0100', 'headlessInventory', 'fabricInventory'], 'sources');
  source(plane.sources.adr0100, '54b56c2bb4a9eb1bd76f198fc58457ebd7623e5b:docs/adr/0100-fabric-vs-headless-semantic-plane.md', 'e9abf64d566ff54d7d767f03580ea911bc6ef32e', 0, 'ADR');
  source(plane.sources.headlessInventory, 'a26141e406bd6a33e5c204b8a8d3c53a74176ab5:docs/capability-mapping/headless-plane-inventory.v1.json', '8ef68abef78170a61d7b8b5b0e43267d0ac038e6', 66, 'Headless inventory');
  source(plane.sources.fabricInventory, 'a26141e406bd6a33e5c204b8a8d3c53a74176ab5:docs/capability-mapping/fabric-plane-inventory.v1.json', '13eaff27d01b8769320316f39181c83dfb924bab', 16, 'Fabric inventory');
  if (!same(plane.intentAdapters, [{ kind: 'chat', role: 'input_only', authority: 'none' }, { kind: 'voice', role: 'input_only', authority: 'none' }]) || !same(plane.flow, FLOW) || !same(plane.graphScope, GRAPH_SCOPE)) fail('flow or intent adapter drifted');
  exact(plane.plannerPolicy, ['composition', 'authority', 'providerSelection', 'venueSelection', 'confirmation', 'freePromptExecution'], 'planner');
  if (!same(plane.plannerPolicy, { composition: 'dynamic_composition_of_named_operations', authority: 'host_owned_only', providerSelection: 'forbidden', venueSelection: 'forbidden', confirmation: 'host_owned_only', freePromptExecution: 'forbidden' })) fail('planner policy grants authority or provider choice');
  exact(plane.operationContract, ['source', 'currentDisposition', 'authority', 'stage', 'requiredFields'], 'operation');
  if (plane.operationContract.source !== 'headless_inventory_66' || plane.operationContract.currentDisposition !== 'manual_only' || plane.operationContract.authority !== 'not_grantable' || plane.operationContract.stage !== 'unresolved' || !same(plane.operationContract.requiredFields, OPERATION_FIELDS)) fail('operation contract grants or loses a boundary');
  const boundary = { session: 'required', activeRole: 'required', authorization: 'per_operation', leaseEpoch: 'required', revocation: 'fail_closed', cas: 'required_for_mutation_but_mutation_unavailable_0.8.5', idempotency: 'required', limits: 'required', audit: 'phi_safe', execution: 'application_service_only', directSqlite: 'forbidden' };
  exact(plane.boundaryPolicy, Object.keys(boundary), 'boundary'); if (!same(plane.boundaryPolicy, boundary)) fail('boundary policy drifted');
  if (!same(plane.allowedOutcomes, OUTCOMES)) fail('outcome contract includes write or apply');
  if (!same(plane.transports, { status: 'not_selected', adapters: [], definition: 'adapter_not_semantics' })) fail('transport defines semantics');
  exact(plane.receipt, ['schema', 'requiredFields', 'forbiddenFields'], 'receipt');
  if (plane.receipt.schema !== 'mediflow.headless.receipt.v1' || !same(plane.receipt.requiredFields, RECEIPT_FIELDS) || !same(plane.receipt.forbiddenFields, FORBIDDEN_RECEIPT)) fail('receipt contract is not PHI-safe');
  if (plane.failurePolicy !== 'deny_without_execution_or_receipt_overclaim' || plane.claimCeiling !== 'P2 semantic Headless contract only; no planner runtime, adapter, authority, execution, integration, release, or apply') fail('claim or failure policy drifted');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) validateHeadlessSemanticPlane();
