/* @Codex */
import 'server-only';
import { requireSession } from '../security/server-auth';
import { createAccountHost } from './account-host';
import { createAccountHttp } from './account-http';
import { createAccountService } from './account-service';
import { createAccountSessionRegistry } from './account-session';

function createProductionRoot() {
    const host = createAccountHost(process.env.MEDIFLOW_CHATGPT_CODEX_BIN);
    const registry = createAccountSessionRegistry(() => createAccountService(host));
    return createAccountHttp({ async acquire() {
        const session = await requireSession();
        return session ? registry.acquire(session) : null;
    } });
}
// All route chunks in this backend retain the same owner-bound account service.
const rootKey = Symbol.for('mediflow.chatgpt-account.production.v1');
const roots = globalThis as typeof globalThis & { [rootKey]?: ReturnType<typeof createProductionRoot> };
export const handleAccountRequest = roots[rootKey] ??= createProductionRoot();
