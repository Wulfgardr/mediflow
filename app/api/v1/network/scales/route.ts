import { NETWORK_CATALOG_READ_CAPABILITY } from '@/lib/network-catalog-read';
import { requireNetworkCapabilityContext } from '@/lib/network-write-context';
import { networkScaleFailure, readNetworkScaleCatalog, scaleNoStore } from '@/lib/network-scale-service';

export async function GET(request: Request) {
    try {
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_CATALOG_READ_CAPABILITY);
        if (!resolved.ok) return scaleNoStore(resolved.response);
        return await readNetworkScaleCatalog(resolved.context);
    } catch (error) { return networkScaleFailure(error); }
}
