/* @Codex */
import 'server-only';

import {
    createHeadlessSoapActiveRoleAttestationStore,
    isHeadlessSoapActiveRoleAttestationStoreError,
} from './headless-soap-active-role-attestation-store';
import { createHeadlessSoapActiveRoleEnrollmentStoreAdapter } from './headless-soap-active-role-enrollment-store-adapter';
import { createHeadlessSoapActiveRoleEnrollmentService } from './headless-soap-active-role-enrollment';
import { verifyHostCredentials } from './host-credential-verification';
import { readAuthenticatedWebSession } from './server-auth';
import { isWebAdminSession } from './server-auth-policy';

const store = createHeadlessSoapActiveRoleAttestationStore();
const storeAdapter = createHeadlessSoapActiveRoleEnrollmentStoreAdapter(
    store,
    isHeadlessSoapActiveRoleAttestationStoreError,
);
const service = createHeadlessSoapActiveRoleEnrollmentService({
    async resolveCurrentWebAdmin() {
        const session = await readAuthenticatedWebSession();
        return isWebAdminSession(session) ? session : null;
    },
    verifyCredentials: verifyHostCredentials,
    readAttestation: storeAdapter.readAttestation,
    createInactive: storeAdapter.createInactive,
    activate: storeAdapter.activate,
});

/** Completes controlled setup only; the result is not a session grant or write authority. */
export function enrollHeadlessSoapActiveRoleAttestation(candidatePin: string) {
    return service.enroll(candidatePin);
}
