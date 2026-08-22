/* @Codex */
import { ingestAuthenticatedSmartImportAttachment } from '@/lib/security/server-session-authenticated-smart-import-attachment-ingest-production';
import { createSmartImportIngestHttpHandler } from '@/lib/security/server-session-smart-import-ingest-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createSmartImportIngestHttpHandler({ ingest: ingestAuthenticatedSmartImportAttachment });
