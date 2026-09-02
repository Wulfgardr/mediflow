/* @Codex */
import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { types } from 'node:util';

import { eq } from 'drizzle-orm';

import { dbServer, runDbServerImmediateTransaction } from '../db-server';
import { auditEvents } from '../schema';
import { AUDIT_SCHEMA_VERSION } from './audit';

const SOURCE_KEYS = ['now', 'readHostContext'] as const;
const CONTEXT_KEYS = ['status', 'userRef', 'parentRef', 'purposeCode', 'patientId', 'ambulatoryId',
  'generation', 'revocationGeneration', 'selectionEpoch', 'restartGeneration', 'parentGeneration',
  'policyGeneration', 'expiresAt', 'bootstrapExpiresAt'] as const;
const STABLE_CONTEXT_KEYS = CONTEXT_KEYS.filter((key) => key !== 'bootstrapExpiresAt');
const AUTH_KEYS = ['schemaVersion', 'eventType', 'outcome', 'operation', 'capabilityId', 'agentRefHash',
  'leaseRefHash', 'purposeCode', 'maxStage', 'generation', 'selectionEpoch', 'timestamp', 'denialCode',
  'budgetUsed'] as const;
const BOOTSTRAP_KEYS = ['schemaVersion', 'eventType', 'outcome', 'transport', 'peerRefHash',
  'runtimeRefHash', 'timestamp', 'denialCode'] as const;
const TERMINOLOGY_KEYS = ['schemaVersion', 'eventType', 'outcome', 'operation', 'capabilityId',
  'receiptRef', 'system', 'resultCount', 'maxStage', 'egress', 'writesPerformed', 'timestamp',
  'denialCode'] as const;
const OPEN_ALLOWED_KEYS = ['schemaVersion', 'eventType', 'outcome', 'operation', 'capabilityId',
  'purposeCode', 'maxStage', 'ownerRefHash', 'leaseRefHash', 'receiptRefHash', 'generation',
  'revocationGeneration', 'selectionEpoch', 'snapshotRevision', 'itemCount', 'truncated', 'egress',
  'writesPerformed', 'timestamp', 'denialCode'] as const;
const OPEN_DENIED_KEYS = ['schemaVersion', 'eventType', 'outcome', 'operation', 'capabilityId',
  'purposeCode', 'maxStage', 'ownerRefHash', 'leaseRefHash', 'receiptRefHash', 'itemCount', 'truncated',
  'egress', 'writesPerformed', 'timestamp', 'denialCode'] as const;
const PROPOSAL_KEYS = ['schemaVersion', 'eventType', 'outcome', 'operation', 'capabilityId',
  'proposalRefHash', 'receiptRefHash', 'sourceReceiptRefHash', 'basedOnSnapshotRevision', 'itemCount',
  'maximumStage', 'reviewRequired', 'writesPerformed', 'apply', 'egress', 'timestamp', 'denialCode'] as const;
