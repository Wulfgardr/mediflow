import { ArchiveReplacedError } from './archive-generation';
import { TerritorialPackError } from './territorial-packs';
import type { createTerritorialPackHostOwner } from './territorial-pack-host';

export function createTerritorialPackHttpHandler(owner: ReturnType<typeof createTerritorialPackHostOwner>) {
    return async (request: Request): Promise<Response> => {
        try {
            let value;
            if (request.method === 'GET') value = await owner.read();
            else if (request.method === 'PUT') {
                let input: unknown;
                try { input = await request.json(); } catch { throw new TerritorialPackError('input_invalid'); }
                value = await owner.transition(request, input);
            } else return Response.json({ code: 'method_not_allowed' }, { status: 405 });
            return Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
        } catch (error) {
            const code = error instanceof TerritorialPackError || error instanceof ArchiveReplacedError ? error.code : 'internal_error';
            const status = code === 'channel_denied' ? 403 : code === 'input_invalid' ? 400 : code === 'internal_error' ? 500 : 409;
            return Response.json({ code }, { status, headers: { 'Cache-Control': 'no-store' } });
        }
    };
}
