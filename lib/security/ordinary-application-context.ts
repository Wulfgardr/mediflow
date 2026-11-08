import 'server-only';
import { acquireAuthenticatedWebSessionProjectionOwnerContext } from './server-auth';
import { getNativeOrdinaryApplicationContext } from '../chatgpt-product/native-ordinary-composition';

export async function acquireOrdinaryApplicationContext() {
    return getNativeOrdinaryApplicationContext() ?? await acquireAuthenticatedWebSessionProjectionOwnerContext();
}
