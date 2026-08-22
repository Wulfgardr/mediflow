/* @Codex */
import 'server-only';

import { acquireAuthenticatedWebSessionProjectionOwnerContext } from './server-auth';
import { createAuthenticatedSmartImportAttachmentIngestService } from './server-session-authenticated-smart-import-attachment-ingest';
import { ingestServerSessionSmartImportAttachmentWithOwner } from './server-session-smart-import-attachment-ingest';

export const ingestAuthenticatedSmartImportAttachment = createAuthenticatedSmartImportAttachmentIngestService({
    acquireContext: acquireAuthenticatedWebSessionProjectionOwnerContext,
    ingestWithOwner: ingestServerSessionSmartImportAttachmentWithOwner,
}).ingest;
