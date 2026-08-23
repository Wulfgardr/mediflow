/* @Codex */
import { issueAuthenticatedWebSessionSelection } from '@/lib/security/server-session-authenticated-selection-production';
import { readAuthenticatedWebSessionSelectionEpoch } from '@/lib/security/server-session-authenticated-selection-epoch-production';
import { createSmartImportSelectionEpochHttpHandler, createSmartImportSelectionHttpHandler } from '@/lib/security/server-session-smart-import-selection-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createSmartImportSelectionHttpHandler({
    issueSelection: issueAuthenticatedWebSessionSelection,
});

export const GET = createSmartImportSelectionEpochHttpHandler({
    readEpoch: readAuthenticatedWebSessionSelectionEpoch,
});
