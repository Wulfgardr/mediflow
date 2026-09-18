/* @Codex */
import 'server-only';

import { acquireOrdinaryApplicationContext } from './ordinary-application-context';
import { createAuthenticatedSmartImportAttachmentIngestService } from './server-session-authenticated-smart-import-attachment-ingest';
import { ingestServerSessionSmartImportAttachmentWithOwner, ingestNativeSessionSmartImportAttachmentWithOwner } from './server-session-smart-import-attachment-ingest';

export const acquireAuthenticatedSmartImportAttachmentIngest = createAuthenticatedSmartImportAttachmentIngestService({
    acquireContext: acquireOrdinaryApplicationContext,
    ingestWithOwner: (session, owner, input) => session.authChannel === 'native'
        ? ingestNativeSessionSmartImportAttachmentWithOwner(session, owner, input)
        : ingestServerSessionSmartImportAttachmentWithOwner(session, owner, input),
}).acquire;
