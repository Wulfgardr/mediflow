/* @Codex */
import 'server-only';

import { dbServer } from '../db-server';
import { createCanonicalClinicalContextResolver } from './server-session-clinical-context';

export const resolveCanonicalServerSessionClinicalContext = createCanonicalClinicalContextResolver(dbServer);
