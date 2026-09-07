/* @Codex */
import 'server-only';
import { requireSession } from '../security/server-auth';
import { createAccountHost } from './account-host';
import { createAccountHttp } from './account-http';
import { createAccountService } from './account-service';
import { createAccountSessionRegistry } from './account-session';

const host = createAccountHost(process.env.MEDIFLOW_CHATGPT_CODEX_BIN);
const registry = createAccountSessionRegistry(() => createAccountService(host));
export const handleAccountRequest = createAccountHttp({ async acquire() {
    const session = await requireSession();
    return session ? registry.acquire(session) : null;
} });
