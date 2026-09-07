/* @Codex */
import { createWhoCodeCheckRoute } from '@/lib/reference-data/icd11-who-code-check-http';
import { getIcd11WhoProductionRuntime } from '@/lib/reference-data/icd11-who-production';
import { requireSession } from '@/lib/security/server-auth';

export const runtime = 'nodejs';
export const GET = createWhoCodeCheckRoute({
    authorize: async () => (await requireSession()) !== null,
    getRuntime: getIcd11WhoProductionRuntime,
});
