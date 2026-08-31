/* @Codex */
import 'server-only';

import { eq } from 'drizzle-orm';

import { dbServer } from '../db-server';
import { users } from '../schema';
import { resolveAuthenticatedReviewPrincipal } from './authenticated-review-principal-production';
import { createPhysicianReviewAttestationStore } from './physician-review-attestation-store';
import { readAuthenticatedWebSession } from './server-auth';
import { createSessionPhysicianReviewAuthorityService } from './session-physician-review-authority';

const physicianReviewAttestationStore = createPhysicianReviewAttestationStore();

export const sessionPhysicianReviewAuthority = createSessionPhysicianReviewAuthorityService({
    resolvePrincipal: resolveAuthenticatedReviewPrincipal,
    readCurrentSession: readAuthenticatedWebSession,
    readAttestation: (actorRef) => physicianReviewAttestationStore.read(actorRef),
    readAccount: (actorRef) => dbServer
        .select({ id: users.id, lockedUntil: users.lockedUntil })
        .from(users)
        .where(eq(users.id, actorRef))
        .get(),
});
