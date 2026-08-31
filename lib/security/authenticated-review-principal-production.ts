/* @Codex */
import 'server-only';

import { eq } from 'drizzle-orm';

import { dbServer } from '../db-server';
import { users } from '../schema';
import { createAuthenticatedReviewPrincipalResolver } from './authenticated-review-principal';
import { readAuthenticatedWebSession } from './server-auth';

export const resolveAuthenticatedReviewPrincipal = createAuthenticatedReviewPrincipalResolver({
    readCurrentSession: readAuthenticatedWebSession,
    lookupUsersById: async (userId) => dbServer
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(eq(users.id, userId))
        .limit(2)
        .all(),
}).resolve;
