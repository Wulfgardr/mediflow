/* @Codex */
import 'server-only';

import { acquireAuthenticatedWebSessionProjectionOwner } from './server-auth';
import { createAuthenticatedWebSessionSelectionService } from './server-session-authenticated-selection';

const authenticatedWebSessionSelection = createAuthenticatedWebSessionSelectionService({
    acquireOwner: acquireAuthenticatedWebSessionProjectionOwner,
});

export const acquireAuthenticatedWebSessionSelection = authenticatedWebSessionSelection.acquire;
export const issueAuthenticatedWebSessionSelection = authenticatedWebSessionSelection.issue;
