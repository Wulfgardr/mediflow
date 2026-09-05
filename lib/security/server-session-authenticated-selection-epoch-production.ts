/* @Codex */
import 'server-only';

import { readAuthenticatedWebSession } from './server-auth';
import { AuthenticatedWebSessionSelectionError } from './server-session-authenticated-selection';
import { serverSessionProjectionOwnerRegistry } from './server-session-projection-owner-production';

export async function readAuthenticatedWebSessionSelectionEpoch(): Promise<number> {
    const session = await readAuthenticatedWebSession();
    if (!session) throw new AuthenticatedWebSessionSelectionError('session_unavailable');
    return serverSessionProjectionOwnerRegistry.snapshotSelectionEpoch(session);
}
