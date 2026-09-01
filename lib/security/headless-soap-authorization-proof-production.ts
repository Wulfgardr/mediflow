/* @Codex */
import 'server-only';

import * as internal from './headless-soap-authorization-proof-production-internal';

const ownerKey = ['headlessSoapAuthorizationProof', 'Production', 'Owner'].join('') as keyof typeof internal;
const owner = internal[ownerKey];

/** Memory-only H5b service; its proof remains non-executable before H6. */
export const headlessSoapAuthorizationProofService = owner.service;
