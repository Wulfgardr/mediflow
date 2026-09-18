/* @Codex */
import 'server-only';
import { acquireAuthenticatedWebSessionProjectionOwnerContext } from './server-auth';
import { getNativeOrdinaryApplicationContext } from '../chatgpt-product/native-ordinary-composition';
import * as native from './native-inference-lifecycle';
import { registerServerSessionResource } from './server-session';

export async function acquireOrdinaryApplicationContext() {
    return getNativeOrdinaryApplicationContext() ?? await acquireAuthenticatedWebSessionProjectionOwnerContext();
}
export function registerOrdinaryApplicationResource(sessionId: string, dispose: () => void): (() => void) | null {
    const context = getNativeOrdinaryApplicationContext();
    if (!context) return registerServerSessionResource(sessionId, () => dispose());
    if (context.session.id !== sessionId) return null;
    const port = native.mintResourcePort(context.session);
    if (!port) return null;
    const registration = native.registerPrivateResource(port, () => { dispose(); });
    if (!registration) { native.releaseResourcePort(port); return null; }
    return () => { native.unregisterPrivateResource(port, registration); native.releaseResourcePort(port); };
}