const USER_REF = /^user\.[0-9a-f]{64}$/u, PARENT_REF = /^parent\.[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u, REF = /^[a-z][a-z0-9._-]{15,127}$/u;
const OPERATION_STAGES = new Map<string, 'read_only' | 'proposal_only'>([
  ['mediflow.system.agent_session.v1', 'proposal_only'], ['mediflow.terminology.search.v1', 'read_only'],
  ['mediflow.patient.open_loops.read.v1', 'read_only'],
  ['mediflow.patient.open_loops.follow_up.propose.v1', 'proposal_only'],
  ['mediflow.semantic_query_plan.execute.v1', 'read_only'],
  ['mediflow.patient.checkup.status.transition.v1', 'proposal_only'],
]);
const AUTH_DENIALS = new Set(['input_invalid', 'owner_invalid', 'lease_invalid', 'permit_invalid',
  'permit_replay', 'permit_revoked', 'currentness_invalid', 'claim_invalid', 'reference_invalid',
  'clock_invalid', 'audit_failed', 'peer_mismatch', 'runtime_mismatch', 'lease_replay', 'lease_revoked',
  'generation_changed', 'revoked', 'selection_changed', 'parent_disposed', 'policy_changed',
  'claim_mismatch', 'scope_changed', 'expired', 'budget_exhausted', 'restart_changed']);
const IPC_DENIALS = new Set(['input_invalid', 'connection_invalid', 'frame_invalid', 'frame_oversized',
  'peer_denied', 'permission_denied', 'identity_mismatch', 'bootstrap_invalid', 'bootstrap_replay',
  'bootstrap_expired', 'timeout', 'cancelled', 'restart_changed', 'clock_invalid', 'reference_invalid',
  'audit_failed', 'broker_failed', 'output_oversized']);
const TERM_DENIALS = new Set(['input_invalid', 'authorization_denied', 'catalog_invalid', 'timeout',
  'cancelled', 'disposed', 'reference_invalid', 'clock_invalid', 'audit_failed']);
const OPEN_DENIALS = new Set(['invalid_input', 'operation_unavailable', 'authorization_denied',
  'owner_unavailable', 'lease_unavailable', 'lease_replay', 'scope_changed', 'revoked', 'expired',
  'timeout', 'cancelled', 'restart_changed', 'snapshot_unavailable', 'audit_unavailable', 'disposed']);
const PROPOSAL_DENIALS = new Set(['invalid_input', 'authorization_denied', 'read_unavailable',
  'reference_invalid', 'audit_unavailable', 'timeout', 'cancelled', 'disposed']);
const TRANSPORTS = new Set(['xpc', 'uds', 'named_pipe', 'inherited_child_ipc']);
const NativePromise = Promise;
const { isAsyncFunction, isPromise, isProxy } = types;

type CanonicalRecord = Record<string, unknown>;
type ParsedAudit = Readonly<{ outcome: 'allowed' | 'denied'; flags: readonly string[]; counts?: number;
  resourceVersion?: number; denialCode: string | null; generation?: number;
  revocationGeneration?: number; selectionEpoch?: number }>;

export class PortableSupervisorAipAuditPortV1Error extends Error {
  constructor(readonly code: 'audit_unavailable' | 'context_unavailable') {
    super(`Portable supervisor AIP audit ${code}`);
    this.name = 'PortableSupervisorAipAuditPortV1Error';
  }
}

function fail(code: 'audit_unavailable' | 'context_unavailable' = 'audit_unavailable'): never {
  throw new PortableSupervisorAipAuditPortV1Error(code);
}

function exact(value: unknown, keys: readonly string[], canonical: boolean): CanonicalRecord | null {
  try {
    if (!value || typeof value !== 'object' || isProxy(value) || isPromise(value) || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if ((canonical && !Object.isFrozen(value)) || (prototype !== null && prototype !== Object.prototype)) return null;
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length || own.some((key, index) => key !== keys[index])) return null;
    const output = Object.create(null) as CanonicalRecord;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)
        || (canonical && (descriptor.writable || descriptor.configurable))) return null;
      output[key] = descriptor.value;
    }
    return Object.freeze(output);
  } catch { return null; }
}

function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function digest(value: unknown): value is string { return typeof value === 'string' && DIGEST.test(value); }

function hashRef(domain: string, value: string): string {
  const hash = createHash('sha256').update(`mediflow.agent.audit.${domain}.v1\0`, 'utf8').update(value, 'utf8').digest('hex');
  return `sha256:${hash.slice(0, 16)}`;
}

function refFlag(name: string, value: string): string { return `${name}:${hashRef(`flag.${name}`, value)}`; }

function common(value: CanonicalRecord, denials: ReadonlySet<string>): 'allowed' | 'denied' {
  if (!integer(value.timestamp)) return fail();
  if (value.outcome === 'allowed' && value.denialCode === null) return 'allowed';
  if (value.outcome === 'denied' && typeof value.denialCode === 'string' && denials.has(value.denialCode)) return 'denied';
  return fail();
}

function parsed(value: ParsedAudit): ParsedAudit { return Object.freeze(value); }

function parseAuthorization(value: unknown): ParsedAudit | null {
  const item = exact(value, AUTH_KEYS, true);
  if (!item) return null;
  const outcome = common(item, AUTH_DENIALS);
  const expectedStage = typeof item.operation === 'string' ? OPERATION_STAGES.get(item.operation) : undefined;
  if (item.schemaVersion !== 'mediflow.aip.audit.v1' || item.eventType !== 'authorization'
    || !expectedStage || item.capabilityId !== item.operation || !digest(item.agentRefHash)
    || !digest(item.leaseRefHash) || item.purposeCode !== 'care_coordination' || item.maxStage !== expectedStage
    || !integer(item.generation, 1)
    || !integer(item.selectionEpoch) || !integer(item.budgetUsed, outcome === 'allowed' ? 1 : 0)) return fail();
  return parsed({ outcome, flags: Object.freeze([`family:authorization`, `operation:${item.operation}`,
    `capability:${item.capabilityId}`, `aip_outcome:${outcome}`, `purpose:${item.purposeCode}`,
    `max_stage:${item.maxStage}`, `generation:${item.generation}`, `selection_epoch:${item.selectionEpoch}`,
    refFlag('agent_ref', item.agentRefHash), refFlag('lease_ref', item.leaseRefHash)]),
  counts: item.budgetUsed as number, denialCode: item.denialCode as string | null,
  generation: item.generation as number, selectionEpoch: item.selectionEpoch as number });
}

