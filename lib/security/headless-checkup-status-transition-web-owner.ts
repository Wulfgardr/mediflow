/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { decodeCheckupStatusTransitionIpcFrameV1, encodeCheckupStatusTransitionIpcFrameV1,
  CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1 } from '../../packages/aip/src/checkup-status-transition-ipc.ts';
import { HeadlessCheckupStatusTransitionV1Error, type HeadlessCheckupStatusReceiptV1 } from
  '../../packages/aip/src/checkup-status-transition.ts';
import { createHeadlessCheckupStatusTransitionInternalCandidateV1 } from
  './headless-checkup-status-transition-production.ts';

const OPERATION = 'mediflow.patient.checkup.status.transition.v1';
const SOURCES = ['now', 'readHostScopeCandidate', 'readCurrentUiContext', 'verifyFreshPin', 'writeDenialAudit'] as const;
const SCOPE = ['status', 'actorRef', 'patientId', 'ambulatoryId', 'checkupId', 'generation',
  'revocationGeneration', 'selectionEpoch'] as const;
const UI = ['status', 'actorRef', 'sessionRef', 'role', 'generation', 'revocationGeneration', 'selectionEpoch'] as const;
const GESTURE = ['proposalRef', 'targetStatus', 'expectedRevision'] as const;
const CONFIRM = ['schemaVersion', 'operationId', 'proposalRef', 'targetStatus', 'expectedRevision',
  'candidatePin', 'gesture'] as const;
const PROPOSAL_REF = /^hcsp_[0-9a-f]{64}$/u;
const DENIALS = new Set(['invalid_input', 'operation_unavailable', 'resource_unavailable', 'scope_changed',
  'session_unavailable', 'role_unavailable', 'preview_expired', 'confirmation_required', 'proof_unavailable',
  'proof_replayed', 'revision_conflict', 'transition_unavailable', 'idempotency_conflict', 'audit_unavailable',
  'commit_unavailable', 'restart_changed']);

type Canonical = Record<string, unknown>;
type Proposal = { input: Readonly<Canonical>; state: 'current' | 'pending' | 'committed' | 'terminal';
  expiresAt: number; receipt: HeadlessCheckupStatusReceiptV1 | null };
type Gesture = { proposal: Proposal; binding: Readonly<Canonical>; ui: Readonly<Canonical>; generation: number };

function record<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, value));
}
function exact(value: unknown, keys: readonly string[]): Canonical | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
      || types.isPromise(value)) return null;
    const prototype = Object.getPrototypeOf(value), own = Reflect.ownKeys(value);
    if ((prototype !== null && prototype !== Object.prototype) || own.length !== keys.length
      || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
    const output = Object.create(null) as Canonical;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch { return null; }
}
function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}
function fail(code: ConstructorParameters<typeof HeadlessCheckupStatusTransitionV1Error>[0]): never {
  throw new HeadlessCheckupStatusTransitionV1Error(code);
}
function safeCode(error: unknown): ConstructorParameters<typeof HeadlessCheckupStatusTransitionV1Error>[0] {
  const code = error instanceof Error && 'code' in error ? error.code : null;
  return typeof code === 'string' && DENIALS.has(code)
    ? code as ConstructorParameters<typeof HeadlessCheckupStatusTransitionV1Error>[0] : 'operation_unavailable';
}
function sameCurrent(left: Canonical, right: Canonical): boolean {
  return left.actorRef === right.actorRef && left.generation === right.generation
    && left.revocationGeneration === right.revocationGeneration && left.selectionEpoch === right.selectionEpoch;
}

