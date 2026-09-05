/* @Codex */
import 'server-only';

import type { AuthenticatedWebSessionProjectionOwnerContext } from './server-auth';
import {
    ingestServerSessionSmartImportAttachmentWithOwner,
    ServerSessionSmartImportAttachmentIngestError,
} from './server-session-smart-import-attachment-ingest';

type Sources = Readonly<{
    acquireContext(): Promise<AuthenticatedWebSessionProjectionOwnerContext | null>;
    ingestWithOwner: typeof ingestServerSessionSmartImportAttachmentWithOwner;
}>;
export type AuthenticatedSmartImportAttachmentIngestOperation = Readonly<{
    ingest(input: unknown): Promise<string>;
}>;

function unavailable(): never {
    throw new ServerSessionSmartImportAttachmentIngestError('session_unavailable');
}

export function createAuthenticatedSmartImportAttachmentIngestService(sources: Sources) {
    const acquire = async (): Promise<AuthenticatedSmartImportAttachmentIngestOperation> => {
        let context: AuthenticatedWebSessionProjectionOwnerContext | null;
        try { context = await sources.acquireContext(); } catch { return unavailable(); }
        if (!context) return unavailable();
        return Object.freeze({
            async ingest(input: unknown): Promise<string> {
                return sources.ingestWithOwner(context.session, context.owner, input);
            },
        });
    };

    return Object.freeze({
        acquire,
        async ingest(input: unknown): Promise<string> {
            return (await acquire()).ingest(input);
        },
    });
}
