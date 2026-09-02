/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1, decodeCheckupStatusTransitionIpcFrameV1,
  encodeCheckupStatusTransitionIpcFrameV1 } from '../../packages/aip/src/checkup-status-transition-ipc.ts';
import { HeadlessCheckupStatusTransitionV1Error } from '../../packages/aip/src/checkup-status-transition.ts';
import { hashAuditRef, writeAuditEvent } from './audit';
import { createCheckupStatusTransitionWebParentChannelV1 } from './checkup-status-transition-web-parent-channel';
import { verifyFreshReviewPin } from './fresh-review-pin-uniqueness';
import { createHeadlessCheckupStatusTransitionWebOwnerV1 } from
  './headless-checkup-status-transition-web-owner';
import { acquirePortableSupervisorWebCaptureOwnerV1,
  type PortableSupervisorWebCaptureOwnerV1 } from './portable-supervisor-context-owner';
import { activatePortableSupervisorWebIpcV1, disconnectPortableSupervisorWebIpcV1,
  revokePortableSupervisorWebIpcV1 } from './portable-supervisor-web-ipc-bridge';
import { acquireAuthenticatedWebSessionProjectionOwnerContext,
  type AuthenticatedWebSessionProjectionOwnerContext } from './server-auth';
import { sessionPhysicianReviewAuthority } from './session-physician-review-authority-production';

const OPERATION = 'mediflow.patient.checkup.status.transition.v1';
const CHECKUP_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
type Owner = ReturnType<typeof createHeadlessCheckupStatusTransitionWebOwnerV1>;
type Authority = Awaited<ReturnType<typeof sessionPhysicianReviewAuthority.derive>>;
type State = { active: boolean; checkupId: string; patientId: string; ambulatoryId: string;
  selectionEpoch: number; generation: number; context: AuthenticatedWebSessionProjectionOwnerContext;
  authority: Authority; owner: Owner };

let state: State | null = null, capture: PortableSupervisorWebCaptureOwnerV1 | null = null;
let channel: ReturnType<typeof createCheckupStatusTransitionWebParentChannelV1> | null = null;
let activated = false, nextGeneration = 0, revokeStarted = false;

function record<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, value));
}
function fail(code: ConstructorParameters<typeof HeadlessCheckupStatusTransitionV1Error>[0]): never {
  throw new HeadlessCheckupStatusTransitionV1Error(code);
}
function scope(current: State): Readonly<Record<string, unknown>> {
  if (!current.active || state !== current) return record({ status: 'denied', code: 'restart_changed' });
  try {
    return current.context.owner.withLeaseCriticalSection(current.context.session, (selection) => {
      const epoch = current.context.owner.snapshotSelectionEpoch(current.context.session);
      if (selection.patientId !== current.patientId || selection.ambulatoryId !== current.ambulatoryId
        || epoch !== current.selectionEpoch) return fail('scope_changed');
      return record({ status: 'available', actorRef: current.context.session.userId,
        patientId: current.patientId, ambulatoryId: current.ambulatoryId, checkupId: current.checkupId,
        generation: current.generation, revocationGeneration: 0, selectionEpoch: current.selectionEpoch });
    });
  } catch { return record({ status: 'denied', code: 'session_unavailable' }); }
}
async function revalidate(current: State): Promise<AuthenticatedWebSessionProjectionOwnerContext> {
  if (!current.active || state !== current) return fail('session_unavailable');
  const context = await acquireAuthenticatedWebSessionProjectionOwnerContext();
  if (!context || context.owner !== current.context.owner || context.session.id !== current.context.session.id
    || context.session.userId !== current.context.session.userId) return fail('session_unavailable');
  let authority: Authority;
  try { authority = await sessionPhysicianReviewAuthority.recheck(current.authority); }
  catch { return fail('role_unavailable'); }
  if (authority !== current.authority || authority.actorRef !== context.session.userId) return fail('role_unavailable');
  const currentScope = scope(current);
  if (currentScope.status !== 'available') return fail('session_unavailable');
  return context;
}
async function ui(current: State): Promise<Readonly<Record<string, unknown>>> {
  const context = await revalidate(current);
  return record({ status: 'available', actorRef: context.session.userId, sessionRef: context.session.id,
    role: 'physician', generation: current.generation, revocationGeneration: 0,
    selectionEpoch: current.selectionEpoch });
}
async function auditDenied(current: State, value: unknown): Promise<void> {
  const denial = value as { denialCode?: unknown; timestamp?: unknown };
  await writeAuditEvent({ eventType: 'agent.operation.attempted', outcome: 'denied', actorType: 'user',
    actorRef: hashAuditRef(current.context.session.userId), subjectType: 'agent_operation', subjectRef: null,
    sourceSurface: 'web', occurredAt: Number.isSafeInteger(denial.timestamp)
      ? new Date(denial.timestamp as number) : new Date(),
    redactedMetadata: { flags: ['aip', 'proposal_only', 'checkup_status_transition'],
      reasonCode: typeof denial.denialCode === 'string' ? denial.denialCode : 'operation_unavailable' } });
}
function disposeState(current = state): void {
  if (!current?.active) return;
  current.active = false;
  if (state === current) state = null;
  try { current.owner.dispose(); } catch { /* terminal */ }
}
function revokeSupervisor(reason: 'reselection' | 'expiry' | 'web_disconnect' | 'explicit'): void {
  if (revokeStarted) return;
  revokeStarted = true; disposeState();
  void revokePortableSupervisorWebIpcV1(reason).catch(() => { disconnectPortableSupervisorWebIpcV1(); });
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
  try { await revalidate(current); }
  catch { revokeSupervisor('explicit'); return denial(frame, 'session_unavailable'); }
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
    onTerminal: (reason) => { disposeState(); if (reason === 'protocol_invalid') disconnectPortableSupervisorWebIpcV1(); },
  });
}
async function ensureSupervisor(): Promise<void> {
  if (activated) return;
  ensureParentChannel();
  capture = await acquirePortableSupervisorWebCaptureOwnerV1((reason) => {
    disposeState(); revokeSupervisor(reason === 'expiry' ? 'expiry'
      : reason === 'reselection' ? 'reselection' : reason === 'web_disconnect' ? 'web_disconnect' : 'explicit');
  });
  if (!capture) return fail('operation_unavailable');
  try { await activatePortableSupervisorWebIpcV1(capture.readCapture); activated = true; }
  catch { capture.dispose(); capture = null; return fail('operation_unavailable'); }
}

