/* @Codex */
import 'server-only';

import { createHeadlessCheckupActiveRoleAttestationStoreV1,
  HeadlessCheckupActiveRoleAttestationError } from './headless-checkup-active-role-attestation-store';
import { createHeadlessCheckupActiveRoleEnrollmentService,
  type HeadlessCheckupActiveRoleEnrollmentLifecycleResult } from './headless-checkup-active-role-enrollment';
import { verifyHostCredentials } from './host-credential-verification';
import { readAuthenticatedWebSession } from './server-auth';
import { isWebAdminSession } from './server-auth-policy';

const store = createHeadlessCheckupActiveRoleAttestationStoreV1();
function lifecycle(action: () => unknown): HeadlessCheckupActiveRoleEnrollmentLifecycleResult {
  try { return { kind: 'ok', value: action() }; }
  catch (error) {
    if (error instanceof HeadlessCheckupActiveRoleAttestationError) {
      if (error.code === 'attestation_missing') return { kind: 'missing' };
      if (error.code === 'attestation_conflict') return { kind: 'conflict' };
    }
    return { kind: 'unavailable' };
  }
}
const service = createHeadlessCheckupActiveRoleEnrollmentService({
  now: Date.now,
  async resolveCurrentWebAdmin() {
    const session = await readAuthenticatedWebSession();
    return isWebAdminSession(session) ? session : null;
  },
  verifyAdminPin: verifyHostCredentials,
  readAttestation: (actorRef) => lifecycle(() => store.read(actorRef)),
  createInactive: (actorRef) => lifecycle(() => store.createInactive(actorRef)),
  activate: (actorRef) => lifecycle(() => store.activate(actorRef)),
  revoke: (actorRef, expected) => lifecycle(() => store.revoke(actorRef, expected)),
});

/** Controlled setup only; no session grant is returned. */
export function enrollHeadlessCheckupActiveRoleAttestation(candidatePin: unknown) {
  return service.enroll(candidatePin);
}

/** Explicit same-admin revocation; callers must separately retire operation-local dependent state. */
export function revokeHeadlessCheckupActiveRoleAttestation(candidatePin: unknown) {
  return service.revoke(candidatePin);
}
