/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';
import { types } from 'node:util';

import { CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1, decodeCheckupStatusTransitionIpcFrameV1,
  encodeCheckupStatusTransitionIpcFrameV1 } from '../../packages/aip/src/checkup-status-transition-ipc.ts';
import { HeadlessCheckupStatusTransitionV1Error } from '../../packages/aip/src/checkup-status-transition.ts';
import { hashAuditRef, writeAuditEvent } from './audit';
import { createCheckupStatusTransitionWebParentChannelV1 } from './checkup-status-transition-web-parent-channel';
import { verifyFreshReviewPin } from './fresh-review-pin-uniqueness';
import { headlessCheckupActiveRoleSessionGrant } from
  './headless-checkup-active-role-session-grant-production';
import type { HeadlessCheckupActiveRoleCurrentBindingV1,
  HeadlessCheckupActiveRoleSessionGrantV1 } from './headless-checkup-active-role-session-grant';
import { createHeadlessCheckupStatusTransitionWebOwnerV1 } from
  './headless-checkup-status-transition-web-owner';
import { acquireAuthenticatedWebSessionProjectionOwnerContext,
  type AuthenticatedWebSessionProjectionOwnerContext } from './server-auth';
import type { PortableSupervisorCheckupWebSessionBindingV1 } from
  './portable-supervisor-checkup-web-session-port';
import { portableSupervisorCheckupWebSessionPortV1 } from './portable-supervisor-web-session-controller';

const OPERATION = 'mediflow.patient.checkup.status.transition.v1';
const CHECKUP_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const UI_BINDING = /^hcub_[0-9a-f]{64}$/u;
type Owner = ReturnType<typeof createHeadlessCheckupStatusTransitionWebOwnerV1>;
type State = { active: boolean; actorRef: string; checkupId: string; patientId: string; ambulatoryId: string;
  selectionEpoch: number; generation: number; uiBindingRef: string; resourceTitle: string;
  resourceRevision: number; grant: HeadlessCheckupActiveRoleSessionGrantV1;
  supervisorBinding: PortableSupervisorCheckupWebSessionBindingV1; owner: Owner };

let state: State | null = null;
let channel: ReturnType<typeof createCheckupStatusTransitionWebParentChannelV1> | null = null;
let nextGeneration = 0;

