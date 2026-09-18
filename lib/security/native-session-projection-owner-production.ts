/* @Codex */
import 'server-only';
import { dbServer } from '../db-server';
import { createCanonicalNativeClinicalContextResolver } from './server-session-clinical-context';
import { createNativePortProjectionOwnerProcessOwner } from './server-session-projection-owner';

// Fixed native singleton, physically isolated from the Web registry and controllers.
export const resolveNativeOrdinaryClinicalContext = createCanonicalNativeClinicalContextResolver(dbServer);
export const nativeSessionProjectionOwnerProduction = createNativePortProjectionOwnerProcessOwner({
    resolve: resolveNativeOrdinaryClinicalContext,
});
export const nativeSessionProjectionOwnerRegistry = nativeSessionProjectionOwnerProduction.registry;
