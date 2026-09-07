/* @Codex */
import 'server-only';
import { requireSession, unauthorizedResponse } from '../security/server-auth';
// Reuse the canonical bounded 2 MiB/base64 envelope and lifecycle resource of ADR 0127.
// acceptSubset means explicit acceptance of this catalog's eight columns, not exemption semantics.
import { readExemptionImportRequest } from '../exemption-import-http';
import { acquireExemptionImportAuthority } from '../exemption-import-authority';
import { ExemptionImportError } from '../exemption-catalog-import';
import { dbServer } from '../db-server';
import { createProstheticsCatalog, ProstheticsCatalogError } from './prosthetics-catalog-service';
import { PROSTHETICS_TEMPLATE } from './prosthetics-catalog-contract';

const headers = { 'Cache-Control': 'no-store' };
export async function prostheticsCatalogRequest(action: 'preview' | 'commit' | 'status' | 'search' | 'template', request?: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    let authority: ReturnType<typeof acquireExemptionImportAuthority> | undefined;
    try {
        authority = acquireExemptionImportAuthority(session);
        const assertCurrent = () => {
            authority!.assertCurrent();
            if (request?.signal.aborted) throw new ProstheticsCatalogError('REQUEST_ABORTED', 'Richiesta interrotta.');
        };
        assertCurrent();
        const service = createProstheticsCatalog(dbServer.$client);
        let result: unknown;
        if (action === 'preview' || action === 'commit') {
            if (!request) throw new ProstheticsCatalogError('INVALID_REQUEST', 'Richiesta mancante.');
            const input = await readExemptionImportRequest(request, action === 'commit', authority.signal);
            assertCurrent();
            result = action === 'preview' ? service.preview(input.bytes, input.sourceName, session.userId)
                : service.commit(input, session.userId, assertCurrent);
        } else if (action === 'search') {
            const params = new URL(request!.url).searchParams;
            if ([...params.keys()].some(key => key !== 'q') || params.getAll('q').length > 1) throw new ProstheticsCatalogError('INVALID_QUERY', 'Parametri di ricerca non validi.');
            result = service.search(params.get('q') ?? '');
        } else if (action === 'template') {
            assertCurrent();
            return new Response(PROSTHETICS_TEMPLATE, { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="protesica-template-sintetico.csv"' } });
        } else result = service.status();
        assertCurrent();
        return Response.json(result, { headers });
    } catch (error) {
        if (authority?.signal.aborted) return unauthorizedResponse();
        if (error instanceof ProstheticsCatalogError || error instanceof ExemptionImportError) {
            return Response.json({ error: error.code.replace('EXEMPTION_IMPORT_', 'PROSTHETICS_CATALOG_'), message: error.message }, { status: error.status, headers });
        }
        return Response.json({ error: 'PROSTHETICS_CATALOG_FAILED', message: 'Operazione non riuscita. Rileggi lo stato del repertorio prima di riprovare.' }, { status: 500, headers });
    } finally { authority?.dispose(); }
}
