/* @Codex */

export type BackfillCurrentnessCandidate = Readonly<{
    attachmentId: string;
    patientId: string;
    sourceRef: string;
    revision: number;
    freshnessEpoch: number;
    encryptedArtifact: string;
}>;

type SqliteDatabase = {
    prepare(sql: string): {
        run(...params: unknown[]): { changes: number };
    };
};

export function applyDocumentEvidenceArtifactsWithCurrentness(
    db: SqliteDatabase,
    candidates: readonly BackfillCurrentnessCandidate[],
): Readonly<{ attempted: number; written: number; skipped: number }> {
    let written = 0;
    let skipped = 0;
    const update = db.prepare(`
        update attachments
        set parse_evidence_artifact_snapshot = ?,
            document_revision = document_revision + 1,
            document_freshness_epoch = document_freshness_epoch + 1
        where id = ? and patient_id = ? and document_source_ref = ?
            and document_revision = ? and document_freshness_epoch = ?
    `);

    db.prepare('begin immediate').run();
    try {
        for (const candidate of candidates) {
            const result = update.run(
                candidate.encryptedArtifact,
                candidate.attachmentId,
                candidate.patientId,
                candidate.sourceRef,
                candidate.revision,
                candidate.freshnessEpoch,
            );
            if (result.changes === 1) written += 1;
            else skipped += 1;
        }
        db.prepare('commit').run();
    } catch (error) {
        db.prepare('rollback').run();
        throw error;
    }

    return Object.freeze({ attempted: candidates.length, written, skipped });
}
