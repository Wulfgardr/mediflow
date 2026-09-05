'use client';

/* @Codex */

import { SmartImportSelectionBrowserAdapterError,
  createSmartImportSelectionBrowserAdapter } from './smart-import-selection-browser-adapter';

const CHECKUP_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CHECKUP_REF = /^hcsr_[0-9a-f]{64}$/u, PROPOSAL_REF = /^hcsp_[0-9a-f]{64}$/u;
const UI_BINDING = /^hcub_[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
type Sources = Readonly<{ fetch?: typeof fetch }>;
type Selection = Readonly<{ checkupRef: string; resourceTitle: string; resourceRevision: number }>;
type Proposal = Readonly<{ proposalRef: string; targetStatus: 'completed' | 'cancelled';
  expectedRevision: number; expiresAt: number; resourceTitle: string; resourceRevision: number }>;
type Receipt = Readonly<{ outcome: 'status_transitioned'; toStatus: 'completed' | 'cancelled';
  previousRevision: number; newRevision: number; receiptRefHash: string }>;
type Binding = Readonly<{ generation: number; patientId: string; checkupRef: string;
  uiBindingRef: string; resourceTitle: string; resourceRevision: number }>;
type HostBinding = Readonly<{ patientId: string; ambulatoryId: string }>;
export class IntelligentHostCheckupBrowserAdapterError extends Error {
  constructor(readonly code: 'input_invalid' | 'session_unavailable' | 'role_unavailable'
    | 'conflict' | 'expired' | 'host_unavailable' | 'response_invalid' | 'operation_superseded') {
    super('Checkup tramite Intelligent Host non disponibile.');
    this.name = 'IntelligentHostCheckupBrowserAdapterError';
  }
}
function fail(code: ConstructorParameters<typeof IntelligentHostCheckupBrowserAdapterError>[0]): never {
  throw new IntelligentHostCheckupBrowserAdapterError(code);
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
    const output: Record<string, unknown> = {};
    for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return null; output[key] = descriptor.value; }
    return output;
  } catch { return null; }
}
function identifier(value: unknown, pattern = CHECKUP_ID): value is string {
  return typeof value === 'string' && pattern.test(value);
}
function canonicalProposal(value: unknown): Proposal | null {
  const item = exact(value, ['proposalRef', 'targetStatus', 'expectedRevision', 'expiresAt',
    'resourceTitle', 'resourceRevision']);
  return item && identifier(item.proposalRef, PROPOSAL_REF)
    && (item.targetStatus === 'completed' || item.targetStatus === 'cancelled')
    && Number.isSafeInteger(item.expectedRevision) && (item.expectedRevision as number) >= 1
    && Number.isSafeInteger(item.expiresAt) && (item.expiresAt as number) >= 1
    && typeof item.resourceTitle === 'string' && item.resourceTitle.length >= 1
    && item.resourceTitle.length <= 512 && item.resourceRevision === item.expectedRevision
    ? Object.freeze({ proposalRef: item.proposalRef, targetStatus: item.targetStatus,
      expectedRevision: item.expectedRevision as number, expiresAt: item.expiresAt as number,
      resourceTitle: item.resourceTitle, resourceRevision: item.resourceRevision as number }) : null;
}
function errorFor(response: Response): never {
  if (response.status === 401) return fail('session_unavailable');
  if (response.status === 403) return fail('role_unavailable');
  if (response.status === 409) return fail('conflict');
  if (response.status === 410) return fail('expired');
  return fail('host_unavailable');
}
async function decoded(response: Response): Promise<unknown> {
  if (!response.ok) return errorFor(response);
  try { return await response.json(); } catch { return fail('response_invalid'); }
}
function selectionFailure(error: unknown): never {
  if (error instanceof IntelligentHostCheckupBrowserAdapterError) throw error;
  if (error instanceof SmartImportSelectionBrowserAdapterError) {
    if (error.code === 'session_unavailable') return fail('session_unavailable');
    if (error.code === 'input_invalid') return fail('input_invalid');
    if (error.code === 'selection_generation_changed' || error.code === 'selection_superseded') {
      return fail('operation_superseded');
    }
    if (error.code === 'response_invalid') return fail('response_invalid');
  }
  return fail('conflict');
}

