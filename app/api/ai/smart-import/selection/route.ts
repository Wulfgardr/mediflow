/* @Codex */
import { acquireAuthenticatedWebSessionSelection } from '@/lib/security/server-session-authenticated-selection-production';
import { readAuthenticatedWebSessionSelectionEpoch } from '@/lib/security/server-session-authenticated-selection-epoch-production';
import { createSmartImportSelectionEpochHttpHandler, createSmartImportSelectionHttpHandler } from '@/lib/security/server-session-smart-import-selection-http';
import { completePortableSupervisorWebLifecycleMutationV1 } from '@/lib/security/portable-supervisor-web-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const selectCurrent = createSmartImportSelectionHttpHandler({
    acquireSelection: acquireAuthenticatedWebSessionSelection,
});

export function POST(request: Request) {
    return completePortableSupervisorWebLifecycleMutationV1(
        selectCurrent(request),
        'reselection',
    );
}

export const GET = createSmartImportSelectionEpochHttpHandler({
    readEpoch: readAuthenticatedWebSessionSelectionEpoch,
});