function parseBootstrap(value: unknown): ParsedAudit | null {
  const item = exact(value, BOOTSTRAP_KEYS, true);
  if (!item) return null;
  const outcome = common(item, IPC_DENIALS);
  const hasPeer = TRANSPORTS.has(item.transport as string) && digest(item.peerRefHash) && digest(item.runtimeRefHash);
  if (item.schemaVersion !== 'mediflow.aip.ipc.audit.v1' || item.eventType !== 'bootstrap'
    || (!(item.transport === null && item.peerRefHash === null && item.runtimeRefHash === null) && !hasPeer)
    || (outcome === 'allowed' && !hasPeer)) return fail();
  return parsed({ outcome, flags: Object.freeze([`family:bootstrap`, `aip_outcome:${outcome}`,
    ...(hasPeer ? [`transport:${item.transport}`, refFlag('peer_ref', item.peerRefHash as string),
      refFlag('runtime_ref', item.runtimeRefHash as string)] : [])]), denialCode: item.denialCode as string | null });
}

function parseTerminology(value: unknown): ParsedAudit | null {
  const item = exact(value, TERMINOLOGY_KEYS, true);
  if (!item) return null;
  const outcome = common(item, TERM_DENIALS), allowedRef = typeof item.receiptRef === 'string' && REF.test(item.receiptRef);
  if (item.schemaVersion !== 'mediflow.aip.audit.v1' || item.eventType !== 'terminology_search'
    || item.operation !== 'mediflow.terminology.search.v1' || item.capabilityId !== item.operation
    || (item.system !== 'LOINC' && item.system !== 'UCUM') || !integer(item.resultCount)
    || item.resultCount > 10 || item.maxStage !== 'read_only' || item.egress !== 'none'
    || item.writesPerformed !== 0 || (outcome === 'allowed' ? !allowedRef : item.receiptRef !== null || item.resultCount !== 0)) return fail();
  return parsed({ outcome, flags: Object.freeze([`family:terminology_search`, `operation:${item.operation}`,
    `capability:${item.capabilityId}`, `aip_outcome:${outcome}`, `system:${item.system}`,
    `max_stage:read_only`, `egress:none`, `writes:0`, ...(allowedRef ? [refFlag('receipt_ref', item.receiptRef as string)] : [])]),
  counts: item.resultCount as number, denialCode: item.denialCode as string | null });
}

function parseOpenLoops(value: unknown): ParsedAudit | null {
  const allowed = exact(value, OPEN_ALLOWED_KEYS, true), denied = allowed ? null : exact(value, OPEN_DENIED_KEYS, true);
  const item = allowed ?? denied;
  if (!item) return null;
  const outcome = common(item, OPEN_DENIALS), isAllowed = outcome === 'allowed';
  if (item.schemaVersion !== 'mediflow.aip.audit.v1' || item.eventType !== 'patient_open_loops_read'
    || item.operation !== 'mediflow.patient.open_loops.read.v1' || item.capabilityId !== item.operation
    || item.purposeCode !== 'care_coordination' || item.maxStage !== 'read_only' || item.egress !== 'none'
    || item.writesPerformed !== 0 || !integer(item.itemCount) || item.itemCount > 32 || typeof item.truncated !== 'boolean'
    || (isAllowed && (!allowed || !digest(item.ownerRefHash) || !digest(item.leaseRefHash)
      || !digest(item.receiptRefHash) || !integer(item.generation, 1) || !integer(item.revocationGeneration)
      || !integer(item.selectionEpoch) || !integer(item.snapshotRevision, 1)))
    || (!isAllowed && (!denied || item.ownerRefHash !== null || item.leaseRefHash !== null
      || item.receiptRefHash !== null || item.itemCount !== 0 || item.truncated !== false))) return fail();
  return parsed({ outcome, flags: Object.freeze([`family:patient_open_loops_read`, `operation:${item.operation}`,
    `capability:${item.capabilityId}`, `aip_outcome:${outcome}`, `purpose:care_coordination`,
    `max_stage:read_only`, `egress:none`, `writes:0`, `truncated:${item.truncated}`,
    ...(isAllowed ? [`generation:${item.generation}`, `revocation_generation:${item.revocationGeneration}`,
      `selection_epoch:${item.selectionEpoch}`, refFlag('owner_ref', item.ownerRefHash as string),
      refFlag('lease_ref', item.leaseRefHash as string), refFlag('receipt_ref', item.receiptRefHash as string)] : [])]),
  counts: item.itemCount as number, ...(isAllowed ? { resourceVersion: item.snapshotRevision as number,
    generation: item.generation as number, revocationGeneration: item.revocationGeneration as number,
    selectionEpoch: item.selectionEpoch as number } : {}), denialCode: item.denialCode as string | null });
}

