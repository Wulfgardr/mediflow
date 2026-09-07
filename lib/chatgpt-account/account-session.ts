/* @Codex */
import 'server-only';
import * as owner from '../security/web-auth-lifecycle-owner-adapter';
import { AccountError } from './account-protocol';
import type { AccountOperation, AccountResult } from './account-contract';
import type { AccountService } from './account-service';

export type AccountSessionHandle = Readonly<{
    respond(operation: AccountOperation | 'status', render: (result: AccountResult) => Response): Promise<Response>;
}>;
export function createAccountSessionRegistry(createService: () => AccountService) {
    const entries = new Map<string, { session: owner.WebSessionProjection; service: AccountService; port: owner.WebResourcePort; dispose(): void }>();
    return Object.freeze({
        acquire(session: owner.WebSessionProjection): AccountSessionHandle {
            let entry = entries.get(session.id);
            // Reuse only the exact projection already admitted by the owner. Each
            // response still begins a fresh resource use; polling mints no extra ports.
            if (entry && entry.session !== session) throw new AccountError('session_expired');
            if (!entry) {
                if (entries.size >= 16) throw new AccountError('busy');
                const port = owner.mintResourcePort(session);
                if (!port) throw new AccountError('session_expired');
                const service = createService();
                let disposed = false;
                let timer: ReturnType<typeof setTimeout> | null = null;
                const dispose = () => {
                    if (disposed) return;
                    disposed = true;
                    if (timer) clearTimeout(timer);
                    entries.delete(session.id);
                    void service.dispose();
                    // The owner invokes disposers inside retirement; never re-enter it.
                    queueMicrotask(() => { owner.releaseResourcePort(port); });
                };
                const registration = owner.registerPrivateResource(port, dispose);
                if (!registration) { dispose(); throw new AccountError('session_expired'); }
                timer = setTimeout(dispose, Math.max(0, session.expiresAt - Date.now()));
                timer.unref?.();
                entry = { session, service, port, dispose }; entries.set(session.id, entry);
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
