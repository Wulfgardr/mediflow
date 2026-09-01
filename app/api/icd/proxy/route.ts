/* @Codex */
import type { NextRequest } from 'next/server';

import { createIcd11WhoHttpRoute } from '@/lib/reference-data/icd11-who-http-route';
import { getIcd11WhoProductionRuntime } from '@/lib/reference-data/icd11-who-production';
import { requireSession } from '@/lib/security/server-auth';

const handleIcd11WhoRequest = createIcd11WhoHttpRoute(Object.freeze({
    authorize: async () => (await requireSession()) !== null,
    getRuntime: getIcd11WhoProductionRuntime,
}));

export async function GET(request: NextRequest): Promise<Response> {
    return handleIcd11WhoRequest(request);
}
