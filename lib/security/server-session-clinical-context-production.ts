/* @Codex */
import 'server-only';

import { assertArchiveRequestAfterAdmission } from './archive-request-context';
import { dbServer } from '../db-server';
import { createCanonicalClinicalContextResolver } from './server-session-clinical-context';

const resolve = createCanonicalClinicalContextResolver(dbServer);
export const resolveCanonicalServerSessionClinicalContext: typeof resolve = (session, input) => {
    const context = resolve(session, input);
    assertArchiveRequestAfterAdmission(session);
    return context;
};
