import { readBoundedJsonBody } from '../bounded-request-body';
import { whoExactRecord } from './icd11-who-local-contract';
import { downloadWhoCatalog } from './icd11-embedded-download';
import { WhoCatalogError } from './icd11-embedded-parser';
import type { WhoCatalogStatus, WhoCatalogStore } from './icd11-embedded-store';

type Authority = { actor: string; signal: AbortSignal; assertCurrent(): void; dispose(): void };
export function createWhoCatalogHttpRoute(dependencies: {
    acquire(): Promise<Authority | null>; store(): WhoCatalogStore; enabled(): boolean;
    status(): WhoCatalogStatus; transport?: typeof fetch;
}) {
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    return async (request: Request): Promise<Response> => {
        let authority: Authority | null = null;
        try {
            authority = await dependencies.acquire();
            if (!authority) return json({ error: 'Sessione non valida' }, 401);
            const signal = AbortSignal.any([authority.signal, request.signal, AbortSignal.timeout(65_000)]);
            const assertCurrent = () => {
                authority!.assertCurrent(); signal.throwIfAborted();
                if (request.method === 'POST' && !dependencies.enabled()) throw new WhoCatalogError('Catalogo WHO disattivato dal gestore', 503);
            };
            assertCurrent();
            if (new URL(request.url).search) throw new WhoCatalogError('Parametri WHO non ammessi', 400);
            if (request.method === 'GET') return json(dependencies.status());
            if (request.method !== 'POST') return json({ error: 'Metodo non ammesso' }, 405);
            if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new WhoCatalogError('Richiesto application/json', 415);
            const bodySignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
            const read = await readBoundedJsonBody(request, 1024, 'strict', { signal: bodySignal, deadline: performance.now() + 5_000 });
            assertCurrent();
            if (!read.ok) throw new WhoCatalogError('Richiesta WHO non valida', read.status);
            const input = read.value as Record<string, unknown> | null;
            const keys = input?.action === 'activate' ? ['action', 'confirmed', 'previewId', 'expectedRevision']
                : input?.action === 'rollback' ? ['action', 'confirmed', 'expectedRevision'] : ['action', 'confirmed'];
            const r = whoExactRecord(input, keys);
            if (!r || r.confirmed !== true || !['preview', 'activate', 'rollback'].includes(r.action as string)) throw new WhoCatalogError('Conferma WHO mancante o richiesta non valida', 400);
            const store = dependencies.store();
            if (r.action === 'preview') {
                const revision = store.status().revision;
                try {
                    const preview = await downloadWhoCatalog(signal, (bytes, assertDeadline) => store.stage(bytes, revision,
                        () => { assertDeadline(); assertCurrent(); }, authority!.actor), dependencies.transport);
                    assertCurrent(); return json(preview);
                } catch (error) {
                    store.recordAcquisitionFailure(authority.actor);
                    throw error;
                }
            }
            if (!Number.isSafeInteger(r.expectedRevision) || (r.expectedRevision as number) < 0
                || (r.action === 'activate' && (typeof r.previewId !== 'string' || !/^[a-f0-9-]{36}$/u.test(r.previewId)))) throw new WhoCatalogError('Anteprima WHO non valida', 400);
            const result = r.action === 'activate'
                ? store.activate(r.previewId as string, r.expectedRevision as number, assertCurrent, authority.actor)
                : store.rollback(r.expectedRevision as number, assertCurrent, authority.actor);
            assertCurrent(); return json(result);
        } catch (error) {
            if (authority?.signal.aborted) return json({ error: 'Sessione non più valida' }, 401);
            return json({ error: error instanceof WhoCatalogError ? error.message : 'Operazione WHO non riuscita. Rileggi lo stato; il catalogo precedente è conservato.' },
                error instanceof WhoCatalogError ? error.status : 503);
        } finally { authority?.dispose(); }
    };
}
