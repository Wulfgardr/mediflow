import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { attachmentCollectionSchema } from './api-schemas/attachments';
import type { dbServer } from './db-server';
import { attachments } from './schema';

/** Stable machine code for a stale reviewed collection, shared by every writer of the collection. */
export const ATTACHMENT_COLLECTION_CHANGED = 'ATTACHMENT_COLLECTION_CHANGED';
export const ATTACHMENT_COLLECTION_CHANGED_ERROR = 'Attachment collection changed. Review the documents again.';

/** Must run inside the same immediate transaction as the insert, after patient authorization. */
export function attachmentCollectionMatches(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    patientId: string,
    expected: z.infer<typeof attachmentCollectionSchema> | undefined,
): boolean {
    if (expected === undefined) return true;
    const observed = tx.select({ id: attachments.id, sourceRef: attachments.documentSourceRef,
        revision: attachments.documentRevision, freshnessEpoch: attachments.documentFreshnessEpoch })
        .from(attachments).where(eq(attachments.patientId, patientId)).all();
    if (observed.length !== expected.length) return false;
    const byId = new Map(expected.map(row => [row.id, row.currentness]));
    return observed.every(row => {
        const current = byId.get(row.id);
        return current !== undefined && current.sourceRef === row.sourceRef
            && current.revision === row.revision && current.freshnessEpoch === row.freshnessEpoch;
    });
}