function record<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, value));
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== 'object' || types.isProxy(value) || types.isPromise(value)
      || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value), own = Reflect.ownKeys(value);
    if ((prototype !== null && prototype !== Object.prototype) || own.length !== keys.length
      || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch { return null; }
}
function fail(code: ConstructorParameters<typeof HeadlessCheckupStatusTransitionV1Error>[0]): never {
  throw new HeadlessCheckupStatusTransitionV1Error(code);
}
function exactUiBinding(current: State, candidate: unknown): void {
  if (typeof candidate !== 'string' || !UI_BINDING.test(candidate)
    || candidate !== current.uiBindingRef) return fail('scope_changed');
}
function currentBinding(current: State, presented?: AuthenticatedWebSessionProjectionOwnerContext) {
  if (!current.active || state !== current) return fail('session_unavailable');
  const read = (role: HeadlessCheckupActiveRoleCurrentBindingV1) => {
    let matched = false;
    const available = portableSupervisorCheckupWebSessionPortV1.withCurrent(
      current.supervisorBinding,
      (capture) => {
        if (capture.patientId !== role.patientId || capture.ambulatoryId !== role.ambulatoryId
          || capture.selectionEpoch !== role.selectionEpoch || role.patientId !== current.patientId
          || role.ambulatoryId !== current.ambulatoryId || role.selectionEpoch !== current.selectionEpoch) {
          return fail('scope_changed');
        }
        matched = true;
      },
    );
    if (!available || !matched) return fail('session_unavailable');
    return role;
  };
  try {
    return presented
      ? headlessCheckupActiveRoleSessionGrant.withCurrentRequest(current.grant, presented, read)
      : headlessCheckupActiveRoleSessionGrant.withCurrent(current.grant, read);
  } catch (error) {
    if (error instanceof HeadlessCheckupStatusTransitionV1Error) throw error;
    return fail('session_unavailable');
  }
}
function scope(current: State): Readonly<Record<string, unknown>> {
  try {
    const binding = currentBinding(current);
    return record({ status: 'available', actorRef: binding.actorRef, patientId: binding.patientId,
      ambulatoryId: binding.ambulatoryId, checkupId: current.checkupId, generation: current.generation,
      revocationGeneration: binding.revocationGeneration, selectionEpoch: binding.selectionEpoch });
  } catch (error) {
    const code = error instanceof HeadlessCheckupStatusTransitionV1Error ? error.code : 'session_unavailable';
    return record({ status: 'denied', code });
  }
}
async function ui(current: State): Promise<Readonly<Record<string, unknown>>> {
  const context = await acquireAuthenticatedWebSessionProjectionOwnerContext();
  if (!context) return fail('session_unavailable');
  const binding = currentBinding(current, context);
  return record({ status: 'available', actorRef: binding.actorRef, sessionRef: binding.sessionRef,
    role: binding.role, generation: current.generation,
    revocationGeneration: binding.revocationGeneration, selectionEpoch: binding.selectionEpoch });
}
async function auditDenied(current: State, value: unknown): Promise<void> {
  const denial = value as { denialCode?: unknown; timestamp?: unknown };
  await writeAuditEvent({ eventType: 'agent.operation.attempted', outcome: 'denied', actorType: 'user',
    actorRef: hashAuditRef(current.actorRef), subjectType: 'agent_operation', subjectRef: null,
    sourceSurface: 'web', occurredAt: Number.isSafeInteger(denial.timestamp)
      ? new Date(denial.timestamp as number) : new Date(),
    redactedMetadata: { flags: ['aip', 'proposal_only', 'checkup_status_transition'],
      reasonCode: typeof denial.denialCode === 'string' ? denial.denialCode : 'operation_unavailable' } });
}
function disposeState(current = state): void {
  if (!current?.active) return;
  current.active = false;
  if (state === current) state = null;
  try { portableSupervisorCheckupWebSessionPortV1.detach(current.supervisorBinding); } catch { /* terminal */ }
  try { headlessCheckupActiveRoleSessionGrant.dispose(current.grant); } catch { /* terminal */ }
  try { current.owner.dispose(); } catch { /* terminal */ }
}
function denial(frame: string, code: 'resource_unavailable' | 'session_unavailable'): string {
  const parsed = decodeCheckupStatusTransitionIpcFrameV1(frame);
  return encodeCheckupStatusTransitionIpcFrameV1({ schemaVersion: CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1,
    type: 'preview_result', requestRef: parsed.requestRef, operationId: OPERATION,
    outcome: 'denied', denialCode: code });
}
async function handleParentPreview(frame: string): Promise<string> {
  const current = state;
  if (!current?.active) return denial(frame, 'resource_unavailable');
  if (scope(current).status !== 'available') { disposeState(current); return denial(frame, 'session_unavailable'); }
  return current.owner.parent.handlePreview(frame);
}
function ensureParentChannel(): void {
  if (channel) return;
  channel = createCheckupStatusTransitionWebParentChannelV1({
    connected: () => process.connected === true && typeof process.send === 'function',
    send: (frame, done) => {
      if (!process.send) throw new Error('parent unavailable');
      return process.send(frame, undefined, undefined, (error: Error | null) => done(error ?? null));
    },
    onMessage: (listener) => process.on('message', listener),
    offMessage: (listener) => process.off('message', listener),
    onDisconnect: (listener) => process.on('disconnect', listener),
    offDisconnect: (listener) => process.off('disconnect', listener),
    handlePreview: handleParentPreview,
    onTerminal: (reason) => {
      disposeState();
      if (reason === 'protocol_invalid' && process.connected) {
        try { process.disconnect(); } catch { /* terminal */ }
      }
    },
  });
}

/** Selects one checkup under the live Web selection and returns only its opaque host-issued reference. */
export async function selectCheckupStatusTransitionForHostV1(input: Readonly<{
  expectedPatientId: unknown; checkupId: unknown;
}>) {
  const parsed = exact(input, ['expectedPatientId', 'checkupId']);
  if (!parsed || typeof parsed.expectedPatientId !== 'string' || !CHECKUP_ID.test(parsed.expectedPatientId)
    || typeof parsed.checkupId !== 'string' || !CHECKUP_ID.test(parsed.checkupId)) return fail('invalid_input');
  const context = await acquireAuthenticatedWebSessionProjectionOwnerContext();
  if (!context) return fail('session_unavailable');
  let selected: { patientId: string; ambulatoryId: string; selectionEpoch: number };
  try {
    selected = context.owner.withLeaseCriticalSection(context.session, (selection) => ({ ...selection,
      selectionEpoch: context.owner.snapshotSelectionEpoch(context.session) }));
  } catch { return fail('session_unavailable'); }
  if (selected.patientId !== parsed.expectedPatientId) return fail('scope_changed');
  disposeState();
  nextGeneration += 1;
  if (!Number.isSafeInteger(nextGeneration)) return fail('operation_unavailable');
  const current = { active: true, actorRef: context.session.userId, checkupId: parsed.checkupId,
    patientId: selected.patientId, ambulatoryId: selected.ambulatoryId, selectionEpoch: selected.selectionEpoch,
    generation: nextGeneration, uiBindingRef: '', resourceTitle: '', resourceRevision: 0,
    grant: null as unknown as HeadlessCheckupActiveRoleSessionGrantV1,
    supervisorBinding: null as unknown as PortableSupervisorCheckupWebSessionBindingV1,
    owner: null as unknown as Owner };
  state = current;
  try {
    current.grant = headlessCheckupActiveRoleSessionGrant.issue(context, () => disposeState(current));
    const supervisorBinding = portableSupervisorCheckupWebSessionPortV1.attach(() => disposeState(current));
    if (!supervisorBinding) return fail('operation_unavailable');
    current.supervisorBinding = supervisorBinding;
    const binding = currentBinding(current, context);
    if (binding.patientId !== parsed.expectedPatientId) return fail('scope_changed');
  } catch (error) { disposeState(current); throw error; }
  current.owner = createHeadlessCheckupStatusTransitionWebOwnerV1(record({ now: Date.now,
    readHostScopeCandidate: () => scope(current), readCurrentUiContext: () => ui(current),
    verifyFreshPin: verifyFreshReviewPin, writeDenialAudit: (value: unknown) => auditDenied(current, value) }));
  try {
    const checkupRef = current.owner.hostUi.issueSelectedCheckupRef();
    const projection = current.owner.hostUi.readSelectedCheckupUiProjection(checkupRef);
    current.uiBindingRef = `hcub_${randomBytes(32).toString('hex')}`;
    current.resourceTitle = projection.title; current.resourceRevision = projection.expectedRevision;
    ensureParentChannel();
    return record({ checkupRef, uiBindingRef: current.uiBindingRef,
      resourceTitle: current.resourceTitle, resourceRevision: current.resourceRevision });
  }
  catch (error) { disposeState(current); throw error; }
}

