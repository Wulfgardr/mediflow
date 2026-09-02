/* @Codex */
import 'server-only';

import { createHeadlessCheckupActiveRoleAttestationStoreV1 } from
  './headless-checkup-active-role-attestation-store';
import { createHeadlessCheckupActiveRoleSessionGrantOwner } from
  './headless-checkup-active-role-session-grant';

const hostSetTimeout = setTimeout, hostClearTimeout = clearTimeout;
const store = createHeadlessCheckupActiveRoleAttestationStoreV1();

/** Checkup-specific process owner; callers must provide a context captured in their current Web request. */
export const headlessCheckupActiveRoleSessionGrant = createHeadlessCheckupActiveRoleSessionGrantOwner({
  now: Date.now,
  readAttestation: (actorRef) => store.read(actorRef),
  schedule: (delayMs, dispose) => {
    if (!Number.isSafeInteger(delayMs) || delayMs <= 0) throw new Error('invalid checkup grant expiry');
    const timer = hostSetTimeout(dispose, delayMs); timer.unref();
    return () => hostClearTimeout(timer);
  },
});
