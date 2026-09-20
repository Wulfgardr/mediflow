/* @Codex — actual production root; importing/GET cannot create a process. */
import 'server-only';
import type { WebSessionProjection } from '../security/web-auth-lifecycle-owner-adapter';
import { createProductionExecutionPlatform, type ProductExecutionPlatform } from '../chatgpt-execution/execution-platform';
import { createSharedMacProductPlatform } from '../chatgpt-execution/execution-mac-product';
import { createProductService } from './product-service';
import { createProductSessionRegistry } from './product-session';
import { createProductHttp } from './product-http';

/** Server-only DI. Production never chooses fake transport, account or inference. */
export function createChatGptProduct(options: {
    resolveSession(request: Request): Promise<WebSessionProjection | null>; platform: ProductExecutionPlatform | (() => ProductExecutionPlatform);
}) {
    const registry = createProductSessionRegistry((session, isCurrent) => createProductService({ session, isCurrent, platform: typeof options.platform === 'function' ? options.platform() : options.platform }));
    const handle = createProductHttp({ async acquire(request) {
        const session = await options.resolveSession(request);
        return session ? registry.acquire(session) : null;
    } });
    return Object.freeze({ handle, dispose: () => registry.dispose() });
}
function createProductionRoot() {
    return createChatGptProduct({ platform: () => process.platform === 'darwin' ? createSharedMacProductPlatform() : createProductionExecutionPlatform(), async resolveSession() {
    // The existing Web auth owner is the authority; no account cookie, API token,
    // public ID or native-session projection is accepted in its place.
    const { requireSession } = await import('../security/server-auth');
    return requireSession();
} });
}
// Route chunks must share the same registry and the same issuer realm. This
// host-only object is never serialized or used as a public bearer capability.
const rootKey = Symbol.for('mediflow.chatgpt-product.production.v1');
const roots = globalThis as typeof globalThis & { [rootKey]?: ReturnType<typeof createProductionRoot> };
const production = roots[rootKey] ??= createProductionRoot();
export const handleChatGptProductRequest = production.handle;
