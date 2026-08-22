/* @Codex */
import { issueAuthenticatedWebSessionSelection } from '@/lib/security/server-session-authenticated-selection-production';
import { createSmartImportSelectionHttpHandler } from '@/lib/security/server-session-smart-import-selection-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createSmartImportSelectionHttpHandler({
    issueSelection: issueAuthenticatedWebSessionSelection,
});
