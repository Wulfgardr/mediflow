/* @Codex */
import 'server-only';

import { createHeadlessSoapActiveRoleAttestationStore } from './headless-soap-active-role-attestation-store';
import { createHeadlessSoapActiveRoleSessionGrantOwner } from './headless-soap-active-role-session-grant';
import { readAuthenticatedWebSession } from './server-auth';

const attestationStore = createHeadlessSoapActiveRoleAttestationStore();

/** Internal process owner shared by the H2a and H2b production facades. */
export const headlessSoapActiveRoleSessionGrantProductionOwner = createHeadlessSoapActiveRoleSessionGrantOwner({
    readCurrentSession: readAuthenticatedWebSession,
    readAttestation: (actorRef) => attestationStore.read(actorRef),
});