/** Selects one checkup under the live Web selection and returns only its opaque host-issued reference. */
export async function selectCheckupStatusTransitionForHostV1(checkupId: unknown) {
  if (typeof checkupId !== 'string' || !CHECKUP_ID.test(checkupId)) return fail('invalid_input');
  const context = await acquireAuthenticatedWebSessionProjectionOwnerContext();
  if (!context) return fail('session_unavailable');
  let authority: Authority;
  try { authority = await sessionPhysicianReviewAuthority.derive();
    authority = await sessionPhysicianReviewAuthority.recheck(authority); }
  catch { return fail('role_unavailable'); }
  let selected: { patientId: string; ambulatoryId: string; selectionEpoch: number };
  try { selected = context.owner.withLeaseCriticalSection(context.session, (selection) => ({ ...selection,
    selectionEpoch: context.owner.snapshotSelectionEpoch(context.session) })); }
  catch { return fail('session_unavailable'); }
  disposeState();
  nextGeneration += 1;
  if (!Number.isSafeInteger(nextGeneration)) return fail('operation_unavailable');
  const current = { active: true, checkupId, ...selected, generation: nextGeneration,
    context, authority, owner: null as unknown as Owner };
  current.owner = createHeadlessCheckupStatusTransitionWebOwnerV1(record({ now: Date.now,
    readHostScopeCandidate: () => scope(current), readCurrentUiContext: () => ui(current),
    verifyFreshPin: verifyFreshReviewPin, writeDenialAudit: (value: unknown) => auditDenied(current, value) }));
  state = current;
  try { const checkupRef = current.owner.hostUi.issueSelectedCheckupRef(); await ensureSupervisor();
    return record({ checkupRef }); }
  catch (error) { disposeState(current); throw error; }
}

export async function readCheckupStatusTransitionProposalV1(proposalRef: unknown) {
  const current = state; if (!current) return fail('session_unavailable');
  await revalidate(current); return current.owner.hostUi.readCurrentProposal(proposalRef);
}

/** The route calls this once per click; the opaque gesture is minted and consumed without browser serialization. */
export async function confirmCheckupStatusTransitionProposalV1(input: Readonly<{
  proposalRef: unknown; targetStatus: unknown; expectedRevision: unknown; candidatePin: unknown;
}>) {
  if (!input || typeof input !== 'object' || types.isProxy(input)) return fail('invalid_input');
  const current = state; if (!current) return fail('session_unavailable');
  await revalidate(current);
  const binding = record({ proposalRef: input.proposalRef, targetStatus: input.targetStatus,
    expectedRevision: input.expectedRevision });
  const gesture = await current.owner.hostUi.issueExactGesture(binding);
  return current.owner.hostUi.confirm(record({
    schemaVersion: 'mediflow.patient.checkup.status.transition.confirmation.v1', operationId: OPERATION,
    ...binding, candidatePin: input.candidatePin, gesture,
  }));
}
