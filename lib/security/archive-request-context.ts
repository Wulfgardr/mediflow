import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ArchiveReplacedError, assertArchiveGeneration } from '../archive-generation';
import { archiveGenerationForSession, currentArchiveGeneration } from './archive-session-generation';
import type { ServerSession } from './server-session';
import { archiveReplacementResponse } from '../api-error-response';

const requests = new AsyncLocalStorage<{ generation: string | undefined; denied: boolean; web: boolean }>();

/** Captures transport data only. Authentication and scope admission stay inside the existing operation. */
export function withArchiveRequestContext<Args extends unknown[]>(
    handler: (request: Request, ...args: Args) => Response | Promise<Response>,
): (request: Request, ...args: Args) => Promise<Response> {
    return (request, ...args) => {
        const context = { generation: request.headers.get('x-mediflow-archive-generation') ?? undefined, denied: false, web: false };
        return requests.run(context, async () => {
            try {
                const response = await handler(request, ...args);
                return context.denied ? archiveReplacementResponse(new ArchiveReplacedError())! : response;
            } catch (error) {
                if (context.denied) return archiveReplacementResponse(new ArchiveReplacedError())!;
                throw error;
            }
        });
    };
}

/** Call after the existing authentication/scope checks and before publishing a capability or sending data. */
export function assertArchiveRequestAfterAdmission(session: ServerSession): void {
    const context = requests.getStore();
    if (session.authChannel !== 'web') return;
    if (context) context.web = true;
    const expected = archiveGenerationForSession(session);
    if (expected && expected === currentArchiveGeneration()
        && (!context || context.generation === expected)) return;
    if (context) context.denied = true;
    throw new ArchiveReplacedError();
}

/** Complements session generation under the same SQLite lock as the clinical write and its audit. */
export function assertArchiveRequestInTransaction(transaction: Parameters<typeof assertArchiveGeneration>[0]): void {
    const context = requests.getStore();
    if (!context?.web) return;
    try { assertArchiveGeneration(transaction, context.generation); }
    catch (error) { if (error instanceof ArchiveReplacedError) context.denied = true; throw error; }
}
