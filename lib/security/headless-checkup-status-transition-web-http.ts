/* @Codex */
import 'server-only';

import { types } from 'node:util';
import { NextResponse } from 'next/server.js';

import { apiFailure } from '../api-error-response';
import { isTrustedWebMutationRequest } from './request-transport';
import { HeadlessCheckupStatusTransitionV1Error } from '../../packages/aip/src/checkup-status-transition';

const MESSAGE = 'Transizione checkup non disponibile.';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u, PROPOSAL = /^hcsp_[0-9a-f]{64}$/u;
const UI_BINDING = /^hcub_[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
type RouteContext = Readonly<{ params: Promise<Record<string, string>> }>;
type Sources = Readonly<{ readAuthenticated(): Promise<unknown>; select(input: unknown): Promise<unknown>;
  read(input: unknown): Promise<unknown>; confirm(input: unknown): Promise<unknown>;
  revoke(patientId: unknown): Promise<unknown> }>;

function failure(code: string, status: number): NextResponse { return apiFailure(code, MESSAGE, status); }
function exact(value: unknown, keys: readonly string[], canonical = false): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
      || types.isPromise(value) || (Object.getPrototypeOf(value) !== Object.prototype
        && (!canonical || Object.getPrototypeOf(value) !== null))) return null;
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return null; output[key] = descriptor.value; }
    return output;
  } catch { return null; }
}
async function params(context: RouteContext, withProposal = false): Promise<Readonly<{ patientId: string;
  proposalRef?: string }> | null> {
  try {
    const parsed = exact(await context.params, withProposal ? ['id', 'proposalRef'] : ['id']);
    if (!parsed || typeof parsed.id !== 'string' || !ID.test(parsed.id)) return null;
    if (withProposal && (typeof parsed.proposalRef !== 'string' || !PROPOSAL.test(parsed.proposalRef))) return null;
    return Object.freeze({ patientId: parsed.id, ...(withProposal ? { proposalRef: parsed.proposalRef as string } : {}) });
  } catch { return null; }
}
async function json(request: Request, keys: readonly string[]): Promise<Record<string, unknown> | null> {
  try { return exact(await request.json(), keys); } catch { return null; }
}
function controlled(error: unknown): NextResponse {
  if (!(error instanceof HeadlessCheckupStatusTransitionV1Error)) return failure('operation_unavailable', 503);
  switch (error.code) {
    case 'invalid_input': return failure(error.code, 400);
    case 'session_unavailable': return failure(error.code, 401);
    case 'role_unavailable': case 'confirmation_required': case 'proof_unavailable':
      return failure(error.code, 403);
    case 'resource_unavailable': return failure(error.code, 404);
    case 'preview_expired': return failure(error.code, 410);
    case 'scope_changed': case 'revision_conflict': case 'transition_unavailable':
    case 'idempotency_conflict': case 'proof_replayed': case 'restart_changed':
      return failure(error.code, 409);
    case 'operation_unavailable': case 'audit_unavailable': case 'commit_unavailable':
      return failure(error.code, 503);
    default: { const unreachable: never = error.code; void unreachable;
      return failure('operation_unavailable', 503); }
  }
}
function success(value: unknown): NextResponse {
  const response = NextResponse.json(value); response.headers.set('Cache-Control', 'no-store'); return response;
}
function selected(value: unknown): Record<string, unknown> | null {
  const result = exact(value, ['checkupRef', 'uiBindingRef', 'resourceTitle', 'resourceRevision'], true);
  return result && typeof result.checkupRef === 'string' && /^hcsr_[0-9a-f]{64}$/u.test(result.checkupRef)
    && typeof result.uiBindingRef === 'string' && UI_BINDING.test(result.uiBindingRef)
    && typeof result.resourceTitle === 'string' && result.resourceTitle.length >= 1
    && result.resourceTitle.length <= 512 && Number.isSafeInteger(result.resourceRevision)
    && (result.resourceRevision as number) >= 1 ? { ...result } : null;
}
function proposal(value: unknown): Record<string, unknown> | null {
  const result = exact(value, ['schemaVersion', 'proposalRef', 'targetStatus', 'expectedRevision', 'expiresAt',
    'resourceTitle', 'resourceRevision'], true);
  return result && result.schemaVersion === 'mediflow.patient.checkup.status.transition.proposal-view.v1'
    && typeof result.proposalRef === 'string' && PROPOSAL.test(result.proposalRef)
    && (result.targetStatus === 'completed' || result.targetStatus === 'cancelled')
    && Number.isSafeInteger(result.expectedRevision) && (result.expectedRevision as number) >= 1
    && Number.isSafeInteger(result.expiresAt) && (result.expiresAt as number) >= 1
    && typeof result.resourceTitle === 'string' && result.resourceTitle.length >= 1
    && result.resourceTitle.length <= 512 && result.resourceRevision === result.expectedRevision ? { ...result } : null;
}
function browserBinding(request: Request): string | null {
  try {
    const value = request.headers.get('x-mediflow-checkup-ui-binding');
    return typeof value === 'string' && UI_BINDING.test(value) ? value : null;
  } catch { return null; }
}
function receipt(value: unknown): Record<string, unknown> | null {
  const keys = ['schemaVersion', 'operationId', 'capabilityId', 'outcome', 'denialCode', 'fromStatus', 'toStatus',
    'previousRevision', 'newRevision', 'ownerRefHash', 'resourceRefHash', 'proofRefHash', 'receiptRefHash',
    'generation', 'revocationGeneration', 'selectionEpoch', 'timestamp'];
  const result = exact(value, keys, true);
  return result && result.schemaVersion === 'mediflow.patient.checkup.status.transition.receipt.v1'
    && result.operationId === 'mediflow.patient.checkup.status.transition.v1'
    && result.capabilityId === result.operationId && result.outcome === 'status_transitioned'
    && result.denialCode === null && result.fromStatus === 'pending'
    && (result.toStatus === 'completed' || result.toStatus === 'cancelled')
    && Number.isSafeInteger(result.previousRevision) && (result.previousRevision as number) >= 1
    && Number.isSafeInteger(result.newRevision)
    && result.newRevision === (result.previousRevision as number) + 1
    && [result.ownerRefHash, result.resourceRefHash, result.proofRefHash, result.receiptRefHash]
      .every((item) => typeof item === 'string' && DIGEST.test(item))
    && Number.isSafeInteger(result.generation) && (result.generation as number) >= 1
    && Number.isSafeInteger(result.revocationGeneration) && (result.revocationGeneration as number) >= 0
    && Number.isSafeInteger(result.selectionEpoch) && (result.selectionEpoch as number) >= 0
    && Number.isSafeInteger(result.timestamp) && (result.timestamp as number) >= 0 ? { ...result } : null;
}

