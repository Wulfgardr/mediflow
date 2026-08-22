/* @Codex */
import 'server-only';

import { acquireAuthenticatedWebSessionProjectionOwner } from './server-auth';
import { createAuthenticatedWebSessionSelectionService } from './server-session-authenticated-selection';

export const issueAuthenticatedWebSessionSelection = createAuthenticatedWebSessionSelectionService({
    acquireOwner: acquireAuthenticatedWebSessionProjectionOwner,
}).issue;