/** Web-process owner: parent IPC can only create previews; F10 remains on hostUi. */
export function createHeadlessCheckupStatusTransitionWebOwnerV1(sourcesValue: unknown) {
  const sources = exact(sourcesValue, SOURCES);
  if (!sources || SOURCES.some((key) => typeof sources[key] !== 'function' || types.isProxy(sources[key]))) {
    return fail('operation_unavailable');
  }
  const now = sources.now as () => unknown;
  const readScopeSource = sources.readHostScopeCandidate as () => unknown;
  const readUiSource = sources.readCurrentUiContext as () => Promise<unknown>;
  const verifyPin = sources.verifyFreshPin as (pin: string) => Promise<unknown>;
  const writeAudit = sources.writeDenialAudit as (value: unknown) => unknown;
  const candidate = createHeadlessCheckupStatusTransitionInternalCandidateV1(record({ now,
    readHostScopeCandidate: readScopeSource }));
  const proposals = new Map<string, Proposal>(), requests = new Set<string>();
  const gestures = new WeakMap<object, Gesture>();
  let generation = 0, disposed = false;

  const scope = (): Canonical => {
    let value: unknown;
    try { value = readScopeSource(); } catch { return fail('session_unavailable'); }
    const parsed = exact(value, SCOPE);
    if (!parsed || parsed.status !== 'available' || typeof parsed.actorRef !== 'string'
      || !integer(parsed.generation, 1) || !integer(parsed.revocationGeneration)
      || !integer(parsed.selectionEpoch)) return fail('session_unavailable');
    return parsed;
  };
  const ui = async (): Promise<Readonly<Canonical>> => {
    let value: unknown;
    try { value = await readUiSource(); } catch { return fail('session_unavailable'); }
    const parsed = exact(value, UI);
    if (!parsed || parsed.status !== 'available') return fail('session_unavailable');
    if (parsed.role !== 'physician') return fail('role_unavailable');
    if (typeof parsed.actorRef !== 'string' || typeof parsed.sessionRef !== 'string'
      || !integer(parsed.generation, 1) || !integer(parsed.revocationGeneration)
      || !integer(parsed.selectionEpoch) || !sameCurrent(parsed, scope())) return fail('session_unavailable');
    return record(parsed);
  };
  const auditDenied = async (code: string): Promise<void> => {
    const timestamp = now();
    if (!integer(timestamp, 1)) return fail('audit_unavailable');
    const audit = record({ schemaVersion: 'mediflow.aip.audit.v1', eventType: 'checkup_status_transition',
      outcome: 'denied', operation: OPERATION, capabilityId: OPERATION, maxStage: 'proposal_only',
      egress: 'none', writesPerformed: 0, timestamp, denialCode: code });
    try { await Promise.resolve(writeAudit(audit)); } catch { return fail('audit_unavailable'); }
  };
  const revoke = (): boolean => {
    if (disposed) return false;
    generation += 1; proposals.clear(); requests.clear(); candidate.candidateController.restart(); return true;
  };
  const deny = async (error: unknown): Promise<never> => {
    const code = safeCode(error); await auditDenied(code); throw new HeadlessCheckupStatusTransitionV1Error(code);
  };
  const handlePreview = async (frameValue: unknown): Promise<string> => {
    if (disposed) return fail('operation_unavailable');
    let frame: Readonly<Canonical>;
    try { frame = decodeCheckupStatusTransitionIpcFrameV1(frameValue); }
    catch (error) { return deny(error); }
    if (frame.type !== 'preview') return deny(new Error('wrong frame'));
    const requestRef = frame.requestRef as string;
    if (requests.has(requestRef)) {
      const code = 'proof_replayed'; await auditDenied(code); revoke();
      return encodeCheckupStatusTransitionIpcFrameV1({ schemaVersion: CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1,
        type: 'preview_result', requestRef, operationId: OPERATION, outcome: 'denied', denialCode: code });
    }
    requests.add(requestRef);
    try {
      scope();
      const input = frame.input as Readonly<Canonical>, preview = candidate.service.preview(input);
      proposals.set(preview.proposalRef, { input, state: 'current', expiresAt: preview.expiresAt, receipt: null });
      return encodeCheckupStatusTransitionIpcFrameV1({ schemaVersion: CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1,
        type: 'preview_result', requestRef, operationId: OPERATION, outcome: 'proposed',
        proposalRef: preview.proposalRef, expiresAt: preview.expiresAt });
    } catch (error) {
      const code = safeCode(error); await auditDenied(code);
      return encodeCheckupStatusTransitionIpcFrameV1({ schemaVersion: CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1,
        type: 'preview_result', requestRef, operationId: OPERATION, outcome: 'denied', denialCode: code });
    }
  };
  const issueExactGesture = async (value: unknown): Promise<object> => {
    if (disposed) return fail('operation_unavailable');
    const binding = exact(value, GESTURE);
    if (!binding || typeof binding.proposalRef !== 'string' || !PROPOSAL_REF.test(binding.proposalRef)
      || (binding.targetStatus !== 'completed' && binding.targetStatus !== 'cancelled')
      || !integer(binding.expectedRevision, 1)) return fail('invalid_input');
    const proposal = proposals.get(binding.proposalRef);
    if (!proposal || proposal.state !== 'current' || proposal.input.targetStatus !== binding.targetStatus
      || proposal.input.expectedRevision !== binding.expectedRevision) return fail('proof_replayed');
    const timestamp = now();
    if (!integer(timestamp, 1) || timestamp >= proposal.expiresAt) return fail('preview_expired');
    const current = await ui(), gesture = Object.freeze(Object.create(null));
    gestures.set(gesture, { proposal, binding: record(binding), ui: current, generation });
    return gesture;
  };
  const readCurrentProposal = async (proposalRef: unknown): Promise<Readonly<Canonical>> => {
    if (disposed || typeof proposalRef !== 'string' || !PROPOSAL_REF.test(proposalRef)) return fail('invalid_input');
    const proposal = proposals.get(proposalRef);
    if (!proposal || proposal.state !== 'current') return fail('proof_replayed');
    const timestamp = now();
    if (!integer(timestamp, 1) || timestamp >= proposal.expiresAt) return fail('preview_expired');
    await ui();
    return record({ schemaVersion: 'mediflow.patient.checkup.status.transition.proposal-view.v1', proposalRef,
      targetStatus: proposal.input.targetStatus, expectedRevision: proposal.input.expectedRevision,
      expiresAt: proposal.expiresAt });
  };
  const confirm = async (value: unknown): Promise<HeadlessCheckupStatusReceiptV1> => {
    const input = exact(value, CONFIRM);
    if (!input || input.schemaVersion !== 'mediflow.patient.checkup.status.transition.confirmation.v1'
      || input.operationId !== OPERATION || typeof input.proposalRef !== 'string'
      || !PROPOSAL_REF.test(input.proposalRef) || typeof input.candidatePin !== 'string'
      || (input.targetStatus !== 'completed' && input.targetStatus !== 'cancelled')
      || !integer(input.expectedRevision, 1) || !input.gesture || typeof input.gesture !== 'object') {
      return fail('invalid_input');
    }
    const proposal = proposals.get(input.proposalRef);
    if (proposal?.state === 'committed' && proposal.receipt) {
      if (proposal.input.targetStatus === input.targetStatus
        && proposal.input.expectedRevision === input.expectedRevision) return proposal.receipt;
      return fail('idempotency_conflict');
    }
    if (!proposal || proposal.state !== 'current' || proposal.input.targetStatus !== input.targetStatus
      || proposal.input.expectedRevision !== input.expectedRevision) return fail('proof_replayed');
    proposal.state = 'pending';
    try {
      const confirmationGeneration = generation;
      const gesture = gestures.get(input.gesture as object), before = await ui();
      if (!gesture || gesture.proposal !== proposal || gesture.generation !== generation
        || !sameCurrent(gesture.ui, before) || GESTURE.some((key) => gesture.binding[key] !== input[key])) {
        return fail('confirmation_required');
      }
      let pin: unknown;
      try { pin = await verifyPin(input.candidatePin as string); } catch { return fail('confirmation_required'); }
      if (generation !== confirmationGeneration || proposals.get(input.proposalRef as string) !== proposal) {
        return fail('session_unavailable');
      }
      const proof = exact(pin, ['actorRef', 'sessionRef']);
      if (!proof || proof.actorRef !== before.actorRef || proof.sessionRef !== before.sessionRef) {
        return fail('confirmation_required');
      }
      const after = await ui();
      if (!sameCurrent(before, after) || before.sessionRef !== after.sessionRef) return fail('session_unavailable');
      gestures.delete(input.gesture as object);
      const confirmationProof = candidate.candidateController.issueConfirmationProof(input.proposalRef);
      const receipt = candidate.service.confirm(input.proposalRef, confirmationProof);
      proposal.state = 'committed'; proposal.receipt = receipt; return receipt;
    } catch (error) {
      proposal.state = 'terminal'; revoke(); return deny(error);
    }
  };
  const dispose = (): boolean => {
    if (disposed) return false;
    disposed = true; generation += 1; proposals.clear(); requests.clear(); candidate.service.dispose(); return true;
  };
  return record({ parent: record({ handlePreview }), hostUi: record({
    issueSelectedCheckupRef: candidate.candidateController.issueSelectedCheckupRef,
    readCurrentProposal, issueExactGesture, confirm }), revoke, dispose });
}
