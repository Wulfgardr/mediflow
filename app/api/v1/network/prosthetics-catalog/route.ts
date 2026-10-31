import { requireNetworkCapabilityContext } from '@/lib/network-write-context';
import { NETWORK_PROSTHETIC_PRESCRIPTION_READ_CAPABILITY, readProstheticsCatalog } from '@/lib/prosthetic-prescription-write';

export async function GET(request: Request) {
    const headers = { 'Cache-Control': 'no-store' };
    try {
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_PROSTHETIC_PRESCRIPTION_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;
        const params = new URL(request.url).searchParams;
        const query = params.get('q') ?? '';
        if ([...params.keys()].some(key => key !== 'q') || params.getAll('q').length !== 1
            || query.length < 2 || query.length > 80 || /[\u0000-\u001f\u007f-\u009f]/u.test(query))
            return Response.json({ error: 'INVALID_QUERY' }, { status: 400, headers });
        const result = readProstheticsCatalog(query);
        if (result === null) return Response.json({ error: 'CATALOG_UNAVAILABLE' }, { status: 409, headers });
        return Response.json(result, { headers });
    } catch {
        return Response.json({ error: 'CATALOG_UNAVAILABLE' }, { status: 503, headers });
    }
}