/** One-shot browser boundary. Preview itself is deliberately absent and stays on private MCP IPC. */
export function createIntelligentHostCheckupBrowserAdapter(sources: Sources = {}) {
  const request = sources.fetch ?? globalThis.fetch;
  const selection = createSmartImportSelectionBrowserAdapter({ fetch: request });
  let generation = 0, operation = 0, binding: Binding | null = null, hostBinding: HostBinding | null = null;
  const proposalBindings = new WeakMap<object, Binding>();
  const token = () => ({ generation, operation: ++operation });
  const current = (value: { generation: number; operation: number }) => {
    if (value.generation !== generation || value.operation !== operation) return fail('operation_superseded');
  };
  const send = async (url: string, method: 'POST' | 'DELETE', value: unknown): Promise<unknown> => {
    const active = token(); let response: Response;
    try { response = await request(url, { method, cache: 'no-store', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value) }); } catch { current(active); return fail('host_unavailable'); }
    current(active); const output = await decoded(response); current(active); return output;
  };
  const activateCurrentHost = async (patientId: string, ambulatoryId: string): Promise<void> => {
    if (hostBinding) {
      if (hostBinding.patientId === patientId && hostBinding.ambulatoryId === ambulatoryId) return;
      return fail('conflict');
    }
    const active = token(); let selected;
    try {
      await selection.initialize(); current(active);
      selected = await selection.select({ patientId, ambulatoryId }, true);
      current(active);
    } catch (error) { return selectionFailure(error); }
    if (!selection.isCurrent(selected) || !selected.lease
      || selected.selectionEpoch !== selected.lease.selectionEpoch) return fail('conflict');
    const value = exact(await send(`/api/patients/${encodeURIComponent(patientId)}/intelligent-host/activate`,
      'POST', { selectionEpoch: selected.selectionEpoch }), ['state', 'expiresAt']);
    if (!value || value.state !== 'active' || !Number.isSafeInteger(value.expiresAt)
      || (value.expiresAt as number) < 1) return fail('response_invalid');
    hostBinding = Object.freeze({ patientId, ambulatoryId });
  };
  return Object.freeze({
    reset() { generation += 1; operation += 1; binding = null; hostBinding = null; selection.reset(); },
    async enroll(candidatePin: unknown): Promise<void> {
      if (typeof candidatePin !== 'string') return fail('input_invalid');
      const value = exact(await send('/api/system/intelligent-host/checkup-active-role', 'POST', { candidatePin }),
        ['schemaVersion', 'status', 'attestationVersion']);
      if (!value || value.schemaVersion !== 'mediflow.headless-checkup-active-role-enrollment.v1'
        || value.status !== 'active' || value.attestationVersion !== 1) return fail('response_invalid');
    },
    async revokeRole(candidatePin: unknown): Promise<void> {
      if (typeof candidatePin !== 'string') return fail('input_invalid');
      const value = exact(await send('/api/system/intelligent-host/checkup-active-role', 'DELETE', { candidatePin }),
        ['schemaVersion', 'status', 'attestationVersion', 'revocationGeneration']);
      if (!value || value.schemaVersion !== 'mediflow.headless-checkup-active-role-revocation.v1'
        || value.status !== 'revoked' || value.attestationVersion !== 1 || value.revocationGeneration !== 1) {
        return fail('response_invalid');
      }
      generation += 1; operation += 1; binding = null; hostBinding = null; selection.reset();
    },
    async revokeOperation(patientId: unknown): Promise<'revoked' | 'absent'> {
      if (!identifier(patientId)) return fail('input_invalid');
      const value = exact(await send(`/api/patients/${encodeURIComponent(patientId)}/intelligent-host/checkup-status`,
        'DELETE', {}), ['state']);
      if (!value || (value.state !== 'revoked' && value.state !== 'absent')) return fail('response_invalid');
      generation += 1; operation += 1; binding = null;
      return value.state;
    },
    async select(patientId: unknown, ambulatoryId: unknown, checkupId: unknown): Promise<Selection> {
      if (!identifier(patientId) || !identifier(ambulatoryId) || !identifier(checkupId)) return fail('input_invalid');
      await activateCurrentHost(patientId, ambulatoryId);
      const value = exact(await send(`/api/patients/${encodeURIComponent(patientId)}/intelligent-host/checkup-status`,
        'POST', { checkupId }), ['checkupRef', 'uiBindingRef', 'resourceTitle', 'resourceRevision']);
      if (!value || !identifier(value.checkupRef, CHECKUP_REF)
        || !identifier(value.uiBindingRef, UI_BINDING) || typeof value.resourceTitle !== 'string'
        || value.resourceTitle.length < 1 || value.resourceTitle.length > 512
        || !Number.isSafeInteger(value.resourceRevision) || (value.resourceRevision as number) < 1) {
        return fail('response_invalid');
      }
      binding = Object.freeze({ generation, patientId, checkupRef: value.checkupRef,
        uiBindingRef: value.uiBindingRef, resourceTitle: value.resourceTitle,
        resourceRevision: value.resourceRevision as number });
      return Object.freeze({ checkupRef: binding.checkupRef, resourceTitle: binding.resourceTitle,
        resourceRevision: binding.resourceRevision });
    },
    async read(patientId: unknown, proposalRef: unknown): Promise<Proposal> {
      if (!identifier(patientId) || !identifier(proposalRef, PROPOSAL_REF)) return fail('input_invalid');
      const selected = binding;
      if (!selected || selected.generation !== generation || selected.patientId !== patientId) return fail('conflict');
      const active = token(); let response: Response;
      try { response = await request(`/api/patients/${encodeURIComponent(patientId)}/intelligent-host/checkup-status/proposals/${encodeURIComponent(proposalRef)}`,
        { method: 'GET', cache: 'no-store', headers: {
          'x-mediflow-checkup-ui-binding': selected.uiBindingRef,
        } }); } catch { current(active); return fail('host_unavailable'); }
      current(active); const value = exact(await decoded(response),
        ['schemaVersion', 'proposalRef', 'targetStatus', 'expectedRevision', 'expiresAt',
          'resourceTitle', 'resourceRevision']); current(active);
      if (!value || value.schemaVersion !== 'mediflow.patient.checkup.status.transition.proposal-view.v1'
        || value.proposalRef !== proposalRef || (value.targetStatus !== 'completed' && value.targetStatus !== 'cancelled')
        || !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 1
        || !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) < 1
        || value.resourceTitle !== selected.resourceTitle || value.resourceRevision !== selected.resourceRevision
        || value.expectedRevision !== selected.resourceRevision) return fail('response_invalid');
      const proposal = Object.freeze({ proposalRef, targetStatus: value.targetStatus,
        expectedRevision: value.expectedRevision as number, expiresAt: value.expiresAt as number,
        resourceTitle: selected.resourceTitle, resourceRevision: selected.resourceRevision });
      proposalBindings.set(proposal, selected); return proposal;
    },
    async confirm(patientId: unknown, proposal: Proposal, candidatePin: unknown): Promise<Receipt> {
      if (!identifier(patientId) || typeof candidatePin !== 'string') return fail('input_invalid');
      const trustedBinding = proposal && typeof proposal === 'object' ? proposalBindings.get(proposal) : undefined;
      const accepted = canonicalProposal(proposal); if (!accepted) return fail('input_invalid');
      if (!trustedBinding || trustedBinding !== binding || trustedBinding.generation !== generation
        || trustedBinding.patientId !== patientId || trustedBinding.resourceTitle !== accepted.resourceTitle
        || trustedBinding.resourceRevision !== accepted.resourceRevision) return fail('conflict');
      const value = exact(await send(`/api/patients/${encodeURIComponent(patientId)}/intelligent-host/checkup-status/proposals/${encodeURIComponent(accepted.proposalRef)}`,
        'POST', { targetStatus: accepted.targetStatus, expectedRevision: accepted.expectedRevision, candidatePin,
          uiBindingRef: trustedBinding.uiBindingRef }),
      ['schemaVersion', 'operationId', 'capabilityId', 'outcome', 'denialCode', 'fromStatus', 'toStatus',
        'previousRevision', 'newRevision', 'ownerRefHash', 'resourceRefHash', 'proofRefHash', 'receiptRefHash',
        'generation', 'revocationGeneration', 'selectionEpoch', 'timestamp']);
      if (!value || value.schemaVersion !== 'mediflow.patient.checkup.status.transition.receipt.v1'
        || value.operationId !== 'mediflow.patient.checkup.status.transition.v1'
        || value.capabilityId !== value.operationId || value.outcome !== 'status_transitioned'
        || value.denialCode !== null || value.fromStatus !== 'pending' || value.toStatus !== accepted.targetStatus
        || value.previousRevision !== accepted.expectedRevision || value.newRevision !== accepted.expectedRevision + 1
        || ![value.ownerRefHash, value.resourceRefHash, value.proofRefHash, value.receiptRefHash]
          .every((item) => identifier(item, DIGEST))
        || !Number.isSafeInteger(value.generation) || (value.generation as number) < 1
        || !Number.isSafeInteger(value.revocationGeneration) || (value.revocationGeneration as number) < 0
        || !Number.isSafeInteger(value.selectionEpoch) || (value.selectionEpoch as number) < 0
        || !Number.isSafeInteger(value.timestamp) || (value.timestamp as number) < 0) return fail('response_invalid');
      return Object.freeze({ outcome: 'status_transitioned', toStatus: value.toStatus as 'completed' | 'cancelled',
        previousRevision: value.previousRevision as number, newRevision: value.newRevision as number,
        receiptRefHash: value.receiptRefHash as string });
    },
  });
}