function parseProposal(value: unknown): ParsedAudit | null {
  const item = exact(value, PROPOSAL_KEYS, true);
  if (!item) return null;
  const outcome = common(item, PROPOSAL_DENIALS), isAllowed = outcome === 'allowed';
  if (item.schemaVersion !== 'mediflow.aip.audit.v1' || item.eventType !== 'patient_open_loops_follow_up_proposal'
    || item.operation !== 'mediflow.patient.open_loops.follow_up.propose.v1' || item.capabilityId !== item.operation
    || !integer(item.itemCount) || item.itemCount > 32 || item.maximumStage !== 'proposal_only'
    || item.reviewRequired !== true || item.writesPerformed !== 0 || item.apply !== 'none' || item.egress !== 'none'
    || (isAllowed && (!digest(item.proposalRefHash) || !digest(item.receiptRefHash)
      || !digest(item.sourceReceiptRefHash) || !integer(item.basedOnSnapshotRevision, 1)))
    || (!isAllowed && (item.proposalRefHash !== null || item.receiptRefHash !== null
      || item.sourceReceiptRefHash !== null || item.basedOnSnapshotRevision !== null || item.itemCount !== 0))) return fail();
  return parsed({ outcome, flags: Object.freeze([`family:patient_open_loops_follow_up_proposal`,
    `operation:${item.operation}`, `capability:${item.capabilityId}`, `aip_outcome:${outcome}`,
    `max_stage:proposal_only`, `review_required:true`, `writes:0`, `apply:none`, `egress:none`,
    ...(isAllowed ? [refFlag('proposal_ref', item.proposalRefHash as string),
      refFlag('receipt_ref', item.receiptRefHash as string),
      refFlag('source_receipt_ref', item.sourceReceiptRefHash as string)] : [])]),
  counts: item.itemCount as number, ...(isAllowed ? { resourceVersion: item.basedOnSnapshotRevision as number } : {}),
  denialCode: item.denialCode as string | null });
}

function parseAudit(value: unknown): ParsedAudit {
  return parseAuthorization(value) ?? parseBootstrap(value) ?? parseTerminology(value)
    ?? parseOpenLoops(value) ?? parseProposal(value) ?? fail();
}

function hostContext(value: unknown): CanonicalRecord {
  const item = exact(value, CONTEXT_KEYS, true);
  if (!item || item.status !== 'available' || item.purposeCode !== 'care_coordination'
    || typeof item.userRef !== 'string' || !USER_REF.test(item.userRef)
    || typeof item.parentRef !== 'string' || !PARENT_REF.test(item.parentRef)
    || typeof item.patientId !== 'string' || item.patientId.length < 1 || item.patientId.length > 256
    || item.patientId.trim() !== item.patientId || typeof item.ambulatoryId !== 'string'
    || item.ambulatoryId.length < 1 || item.ambulatoryId.length > 256 || item.ambulatoryId.trim() !== item.ambulatoryId
    || !integer(item.generation, 1) || !integer(item.revocationGeneration) || !integer(item.selectionEpoch)
    || !integer(item.restartGeneration, 1) || !integer(item.parentGeneration, 1)
    || !integer(item.policyGeneration, 1) || !integer(item.expiresAt, 1)
    || !integer(item.bootstrapExpiresAt, 1) || item.bootstrapExpiresAt > item.expiresAt) return fail('context_unavailable');
  return item;
}

