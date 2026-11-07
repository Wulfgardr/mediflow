/* Browser side of the reviewed attachment collection precondition (#758).
 * The view is captured from the list the user has in front of them, never
 * reread while a write is being dispatched. A batch extends it only with the
 * rows its own confirmed writes created or removed. */

export const ATTACHMENT_COLLECTION_CHANGED_CODE = 'ATTACHMENT_COLLECTION_CHANGED';

type Currentness = Readonly<{ sourceRef: string; revision: number; freshnessEpoch: number }>;
type CollectionRow = Readonly<{ id: string; currentness: Currentness }>;

/** The host refused the write because the patient's documents changed after the list was read. Nothing was written. */
export class AttachmentCollectionChangedError extends Error {
    constructor() {
        super('Attachment collection changed');
        this.name = 'AttachmentCollectionChangedError';
    }
}

/** The host refused the delete because the document or its whole record is under a retention hold (ADR 0178). Nothing was removed. */
export class AttachmentLegalHoldError extends Error {
    constructor() {
        super('Attachment under legal hold');
        this.name = 'AttachmentLegalHoldError';
    }
}

export function isLegalHoldPayload(payload: unknown): boolean {
    return Boolean(payload && typeof payload === 'object' && (payload as { code?: unknown }).code === 'legal_hold');
}

export function isAttachmentCollectionChangedPayload(payload: unknown): boolean {
    return Boolean(payload && typeof payload === 'object'
        && (payload as { code?: unknown }).code === ATTACHMENT_COLLECTION_CHANGED_CODE);
}

function validCurrentness(value: unknown): value is Currentness {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3) return false;
    const { sourceRef, revision, freshnessEpoch } = value as Record<string, unknown>;
    return typeof sourceRef === 'string' && /^[a-f0-9]{64}$/u.test(sourceRef)
        && Number.isSafeInteger(revision) && (revision as number) >= 1
        && Number.isSafeInteger(freshnessEpoch) && (freshnessEpoch as number) >= 1;
}

/** One patient's reviewed collection, advanced only by this view's own confirmed writes. */
export class AttachmentCollectionView {
    readonly patientId: string;
    #rows: Map<string, CollectionRow> | null;

    private constructor(patientId: string, rows: Map<string, CollectionRow>) {
        this.patientId = patientId;
        this.#rows = rows;
    }

    /** Throws when the list is not a complete, current reading of this patient's documents. */
    static capture(patientId: string, records: readonly Readonly<{ id: string; patientId: string; currentness?: unknown }>[] | undefined): AttachmentCollectionView {
        if (!patientId || !records) throw new Error('Attachment collection unavailable');
        const rows = new Map<string, CollectionRow>();
        for (const record of records) {
            if (!record.id || record.patientId !== patientId || !validCurrentness(record.currentness) || rows.has(record.id))
                throw new Error('Attachment collection unavailable');
            const { sourceRef, revision, freshnessEpoch } = record.currentness;
            rows.set(record.id, Object.freeze({ id: record.id, currentness: Object.freeze({ sourceRef, revision, freshnessEpoch }) }));
        }
        return new AttachmentCollectionView(patientId, rows);
    }

    /** The wire precondition. A view whose own write came back without a usable answer cannot be sent again. */
    expected(): CollectionRow[] {
        if (!this.#rows) throw new AttachmentCollectionChangedError();
        return [...this.#rows.values()];
    }

    recordCreated(id: unknown, currentness: unknown): void {
        if (!this.#rows) return;
        if (typeof id !== 'string' || !id || this.#rows.has(id) || !validCurrentness(currentness)) { this.#rows = null; return; }
        const { sourceRef, revision, freshnessEpoch } = currentness;
        this.#rows.set(id, Object.freeze({ id, currentness: Object.freeze({ sourceRef, revision, freshnessEpoch }) }));
    }

    recordDeleted(id: string): void {
        if (this.#rows && !this.#rows.delete(id)) this.#rows = null;
    }

    /** An unconfirmed write may have committed: the view no longer describes the host. */
    invalidate(): void {
        this.#rows = null;
    }
}

/**
 * Uploads each file once across attempts: a file already confirmed by the
 * server keeps its id, so retrying after a refused file neither stores a
 * duplicate document nor loses its link to the entry. Files removed from the
 * form are forgotten; their documents stay in the patient's folder.
 */
export async function uploadFilesOnce<F extends object>(
    files: readonly F[],
    confirmed: Map<F, string>,
    upload: (file: F) => Promise<string>,
): Promise<string[]> {
    for (const file of [...confirmed.keys()]) if (!files.includes(file)) confirmed.delete(file);
    const ids: string[] = [];
    for (const file of files) {
        let id = confirmed.get(file);
        if (id === undefined) {
            id = await upload(file);
            confirmed.set(file, id);
        }
        ids.push(id);
    }
    return ids;
}
