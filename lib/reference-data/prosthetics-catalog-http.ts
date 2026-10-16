import 'server-only';
import { requireSession, unauthorizedResponse } from '../security/server-auth';
// Reuse the canonical bounded 2 MiB/base64 envelope and lifecycle resource of ADR 0127.
// acceptSubset means explicit acceptance of this catalog's eight columns, not exemption semantics.
import { readProstheticsRequest } from './prosthetics-catalog-upload';
import { acquireExemptionImportAuthority } from '../exemption-import-authority';
import { ExemptionImportError } from '../exemption-catalog-import';
import { dbServer } from '../db-server';
import { createProstheticsCatalog, ProstheticsCatalogError } from './prosthetics-catalog-service';
import { PROSTHETICS_TEMPLATE } from './prosthetics-catalog-contract';

const headers = { 'Cache-Control': 'no-store' };
function unauthorized() {
    const response = unauthorizedResponse();
    response.headers.set('Cache-Control', headers['Cache-Control']);
    return response;
}
export async function prostheticsCatalogRequest(action: 'preview' | 'commit' | 'status' | 'search' | 'template' | 'sources' | 'documents', request?: Request) {
    const session = await requireSession();
    if (!session) return unauthorized();
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
        if (action === 'preview' || action === 'commit' || (action === 'documents' && request?.method === 'POST')) {
            if (!request) throw new ProstheticsCatalogError('INVALID_REQUEST', 'Richiesta mancante.');
            const input = await readProstheticsRequest(request, action, authority.signal);
            assertCurrent();
            result = action === 'documents' ? service.addDocument(input, assertCurrent) : action === 'preview' ? service.preview(input.bytes, input.sourceName, session.userId, input.options)
                : service.commit(input, session.userId, assertCurrent);
        } else if (action === 'search') {
            const params = new URL(request!.url).searchParams;
            if ([...params.keys()].some(key => !['q', 'sourceId'].includes(key)) || params.getAll('q').length > 1 || params.getAll('sourceId').length > 1) throw new ProstheticsCatalogError('INVALID_QUERY', 'Parametri di ricerca non validi.');
            result = service.search(params.get('q') ?? '', params.get('sourceId') ?? '');
        } else if (action === 'sources') result = service.sources();
        else if (action === 'documents') {
            const params = new URL(request!.url).searchParams;
            if ([...params.keys()].some(key => !['id', 'sha256'].includes(key)) || params.getAll('id').length !== 1 || params.getAll('sha256').length > 1)
                throw new ProstheticsCatalogError('INVALID_QUERY', 'Riferimento originale non valido.');
            const doc = service.document(params.get('id')!, params.get('sha256') ?? undefined);
            assertCurrent();
            return new Response(new Uint8Array(doc.bytes), { headers: { ...headers, 'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${doc.name}"`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
        } else if (action === 'template') {
            assertCurrent();
            return new Response(PROSTHETICS_TEMPLATE, { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="protesica-template-sintetico.csv"' } });
        } else result = service.status();
        assertCurrent();
        return Response.json(result, { headers });
    } catch (error) {
        if (authority?.signal.aborted) return unauthorized();
        if (error instanceof ProstheticsCatalogError || error instanceof ExemptionImportError) {
            return Response.json({ error: error.code.replace('EXEMPTION_IMPORT_', 'PROSTHETICS_CATALOG_'), message: error.message }, { status: error.status, headers });
        }
        return Response.json({ error: 'PROSTHETICS_CATALOG_FAILED', message: 'Operazione non riuscita. Rileggi lo stato del repertorio prima di riprovare.' }, { status: 500, headers });
    } finally { authority?.dispose(); }
}
