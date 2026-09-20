/* @Codex: WUL-673. Existing paired authority; no native-to-Web session conversion. */
import { NETWORK_CATALOG_READ_CAPABILITY } from '@/lib/network-catalog-read';
import { requireNetworkCapabilityContext } from '@/lib/network-write-context';
import { peekSession } from '@/lib/security/server-session';
import { getIcd11WhoProductionRuntime } from '@/lib/reference-data/icd11-who-production';
import { createIcd11WhoNetworkRoute } from '@/lib/reference-data/icd11-who-network-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handle = createIcd11WhoNetworkRoute('search', {
    resolveContext: request => requireNetworkCapabilityContext(request, NETWORK_CATALOG_READ_CAPABILITY),
    isSessionCurrent: context => peekSession(context.session.id) === context.session,
    getRuntime: getIcd11WhoProductionRuntime,
});

export async function GET(request: Request): Promise<Response> {
    return handle(request);
}
