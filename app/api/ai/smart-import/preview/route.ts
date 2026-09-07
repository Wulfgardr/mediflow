/* @Codex */
import { withFunctionModelDispatch } from '@/lib/ai-providers/fabric/function-model-preferences-production';
import { acquireAuthenticatedSmartImportPreview } from '@/lib/security/server-session-authenticated-smart-import-preview-production';
import { createSmartImportPreviewHttpHandler } from '@/lib/security/server-session-smart-import-preview-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withFunctionModelDispatch('smart_import', createSmartImportPreviewHttpHandler({ acquirePreview: acquireAuthenticatedSmartImportPreview }));
