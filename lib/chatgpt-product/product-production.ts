/* @Codex — actual production root; importing/GET cannot create a process. */
import 'server-only';
import type { WebSessionProjection } from '../security/web-auth-lifecycle-owner-adapter';
import { createProductionExecutionPlatform, type ProductExecutionPlatform } from '../chatgpt-execution/execution-platform';
import { createProductService } from './product-service';
import { createProductSessionRegistry } from './product-session';
import { createProductHttp } from './product-http';

/** Server-only DI. Production never chooses fake transport, account or inference. */
export function createChatGptProduct(options: {
    resolveSession(request: Request): Promise<WebSessionProjection | null>; platform: ProductExecutionPlatform;
}) {
    const registry = createProductSessionRegistry((session, isCurrent) => createProductService({ session, isCurrent, platform: options.platform }));
    const handle = createProductHttp({ async acquire(request) {
        const session = await options.resolveSession(request);
        return session ? registry.acquire(session) : null;
    } });
    return Object.freeze({ handle, dispose: () => registry.dispose() });
}
const production = createChatGptProduct({ platform: createProductionExecutionPlatform(), async resolveSession() {
    // The existing Web auth owner is the authority; no account cookie, API token,
    // public ID or native-session projection is accepted in its place.
    const { requireSession } = await import('../security/server-auth');
    return requireSession();
} });
export const handleChatGptProductRequest = production.handle;
