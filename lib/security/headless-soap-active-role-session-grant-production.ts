/* @Codex */
import 'server-only';

import { createHeadlessSoapActiveRoleAttestationStore } from './headless-soap-active-role-attestation-store';
import { createHeadlessSoapActiveRoleSessionGrantService } from './headless-soap-active-role-session-grant';
import { readAuthenticatedWebSession } from './server-auth';

const attestationStore = createHeadlessSoapActiveRoleAttestationStore();
/** Process-local prerequisite only; it grants no downstream authority. */
export const headlessSoapActiveRoleSessionGrantService = createHeadlessSoapActiveRoleSessionGrantService({
    readCurrentSession: readAuthenticatedWebSession,
    readAttestation: (actorRef) => attestationStore.read(actorRef),
});