function sameContext(left: CanonicalRecord, right: CanonicalRecord): boolean {
  return STABLE_CONTEXT_KEYS.every((key) => left[key] === right[key])
    && (right.bootstrapExpiresAt as number) >= (left.bootstrapExpiresAt as number);
}

function bound(audit: ParsedAudit, context: CanonicalRecord): boolean {
  return (audit.generation === undefined || audit.generation === context.generation)
    && (audit.revocationGeneration === undefined || audit.revocationGeneration === context.revocationGeneration)
    && (audit.selectionEpoch === undefined || audit.selectionEpoch === context.selectionEpoch);
}

/** Persists generic AIP attempts while the portable Supervisor context remains current. */
export function createPortableSupervisorAipAuditPortV1(sourcesValue: unknown): (audit: unknown) => Promise<void> {
  const sources = exact(sourcesValue, SOURCE_KEYS, false);
  if (!sources || typeof sources.now !== 'function' || isProxy(sources.now) || isAsyncFunction(sources.now)
    || typeof sources.readHostContext !== 'function' || isProxy(sources.readHostContext)
    || isAsyncFunction(sources.readHostContext)) return fail();
  const nowSource = sources.now as () => unknown, contextSource = sources.readHostContext as () => unknown;
  let lastNow = -1;
  const now = (): number => {
    let value: unknown;
    try { value = nowSource(); } catch { return fail(); }
    if (isPromise(value) || !integer(value) || value < lastNow) return fail();
    lastNow = value;
    return value;
  };
  const readContext = (): CanonicalRecord => {
    let value: unknown;
    try { value = contextSource(); } catch { return fail('context_unavailable'); }
    if (isPromise(value)) return fail('context_unavailable');
    return hostContext(value);
  };
  return (auditValue: unknown): Promise<void> => new NativePromise<void>((resolve, reject) => {
    try {
      const audit = parseAudit(auditValue);
      runDbServerImmediateTransaction(() => {
        const before = readContext(), occurredAtMs = now();
        if (!bound(audit, before) || occurredAtMs >= (before.bootstrapExpiresAt as number)
          || occurredAtMs >= (before.expiresAt as number)) return fail('context_unavailable');
        const eventId = randomUUID(), occurredAt = new Date(occurredAtMs);
        const metadata = JSON.stringify({ flags: audit.flags, ...(audit.counts === undefined ? {} : { counts: audit.counts }),
          ...(audit.resourceVersion === undefined ? {} : { resourceVersion: audit.resourceVersion }),
          ...(audit.denialCode === null ? {} : { reasonCode: audit.denialCode }) });
        const actorRef = hashRef('actor', before.userRef as string), subjectRef = hashRef('subject', before.parentRef as string);
        dbServer.insert(auditEvents).values({ eventId, schemaVersion: AUDIT_SCHEMA_VERSION,
          eventType: 'agent.operation.attempted', occurredAt,
          outcome: audit.outcome === 'allowed' ? 'success' : 'denied', actorType: 'user', actorRef,
          subjectType: 'agent_operation', subjectRef, sourceSurface: 'api', requestId: null,
          redactedMetadata: metadata, createdAt: occurredAt }).run();
        const stored = dbServer.select().from(auditEvents).where(eq(auditEvents.eventId, eventId)).get();
        const after = readContext(), afterNow = now(), storedTime = Math.floor(occurredAtMs / 1_000) * 1_000;
        if (!sameContext(before, after) || !bound(audit, after) || afterNow < occurredAtMs
          || afterNow >= (after.bootstrapExpiresAt as number) || afterNow >= (after.expiresAt as number)
          || !stored || stored.schemaVersion !== AUDIT_SCHEMA_VERSION || stored.eventType !== 'agent.operation.attempted'
          || stored.outcome !== (audit.outcome === 'allowed' ? 'success' : 'denied') || stored.actorType !== 'user'
          || stored.actorRef !== actorRef || stored.subjectType !== 'agent_operation' || stored.subjectRef !== subjectRef
          || stored.sourceSurface !== 'api' || stored.requestId !== null || stored.redactedMetadata !== metadata
          || !(stored.occurredAt instanceof Date) || stored.occurredAt.getTime() !== storedTime
          || !(stored.createdAt instanceof Date) || stored.createdAt.getTime() !== storedTime) return fail('context_unavailable');
      });
      resolve();
    } catch (error) { reject(error); }
  });
}
