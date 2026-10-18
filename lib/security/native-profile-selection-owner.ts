import 'server-only';

import { dbServer } from '../db-server';
import { createCanonicalNativeProfileClinicalContextResolver } from './server-session-clinical-context';
import { createNativeProfileSelectionProcessOwner } from './server-session-projection-owner';

export const nativeProfileSelectionOwner = createNativeProfileSelectionProcessOwner({
    resolve: createCanonicalNativeProfileClinicalContextResolver(dbServer),
});