export async function readCheckupStatusTransitionProposalV1(input: Readonly<{
  expectedPatientId: unknown; proposalRef: unknown; uiBindingRef: unknown;
}>) {
  const parsed = exact(input, ['expectedPatientId', 'proposalRef', 'uiBindingRef']);
  if (!parsed || typeof parsed.expectedPatientId !== 'string'
    || !CHECKUP_ID.test(parsed.expectedPatientId)) return fail('invalid_input');
  const current = state; if (!current) return fail('session_unavailable');
  exactUiBinding(current, parsed.uiBindingRef);
  const context = await acquireAuthenticatedWebSessionProjectionOwnerContext();
  if (!context || currentBinding(current, context).patientId !== parsed.expectedPatientId) return fail('scope_changed');
  const proposal = await current.owner.hostUi.readCurrentProposal(parsed.proposalRef);
  if (proposal.expectedRevision !== current.resourceRevision) return fail('scope_changed');
  return record({ ...proposal, resourceTitle: current.resourceTitle,
    resourceRevision: current.resourceRevision });
}

/** The route calls this once per click; the opaque gesture is minted and consumed without browser serialization. */
export async function confirmCheckupStatusTransitionProposalV1(input: Readonly<{
  expectedPatientId: unknown; proposalRef: unknown; targetStatus: unknown;
  expectedRevision: unknown; candidatePin: unknown; uiBindingRef: unknown;
}>) {
  const parsed = exact(input, ['expectedPatientId', 'proposalRef', 'targetStatus',
    'expectedRevision', 'candidatePin', 'uiBindingRef']);
  if (!parsed || typeof parsed.expectedPatientId !== 'string'
    || !CHECKUP_ID.test(parsed.expectedPatientId)) return fail('invalid_input');
  const current = state; if (!current) return fail('session_unavailable');
  exactUiBinding(current, parsed.uiBindingRef);
  const context = await acquireAuthenticatedWebSessionProjectionOwnerContext();
  if (!context || currentBinding(current, context).patientId !== parsed.expectedPatientId) return fail('scope_changed');
  const binding = record({ proposalRef: parsed.proposalRef, targetStatus: parsed.targetStatus,
    expectedRevision: parsed.expectedRevision });
  const committed = current.owner.hostUi.readCommittedReceipt(binding);
  if (committed) return committed;
  const gesture = await current.owner.hostUi.issueExactGesture(binding);
  return current.owner.hostUi.confirm(record({
    schemaVersion: 'mediflow.patient.checkup.status.transition.confirmation.v1', operationId: OPERATION,
    ...binding, candidatePin: parsed.candidatePin, gesture,
  }));
}

/** Explicitly retires only the operation-specific dependent state; H1a remains owned by its controller. */
export async function revokeCheckupStatusTransitionForHostV1(expectedPatientId: unknown): Promise<boolean> {
  if (typeof expectedPatientId !== 'string' || !CHECKUP_ID.test(expectedPatientId)) return fail('invalid_input');
  const current = state; if (!current) return false;
  const context = await acquireAuthenticatedWebSessionProjectionOwnerContext();
  if (!context || currentBinding(current, context).patientId !== expectedPatientId) return fail('scope_changed');
  disposeState(current); return true;
}

/** Server-only terminal cut used after an authenticated active-role revocation. */
export function disposeCheckupStatusTransitionForHostV1(): boolean {
  const current = state; if (!current) return false; disposeState(current); return true;
}
