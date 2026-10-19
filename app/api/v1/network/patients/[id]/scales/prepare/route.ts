import { NETWORK_CATALOG_READ_CAPABILITY } from '@/lib/network-catalog-read';
import { requireNetworkCapabilityContext } from '@/lib/network-write-context';
import { networkScaleFailure, prepareNetworkScale, scaleNoStore } from '@/lib/network-scale-service';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_CATALOG_READ_CAPABILITY);
        if (!resolved.ok) return scaleNoStore(resolved.response);
        const { id } = await params;
        return await prepareNetworkScale(resolved.context, id);
    } catch (error) { return networkScaleFailure(error); }
}