/** Auth-first host UI routes. Preview remains reachable only through the private Supervisor parent port. */
export function createHeadlessCheckupStatusTransitionWebHttpHandlersV1(sources: Sources) {
  const authorized = async (): Promise<boolean> => {
    try { return await sources.readAuthenticated() === true; } catch { return false; }
  };
  return Object.freeze({
    select: async (request: Request, context: RouteContext): Promise<NextResponse> => {
      if (!await authorized()) return failure('session_unavailable', 401);
      if (!isTrustedWebMutationRequest(request)) return failure('request_transport_invalid', 403);
      const route = await params(context), input = await json(request, ['checkupId']);
      if (!route || !input || typeof input.checkupId !== 'string' || !ID.test(input.checkupId)) {
        return failure('invalid_input', 400);
      }
      try { const result = selected(await sources.select(Object.freeze({ expectedPatientId: route.patientId,
        checkupId: input.checkupId }))); return result ? success(result) : failure('operation_unavailable', 503); }
      catch (error) { return controlled(error); }
    },
    read: async (request: Request, context: RouteContext): Promise<NextResponse> => {
      if (!await authorized()) return failure('session_unavailable', 401);
      const route = await params(context, true), uiBindingRef = browserBinding(request);
      if (!route || !uiBindingRef) return failure('invalid_input', 400);
      try { const result = proposal(await sources.read(Object.freeze({ expectedPatientId: route.patientId,
        proposalRef: route.proposalRef, uiBindingRef })));
        return result ? success(result) : failure('operation_unavailable', 503); }
      catch (error) { return controlled(error); }
    },
    confirm: async (request: Request, context: RouteContext): Promise<NextResponse> => {
      if (!await authorized()) return failure('session_unavailable', 401);
      if (!isTrustedWebMutationRequest(request)) return failure('request_transport_invalid', 403);
      const route = await params(context, true);
      const input = await json(request, ['targetStatus', 'expectedRevision', 'candidatePin', 'uiBindingRef']);
      if (!route || !input || (input.targetStatus !== 'completed' && input.targetStatus !== 'cancelled')
        || !Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 1
        || typeof input.candidatePin !== 'string' || input.candidatePin.length < 4
        || input.candidatePin.length > 8 || typeof input.uiBindingRef !== 'string'
        || !UI_BINDING.test(input.uiBindingRef)) return failure('invalid_input', 400);
      try { const result = receipt(await sources.confirm(Object.freeze({ expectedPatientId: route.patientId,
        proposalRef: route.proposalRef, targetStatus: input.targetStatus,
        expectedRevision: input.expectedRevision, candidatePin: input.candidatePin,
        uiBindingRef: input.uiBindingRef })));
        return result ? success(result) : failure('operation_unavailable', 503);
      } catch (error) { return controlled(error); }
    },
    revoke: async (request: Request, context: RouteContext): Promise<NextResponse> => {
      if (!await authorized()) return failure('session_unavailable', 401);
      if (!isTrustedWebMutationRequest(request, false)) return failure('request_transport_invalid', 403);
      const route = await params(context); if (!route) return failure('invalid_input', 400);
      try { const result = await sources.revoke(route.patientId);
        if (result !== true && result !== false) return failure('operation_unavailable', 503);
        return success({ state: result ? 'revoked' : 'absent' }); }
      catch (error) { return controlled(error); }
    },
  });
}
