/* @Codex */
import 'server-only';
import * as owner from '../security/web-auth-lifecycle-owner-adapter';
import { acquireWebSessionResourceIdentity } from '../security/web-session-resource-identity';
import { AccountError } from './account-protocol';
import type { AccountOperation, AccountResult } from './account-contract';
import type { AccountService } from './account-service';

export type AccountSessionHandle = Readonly<{
    respond(operation: AccountOperation | 'status', render: (result: AccountResult) => Response): Promise<Response>;
}>;
export function createAccountSessionRegistry(createService: () => AccountService) {
    const entries = new Map<owner.WebAuthenticationGeneration, { session: owner.WebSessionProjection; service: AccountService; port: owner.WebResourcePort; dispose(): void }>();
    return Object.freeze({
        acquire(session: owner.WebSessionProjection): AccountSessionHandle {
            const identity = acquireWebSessionResourceIdentity(session);
            if (!identity) throw new AccountError('session_expired');
            const { port, generation } = identity;
            let entry = entries.get(generation);
            if (entry) owner.releaseResourcePort(port);
            if (!entry) {
                if (entries.size >= 16) { owner.releaseResourcePort(port); throw new AccountError('busy'); }
                let service: AccountService;
                try { service = createService(); }
                catch (error) { owner.releaseResourcePort(port); throw error; }
                let disposed = false;
                let timer: ReturnType<typeof setTimeout> | null = null;
                const dispose = () => {
                    if (disposed) return;
                    disposed = true;
                    if (timer) clearTimeout(timer);
                    if (entries.get(generation)?.port === port) entries.delete(generation);
                    // The owner invokes disposers inside retirement; never re-enter it.
                    queueMicrotask(() => { owner.releaseResourcePort(port); });
                    void service.dispose();
                };
                try {
                    if (!owner.registerPrivateResource(port, dispose) || disposed) throw new AccountError('session_expired');
                } catch (error) { dispose(); throw error; }
                timer = setTimeout(dispose, Math.max(0, session.expiresAt - Date.now()));
                timer.unref?.();
                entry = { session, service, port, dispose }; entries.set(generation, entry);
            }
            const current = entry;
            return Object.freeze({ async respond(operation: AccountOperation | 'status', render: (result: AccountResult) => Response) {
                const use = owner.beginResourceUse(current.port);
                if (!use) throw new AccountError('session_expired');
                try {
                    const result = operation === 'status' ? current.service.status() : await current.service.execute(operation);
                    let response: Response | undefined;
                    const bound = owner.withCurrentResourceBinding(use, () => {
                        if (current.service.isCurrent(result)) response = render(result);
                    });
                    if (!bound || !response || !owner.commitResourceUse(use)) throw new AccountError('session_expired');
                    return response;
                } finally { owner.abortResourceUse(use); }
            } });
        },
        dispose() { for (const entry of [...entries.values()]) entry.dispose(); },
    });
}
