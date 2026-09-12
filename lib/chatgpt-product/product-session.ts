/* @Codex */
import 'server-only';
import * as owner from '../security/web-auth-lifecycle-owner-adapter';
import { ProductError, type ProductOperation, type ProductRequest, type ProductResponse } from './product-contract';
import type { ProductService } from './product-service';
export type ProductSessionHandle = Readonly<{
    signal: AbortSignal; current(): boolean;
    respond(operation: ProductOperation, request: ProductRequest, render: (result: ProductResponse) => Response, signal?: AbortSignal): Promise<Response>;
}>;
export function createProductSessionRegistry(create: (session: owner.WebSessionProjection, current: () => boolean) => ProductService) {
    type Entry = { session: owner.WebSessionProjection; port: owner.WebResourcePort; service: ProductService; abort: AbortController; dispose(): void };
    const entries = new Map<string, Entry>();
    return Object.freeze({
        acquire(session: owner.WebSessionProjection): ProductSessionHandle {
            let entry = entries.get(session.id);
            if (entry && entry.session !== session) throw new ProductError('session_expired');
            if (!entry) {
                if (entries.size >= 16) throw new ProductError('busy');
                const port = owner.mintResourcePort(session);
                if (!port) throw new ProductError('session_expired');
                const abort = new AbortController();
                let disposed = false;
                const current = () => {
                    if (disposed || Date.now() >= session.expiresAt) return false;
                    const use = owner.beginResourceUse(port);
                    if (!use) return false;
                    owner.abortResourceUse(use); return true;
                };
                let service: ProductService;
                try { service = create(session, current); }
                catch (error) { owner.releaseResourcePort(port); throw error; }
                const dispose = () => {
                    if (disposed) return;
                    disposed = true; clearTimeout(expiry); entries.delete(session.id);
                    // Owner retirement calls disposers synchronously. Do not call
                    // the owner again until outside its critical section.
                    abort.abort(); service.dispose();
                    queueMicrotask(() => owner.releaseResourcePort(port));
                };
                const expiry = setTimeout(dispose, Math.max(0, session.expiresAt - Date.now())); expiry.unref?.();
                // Registration can reject/dispose synchronously: expiry is already initialized.
                try {
                    if (!owner.registerPrivateResource(port, dispose) || disposed) throw new ProductError('session_expired');
                } catch (error) { dispose(); throw error; }
                entry = { session, port, service, abort, dispose }; entries.set(session.id, entry);
            }
            const value = entry;
            const current = () => {
                if (value.abort.signal.aborted || Date.now() >= value.session.expiresAt) return false;
                const use = owner.beginResourceUse(value.port);
                if (!use) return false;
                owner.abortResourceUse(use); return true;
            };
            return Object.freeze({ signal: value.abort.signal, current,
                async respond(operation, request, render, signal) {
                    if (!current() || signal?.aborted) throw new ProductError('session_expired');
                    const use = owner.beginResourceUse(value.port);
                    if (!use) throw new ProductError('session_expired');
                    try {
                        const result = await value.service.execute(operation, request, signal);
                        let response: Response | undefined;
                        const bound = owner.withCurrentResourceBinding(use, () => {
                            if (!signal?.aborted && !value.abort.signal.aborted && value.service.isCurrent(result)) response = render(result);
                        });
                        if (!bound || !response || signal?.aborted || !value.service.isCurrent(result) || !owner.commitResourceUse(use)) throw new ProductError('session_expired');
                        return response;
                    } finally { owner.abortResourceUse(use); }
                },
            });
        },
        dispose() { for (const entry of [...entries.values()]) entry.dispose(); },
    });
}
