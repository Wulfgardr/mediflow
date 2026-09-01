/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';

import { createHeadlessSoapAuthorizationProofLifecycleOwner } from './headless-soap-authorization-proof-lifecycle';
import { headlessSoapEntryPresentationLifecycleProductionOwner } from './headless-soap-entry-presentation-lifecycle-production-internal';
import { createHeadlessSoapFreshPinVerifier } from './headless-soap-fresh-pin-verification';
import { verifyHostCredentials } from './host-credential-verification';
import { readAuthenticatedWebSession } from './server-auth';
import { isWebAdminSession } from './server-auth-policy';

const hostRandomBytes = randomBytes;
const hostDateNow = Date.now;
const hostSetTimeout = setTimeout;
const hostClearTimeout = clearTimeout;
const hostUint8Array = Uint8Array;
const hostUint8ArrayFrom = Uint8Array.from;
const reflectApply = Reflect.apply;

const freshPinVerifier = createHeadlessSoapFreshPinVerifier({
    async resolveCurrentWebAdmin() {
        const session = await readAuthenticatedWebSession();
        return isWebAdminSession(session) ? session : null;
    },
    verifyCredentials: verifyHostCredentials,
});

/** Shared process owner for non-executable H5b authorization-proof currentness. */
export const headlessSoapAuthorizationProofProductionOwner = createHeadlessSoapAuthorizationProofLifecycleOwner({
    presentationLifecycle: headlessSoapEntryPresentationLifecycleProductionOwner.lifecycleController,
    presentationService: headlessSoapEntryPresentationLifecycleProductionOwner.service,
    verifyFreshPin: freshPinVerifier.verify,
    entropy: () => reflectApply(hostUint8ArrayFrom, hostUint8Array, [hostRandomBytes(32)]),
    now: () => hostDateNow(),
    schedule: (dispose, delayMs) => hostSetTimeout(dispose, delayMs),
    cancelSchedule: (handle) => hostClearTimeout(handle as ReturnType<typeof setTimeout>),
});
