/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';

import { headlessSoapAuthorizationProofProductionOwner } from './headless-soap-authorization-proof-production-internal';
import { createHeadlessSoapCommandBindingOwner } from './headless-soap-command-binding-lifecycle';

const hostRandomBytes = randomBytes;

/** Shared process owner for H6 approval binding without write authority. */
export const headlessSoapCommandBindingProductionOwner = createHeadlessSoapCommandBindingOwner({
    proofLifecycle: headlessSoapAuthorizationProofProductionOwner.lifecycleController,
    proofBinding: headlessSoapAuthorizationProofProductionOwner.bindingController,
    proofService: headlessSoapAuthorizationProofProductionOwner.service,
    entropy: () => Uint8Array.from(hostRandomBytes(32)),
});
