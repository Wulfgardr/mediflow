/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';

import { createHeadlessSoapAuthorizationProofLifecycleOwner } from './headless-soap-authorization-proof-lifecycle';
import { headlessSoapEntryPresentationLifecycleProductionOwner } from './headless-soap-entry-presentation-lifecycle-production-internal';
import { createHeadlessSoapFreshPinVerifier } from './headless-soap-fresh-pin-verification';
import { verifyHostCredentials } from './host-credential-verification';
import { readAuthenticatedWebSession } from './server-auth';
import { isWebAdminSession } from './server-auth-policy';
import {
    abortResourceUse,
    beginResourceUse,
    commitResourceUse,
    mintResourcePort,
    releaseResourcePort,
    withCurrentResourceBinding,
    type WebResourceBinding,
    type WebResourcePort,
    type WebResourceUse,
} from './web-auth-lifecycle-owner-adapter';

const hostRandomBytes = randomBytes;
const hostDateNow = Date.now;
const hostSetTimeout = setTimeout;
const hostClearTimeout = clearTimeout;
const hostUint8Array = Uint8Array;
const hostUint8ArrayFrom = Uint8Array.from;
const reflectApply = Reflect.apply;

function withCurrentVerifiedWebSessionBinding(
    candidate: unknown,
    operation: (binding: WebResourceBinding) => void,
): boolean {
    let port: WebResourcePort | null = null, use: WebResourceUse | null = null, committed = false;
    try {
        port = mintResourcePort(candidate); if (!port) return false;
        use = beginResourceUse(port); if (!use) return false;
        let invoked = false, duplicated = false;
        const current = withCurrentResourceBinding(use, (binding) => {
            if (invoked) { duplicated = true; return; }
            invoked = true; reflectApply(operation, undefined, [binding]);
        });
        if (!current || !invoked || duplicated) return false;
        committed = commitResourceUse(use);
        return committed;
    } catch { return false; }
    finally {
        if (use && !committed) abortResourceUse(use);
        if (port) releaseResourcePort(port);
    }
}

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
    presentationBinding: headlessSoapEntryPresentationLifecycleProductionOwner.presentationBindingController,
    withCurrentWebSessionBinding: withCurrentVerifiedWebSessionBinding,
    presentationService: headlessSoapEntryPresentationLifecycleProductionOwner.service,
    verifyFreshPin: freshPinVerifier.verify,
    entropy: () => reflectApply(hostUint8ArrayFrom, hostUint8Array, [hostRandomBytes(32)]),
    now: () => hostDateNow(),
    schedule: (dispose, delayMs) => hostSetTimeout(dispose, delayMs),
    cancelSchedule: (handle) => hostClearTimeout(handle as ReturnType<typeof setTimeout>),
});
