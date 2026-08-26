/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';

import { dbServer } from '../../db-server';
import { acquireAuthenticatedWebSessionProjectionOwnerContext } from '../../security/server-auth';
import { registerServerSessionResource } from '../../security/server-session';
import { createDocumentSynthesisAuthenticatedAttachmentCapture } from './document-synthesis-authenticated-attachment-capture';

/** Production composition for the I1b own-attachment intent boundary. */
export const captureDocumentSynthesisAuthenticatedAttachment = createDocumentSynthesisAuthenticatedAttachmentCapture({
    acquireContext: acquireAuthenticatedWebSessionProjectionOwnerContext,
    lookup(selection, attachmentId) {
        return dbServer.get(sql`
            SELECT a.document_source_ref AS documentSourceRef,
                   a.document_revision AS documentRevision,
                   a.document_freshness_epoch AS documentFreshnessEpoch
            FROM attachments AS a
            INNER JOIN patients_to_ambulatories AS pta ON pta.patient_id = a.patient_id
            WHERE a.id = ${attachmentId}
              AND a.patient_id = ${selection.patientId}
              AND pta.ambulatory_id = ${selection.ambulatoryId}
            LIMIT 1`);
    },
    registerSessionResource: registerServerSessionResource,
    entropy: () => randomBytes(16),
}).capture;
