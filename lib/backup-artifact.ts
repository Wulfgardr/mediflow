export const BACKUP_ARTIFACT_FORMAT = 'mediflow-backup' as const;
export const BACKUP_ARTIFACT_VERSION = 1 as const;
export const BACKUP_ARTIFACT_SCOPE = 'mediflow-web-local-backup' as const;

export const BACKUP_COLLECTIONS = [
    'ambulatories',
    'attachments',
    'conversations',
    'documentDiagnosisProposals',
    'durableReviewCommandStates',
    'durableReviewCommandOperations',
    'durableReviewPatientLinks',
    'durableReviewRecords',
    'durableReviewOperations',
    'drugs',
    'entries',
    'exemptions',
    'messages',
    'observations',
    'patients',
    'physicianReviewAttestations',
    'prostheticPrescriptions',
    'serviceCatalogEntries',
    'servicePrescriptionItems',
    'servicePrescriptions',
    'sissHandoffs',
    'checkups',
    'therapies',
] as const;

export type BackupCollectionName = (typeof BACKUP_COLLECTIONS)[number];
export type BackupRecord = Record<string, unknown>;
type AuditDependentCommandCollection = 'durableReviewCommandStates' | 'durableReviewCommandOperations';
export type BackupDataset = Record<Exclude<BackupCollectionName, AuditDependentCommandCollection>, BackupRecord[]>
    & Partial<Record<AuditDependentCommandCollection, BackupRecord[]>>;

/* @Codex */
const DURABLE_REVIEW_AUTHORITY_COLLECTIONS = new Set<BackupCollectionName>([
    'durableReviewPatientLinks',
    'physicianReviewAttestations',
]);
/* @Codex Artifacts created before durable review authority was added have no such collections. */
const PRE_DURABLE_REVIEW_AUTHORITY_COLLECTIONS = BACKUP_COLLECTIONS.filter(
    (collection) => !DURABLE_REVIEW_AUTHORITY_COLLECTIONS.has(collection),
);
/* @Codex */
const LEGACY_OMITTED_COLLECTION_SETS: readonly (readonly BackupCollectionName[])[] = [
    ['durableReviewCommandStates', 'durableReviewCommandOperations'],
    ['durableReviewRecords', 'durableReviewOperations', 'durableReviewCommandStates', 'durableReviewCommandOperations'],
    ['documentDiagnosisProposals', 'durableReviewRecords', 'durableReviewOperations', 'durableReviewCommandStates', 'durableReviewCommandOperations'],
];
/* @Codex v1 recognizes both the authority-era and pre-authority collection generations. */
const LEGACY_COLLECTION_SETS: readonly (readonly BackupCollectionName[])[] = [
    ...LEGACY_OMITTED_COLLECTION_SETS.map((omitted) => BACKUP_COLLECTIONS.filter((collection) => !omitted.includes(collection))),
    ...LEGACY_OMITTED_COLLECTION_SETS.map((omitted) => PRE_DURABLE_REVIEW_AUTHORITY_COLLECTIONS.filter((collection) => !omitted.includes(collection))),
];
const PATIENT_DEPENDENT_COLLECTIONS: readonly BackupCollectionName[] = [
    'attachments',
    'checkups',
    'documentDiagnosisProposals',
    'durableReviewPatientLinks',
    'entries',
    'observations',
    'prostheticPrescriptions',
    'servicePrescriptionItems',
    'servicePrescriptions',
    'sissHandoffs',
    'therapies',
];
/* @Codex Backup validation mirrors the durable store without importing its server-only writer. */
const DURABLE_REVIEW = /^review_[0-9a-f]{32}$/;
const DURABLE_PATIENT = /^ptr_[0-9a-f]{32}$/;
const DURABLE_RECEIPT = /^receipt_[0-9a-f]{32}$/;
const DURABLE_PROVENANCE = /^provenance_[0-9a-f]{32}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SEALED_CIPHERTEXT = /^ENC:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/;
const IDEMPOTENCY_KEY = /^idem_[a-z0-9]{16,160}$/;
const DURABLE_RECORD_KEYS = ['patientRef', 'reviewId', 'reviewRevision', 'receiptRef', 'provenanceRef', 'receiptBinding', 'provenanceBinding', 'presentationVersion', 'sealedCiphertext', 'sealedDigest'] as const;
const DURABLE_BACKUP_RECORD_KEYS = ['id', ...DURABLE_RECORD_KEYS, 'createdAt'] as const;
const DURABLE_OPERATION_KEYS = ['id', 'reviewId', 'idempotencyKey', 'operation', 'expectedReviewRevision', 'operationDigest', 'recordSnapshot', 'createdAt'] as const;
const DURABLE_PRESENTATION_VERSION = 'mediflow.ai.durable-review.presentation.v1';

export interface BackupArtifactManifest {
    scope: typeof BACKUP_ARTIFACT_SCOPE;
    createdAt: string;
    checksumAlgorithm: 'sha256';
    checksum: string;
    collections: readonly BackupCollectionName[];
    recordCounts: Record<BackupCollectionName, number>;
}

export interface BackupArtifact {
    format: typeof BACKUP_ARTIFACT_FORMAT;
    version: typeof BACKUP_ARTIFACT_VERSION;
    manifest: BackupArtifactManifest;
    payload: BackupDataset;
}

export type BackupArtifactErrorCode =
    | 'invalid-json'
    | 'invalid-format'
    | 'unsupported-version'
    | 'invalid-manifest'
    | 'collection-mismatch'
    | 'count-mismatch'
    | 'checksum-mismatch';

export class BackupArtifactError extends Error {
    readonly code: BackupArtifactErrorCode;

    constructor(
        code: BackupArtifactErrorCode,
        message: string,
    ) {
        super(message);
        this.code = code;
        this.name = 'BackupArtifactError';
    }
}

function normalizeJson(value: unknown): unknown {
    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Array.isArray(value)) {
        return value.map((entry) => normalizeJson(entry));
    }

    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const normalized: Record<string, unknown> = {};
        for (const key of Object.keys(record).sort()) {
            const entry = normalizeJson(record[key]);
            if (entry !== undefined) {
                normalized[key] = entry;
            }
        }
        return normalized;
    }

    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || value === null) {
        return value;
    }

    return undefined;
}

export function stableStringify(value: unknown): string {
    return JSON.stringify(normalizeJson(value));
}

function createEmptyCounts(): Record<BackupCollectionName, number> {
    return Object.fromEntries(BACKUP_COLLECTIONS.map((collection) => [collection, 0])) as Record<BackupCollectionName, number>;
}

export function createEmptyDataset(): BackupDataset {
    return Object.fromEntries(BACKUP_COLLECTIONS.map((collection) => [collection, []])) as unknown as BackupDataset;
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/* @Codex */
function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(value).length === keys.length
        && keys.every((key) => Object.hasOwn(descriptors, key) && 'value' in descriptors[key]! && descriptors[key]!.enumerable);
}

/* @Codex */
async function normalizeDurableReviewRecord(value: unknown): Promise<Record<string, unknown>> {
    if (!hasExactKeys(value, DURABLE_RECORD_KEYS)) throw new BackupArtifactError('invalid-manifest', 'Durable review record is invalid.');
    const patientRef = value.patientRef; const reviewId = value.reviewId; const reviewRevision = value.reviewRevision;
    const receiptRef = value.receiptRef; const provenanceRef = value.provenanceRef; const receiptBinding = value.receiptBinding;
    const provenanceBinding = value.provenanceBinding; const sealedCiphertext = value.sealedCiphertext; const sealedDigest = value.sealedDigest;
    if (typeof patientRef !== 'string' || !DURABLE_PATIENT.test(patientRef)
        || typeof reviewId !== 'string' || !DURABLE_REVIEW.test(reviewId)
        || typeof reviewRevision !== 'number' || !Number.isSafeInteger(reviewRevision) || reviewRevision < 1
        || typeof receiptRef !== 'string' || !DURABLE_RECEIPT.test(receiptRef)
        || typeof provenanceRef !== 'string' || !DURABLE_PROVENANCE.test(provenanceRef)
        || typeof receiptBinding !== 'string' || !SHA256.test(receiptBinding) || receiptBinding !== await sha256Hex(`${patientRef}\0${reviewId}\0${receiptRef}`)
        || typeof provenanceBinding !== 'string' || !SHA256.test(provenanceBinding) || provenanceBinding !== await sha256Hex(`${patientRef}\0${reviewId}\0${provenanceRef}`)
        || value.presentationVersion !== DURABLE_PRESENTATION_VERSION
        || typeof sealedCiphertext !== 'string' || !SEALED_CIPHERTEXT.test(sealedCiphertext)
        || typeof sealedDigest !== 'string' || !SHA256.test(sealedDigest) || sealedDigest !== await sha256Hex(sealedCiphertext)) {
        throw new BackupArtifactError('invalid-manifest', 'Durable review record is invalid.');
    }
    return { patientRef, reviewId, reviewRevision, receiptRef, provenanceRef, receiptBinding, provenanceBinding, presentationVersion: DURABLE_PRESENTATION_VERSION, sealedCiphertext, sealedDigest };
}

/* @Codex */
async function assertDurableReviewLedger(payload: Partial<Record<BackupCollectionName, BackupRecord[]>>): Promise<void> {
    /* @Codex The v1 payload does not own the append-only audit ledger required by command replay. */
    if ((payload.durableReviewCommandStates?.length ?? 0) > 0 || (payload.durableReviewCommandOperations?.length ?? 0) > 0) {
        throw new BackupArtifactError('invalid-manifest', 'Durable review command state requires its append-only audit ledger.');
    }
    const records = new Map<string, Record<string, unknown>>();
    for (const row of payload.durableReviewRecords ?? []) {
        if (!hasExactKeys(row, DURABLE_BACKUP_RECORD_KEYS) || row.id !== row.reviewId) throw new BackupArtifactError('invalid-manifest', 'Durable review record is invalid.');
        const record = await normalizeDurableReviewRecord((( { id: _id, createdAt: _createdAt, ...value }) => value)(row));
        if (records.has(record.reviewId as string)) throw new BackupArtifactError('invalid-manifest', 'Durable review record is duplicated.');
        records.set(record.reviewId as string, record);
    }

    const operationsByReview = new Map<string, Array<{ operation: 'create' | 'replace'; expectedReviewRevision: number; record: Record<string, unknown> }>>();
    const operationIds = new Set<string>();
    const operationKeys = new Set<string>();
    for (const row of payload.durableReviewOperations ?? []) {
        if (!hasExactKeys(row, DURABLE_OPERATION_KEYS)
            || typeof row.id !== 'string' || typeof row.reviewId !== 'string' || typeof row.idempotencyKey !== 'string'
            || typeof row.expectedReviewRevision !== 'number' || !Number.isSafeInteger(row.expectedReviewRevision) || row.expectedReviewRevision < 0
            || (row.operation !== 'create' && row.operation !== 'replace') || typeof row.operationDigest !== 'string' || !SHA256.test(row.operationDigest)
            || typeof row.recordSnapshot !== 'string' || !IDEMPOTENCY_KEY.test(row.idempotencyKey) || !records.has(row.reviewId)) {
            throw new BackupArtifactError('invalid-manifest', 'Durable review operation is invalid.');
        }
        const key = `${row.reviewId}\0${row.idempotencyKey}`;
        if (operationIds.has(row.id) || operationKeys.has(key) || row.id !== await sha256Hex(key)) throw new BackupArtifactError('invalid-manifest', 'Durable review operation is invalid.');
        let snapshot: unknown;
        try { snapshot = JSON.parse(row.recordSnapshot); } catch { throw new BackupArtifactError('invalid-manifest', 'Durable review operation is invalid.'); }
        const record = await normalizeDurableReviewRecord(snapshot);
        if (row.recordSnapshot !== JSON.stringify(record)
            || record.reviewId !== row.reviewId
            || record.reviewRevision !== row.expectedReviewRevision + 1
            || row.operationDigest !== await sha256Hex(JSON.stringify([row.operation, row.expectedReviewRevision, record]))) {
            throw new BackupArtifactError('invalid-manifest', 'Durable review operation is invalid.');
        }
        operationIds.add(row.id); operationKeys.add(key);
        operationsByReview.set(row.reviewId, [...(operationsByReview.get(row.reviewId) ?? []), { operation: row.operation, expectedReviewRevision: row.expectedReviewRevision, record }]);
    }

    for (const [reviewId, current] of records) {
        const operations = operationsByReview.get(reviewId)?.sort((left, right) => (left.record.reviewRevision as number) - (right.record.reviewRevision as number));
        if (!operations || operations.length === 0 || operations[0].operation !== 'create' || operations[0].expectedReviewRevision !== 0) throw new BackupArtifactError('invalid-manifest', 'Durable review ledger is incomplete.');
        for (let index = 1; index < operations.length; index += 1) {
            if (operations[index].operation !== 'replace' || operations[index].expectedReviewRevision !== operations[index - 1].record.reviewRevision || operations[index].record.patientRef !== operations[index - 1].record.patientRef) throw new BackupArtifactError('invalid-manifest', 'Durable review ledger is inconsistent.');
        }
        const latest = operations.at(-1)!.record;
        if (JSON.stringify(latest) !== JSON.stringify(current)) throw new BackupArtifactError('invalid-manifest', 'Durable review ledger is inconsistent.');
    }
}

function hasCollectionSet(payload: Record<string, unknown>, collections: readonly string[]): boolean {
    const payloadCollections = Object.keys(payload).sort();
    const expectedCollections = [...collections].sort();
    return payloadCollections.length === expectedCollections.length
        && payloadCollections.every((collection, index) => collection === expectedCollections[index]);
}

function assertCollectionSet(payload: Record<string, unknown>, collections: readonly string[] = BACKUP_COLLECTIONS): void {
    if (!hasCollectionSet(payload, collections)) {
        throw new BackupArtifactError(
            'collection-mismatch',
            'Backup payload collections do not match the v1 schema.',
        );
    }
}

function assertCollectionCounts(
    payload: Record<string, unknown>,
    recordCounts: Record<string, unknown>,
    collections: readonly string[] = BACKUP_COLLECTIONS,
): void {
    if (!hasCollectionSet(recordCounts, collections)) {
        throw new BackupArtifactError('collection-mismatch', 'Backup manifest record counts do not match the v1 schema.');
    }
    for (const collection of collections) {
        const actualCount = Array.isArray(payload[collection]) ? payload[collection].length : 0;
        if (actualCount !== recordCounts[collection]) {
            throw new BackupArtifactError(
                'count-mismatch',
                `Backup manifest count mismatch for ${collection}.`,
            );
        }
    }
}

function assertCollectionArrays(payload: Record<string, unknown>, collections: readonly string[] = BACKUP_COLLECTIONS): void {
    for (const collection of collections) {
        if (!Array.isArray(payload[collection])) {
            throw new BackupArtifactError(
                'invalid-manifest',
                `Backup payload collection ${collection} must be an array.`,
            );
        }
    }
}

/* @Codex */
function parseAssignedAmbulatoryIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    ));
}

/* @Codex */
function parseAssignedAmbulatoryMemberships(value: unknown): Array<{ ambulatoryId: string; assignedAt: unknown }> {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const membership = item as Record<string, unknown>;
        if (typeof membership.ambulatoryId !== 'string' || membership.ambulatoryId.trim().length === 0) return [];
        return [{ ambulatoryId: membership.ambulatoryId, assignedAt: membership.assignedAt }];
    });
}

async function assertCollectionReferences(
    payload: Partial<Record<BackupCollectionName, BackupRecord[]>>,
    patientDependentCollections: readonly BackupCollectionName[] = PATIENT_DEPENDENT_COLLECTIONS,
): Promise<void> {
    const ambulatoryIds = new Set(
        (payload.ambulatories ?? [])
            .map((item) => item.id)
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    );
    const patientIds = new Set(
        (payload.patients ?? [])
            .map((item) => item.id)
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    );
    const conversationIds = new Set(
        (payload.conversations ?? [])
            .map((item) => item.id)
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    );

    for (const patient of payload.patients ?? []) {
        if (typeof patient.ambulatoryId === 'string' && patient.ambulatoryId.trim().length > 0 && !ambulatoryIds.has(patient.ambulatoryId)) {
            throw new BackupArtifactError(
                'invalid-manifest',
                `Patient ${patient.id ?? '<unknown>'} references an unknown ambulatory.`,
            );
        }

        for (const ambulatoryId of parseAssignedAmbulatoryIds(patient.assignedAmbulatoryIds)) {
            if (!ambulatoryIds.has(ambulatoryId)) {
                throw new BackupArtifactError(
                    'invalid-manifest',
                    `Patient ${patient.id ?? '<unknown>'} references an unknown assigned ambulatory.`,
                );
            }
        }

        for (const membership of parseAssignedAmbulatoryMemberships(patient.assignedAmbulatoryMemberships)) {
            if (!ambulatoryIds.has(membership.ambulatoryId)) {
                throw new BackupArtifactError(
                    'invalid-manifest',
                    `Patient ${patient.id ?? '<unknown>'} references an unknown ambulatory membership.`,
                );
            }
            if (membership.assignedAt !== null && membership.assignedAt !== undefined) {
                const assignedAt = membership.assignedAt instanceof Date
                    ? membership.assignedAt
                    : new Date(typeof membership.assignedAt === 'number' && Math.abs(membership.assignedAt) < 1_000_000_000_000
                        ? membership.assignedAt * 1000
                        : membership.assignedAt as string | number);
                if (Number.isNaN(assignedAt.getTime())) {
                    throw new BackupArtifactError(
                        'invalid-manifest',
                        `Patient ${patient.id ?? '<unknown>'} has an invalid ambulatory membership timestamp.`,
                    );
                }
            }
        }
    }

    for (const collection of patientDependentCollections) {
        for (const item of payload[collection] ?? []) {
            if (typeof item.patientId !== 'string' || !patientIds.has(item.patientId)) {
                throw new BackupArtifactError(
                    'invalid-manifest',
                    `${collection} contains an unknown patient reference.`,
                );
            }
        }
    }

    const durableReviewIds = new Set(
        (payload.durableReviewRecords ?? [])
            .map((item) => item.reviewId)
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    );
    const durableReviewPatientLinkIds = new Set<string>();
    for (const link of payload.durableReviewPatientLinks ?? []) {
        if (typeof link.reviewId !== 'string' || !durableReviewIds.has(link.reviewId)
            || typeof link.patientId !== 'string' || !patientIds.has(link.patientId)
            || durableReviewPatientLinkIds.has(link.reviewId)) {
            throw new BackupArtifactError('invalid-manifest', 'durableReviewPatientLinks contains an invalid durable review reference.');
        }
        durableReviewPatientLinkIds.add(link.reviewId);
    }

    for (const message of payload.messages ?? []) {
        if (typeof message.conversationId !== 'string' || !conversationIds.has(message.conversationId)) {
            throw new BackupArtifactError(
                'invalid-manifest',
                'messages contains an unknown conversation reference.',
            );
        }
    }

    await assertDurableReviewLedger(payload);
}

export async function createBackupArtifact(payload: BackupDataset, createdAt = new Date()): Promise<BackupArtifact> {
    /* @Codex Existing v1 producers add the audit-dependent collections as empty until audit restore is separately contracted. */
    const currentPayload = { ...createEmptyDataset(), ...payload } as BackupDataset;
    assertCollectionSet(currentPayload as Record<string, unknown>);
    await assertCollectionReferences(currentPayload);

    const recordCounts = createEmptyCounts();
    for (const collection of BACKUP_COLLECTIONS) {
        recordCounts[collection] = currentPayload[collection]?.length ?? 0;
    }

    const payloadSnapshot = normalizeJson(currentPayload);
    const checksum = await sha256Hex(stableStringify(payloadSnapshot));

    return {
        format: BACKUP_ARTIFACT_FORMAT,
        version: BACKUP_ARTIFACT_VERSION,
        manifest: {
            scope: BACKUP_ARTIFACT_SCOPE,
            createdAt: createdAt.toISOString(),
            checksumAlgorithm: 'sha256',
            checksum,
            collections: [...BACKUP_COLLECTIONS],
            recordCounts,
        },
        payload: currentPayload,
    };
}

export async function serializeBackupArtifact(payload: BackupDataset, createdAt = new Date()): Promise<string> {
    const artifact = await createBackupArtifact(payload, createdAt);
    return JSON.stringify(normalizeJson(artifact), null, 2);
}

export async function parseBackupArtifact(value: unknown): Promise<BackupArtifact> {
    if (!value || typeof value !== 'object') {
        throw new BackupArtifactError('invalid-json', 'Backup artifact must be a JSON object.');
    }

    const artifact = value as Partial<BackupArtifact> & { manifest?: Partial<BackupArtifactManifest>; payload?: Record<string, unknown> };

    if (artifact.format !== BACKUP_ARTIFACT_FORMAT) {
        throw new BackupArtifactError('invalid-format', 'Unsupported backup artifact format.');
    }

    if (artifact.version !== BACKUP_ARTIFACT_VERSION) {
        throw new BackupArtifactError('unsupported-version', 'Unsupported backup artifact version.');
    }

    const manifest = artifact.manifest;
    if (!manifest || manifest.scope !== BACKUP_ARTIFACT_SCOPE || manifest.checksumAlgorithm !== 'sha256' || typeof manifest.checksum !== 'string' || typeof manifest.createdAt !== 'string') {
        throw new BackupArtifactError('invalid-manifest', 'Backup manifest is incomplete or invalid.');
    }

    const payload = artifact.payload;
    if (!payload || typeof payload !== 'object') {
        throw new BackupArtifactError('invalid-manifest', 'Backup payload is missing.');
    }

    const legacyCollections = LEGACY_COLLECTION_SETS.find((collections) => hasCollectionSet(payload, collections));
    const expectedCollections = legacyCollections ?? BACKUP_COLLECTIONS;
    const missingLegacyCollections = legacyCollections
        ? BACKUP_COLLECTIONS.filter((collection) => !legacyCollections.includes(collection))
        : [];
    const expectedPatientDependentCollections = PATIENT_DEPENDENT_COLLECTIONS.filter(
        (collection) => expectedCollections.includes(collection),
    );

    assertCollectionSet(payload, expectedCollections);
    assertCollectionArrays(payload, expectedCollections);

    if (!Array.isArray(manifest.collections) || manifest.collections.length !== expectedCollections.length || manifest.collections.some((collection, index) => collection !== expectedCollections[index])) {
        throw new BackupArtifactError('collection-mismatch', 'Backup manifest collection list is invalid.');
    }

    if (!manifest.recordCounts || typeof manifest.recordCounts !== 'object') {
        throw new BackupArtifactError('invalid-manifest', 'Backup manifest counts are missing.');
    }

    assertCollectionCounts(payload, manifest.recordCounts as Record<string, unknown>, expectedCollections);
    await assertCollectionReferences(payload as Partial<Record<BackupCollectionName, BackupRecord[]>>, expectedPatientDependentCollections);

    const createdAt = new Date(manifest.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
        throw new BackupArtifactError('invalid-manifest', 'Backup manifest createdAt is invalid.');
    }

    const checksum = await sha256Hex(stableStringify(normalizeJson(payload)));
    if (checksum !== manifest.checksum) {
        throw new BackupArtifactError('checksum-mismatch', 'Backup checksum does not match the payload.');
    }

    /* @Codex Legacy v1 artifacts are authenticated in their original form before this additive normalization. */
    const normalizedPayload = legacyCollections
        ? { ...payload, ...Object.fromEntries(missingLegacyCollections.map((collection) => [collection, []])) } as BackupDataset
        : payload as BackupDataset;
    const normalizedRecordCounts = legacyCollections
        ? { ...manifest.recordCounts, ...Object.fromEntries(missingLegacyCollections.map((collection) => [collection, 0])) } as Record<BackupCollectionName, number>
        : manifest.recordCounts as Record<BackupCollectionName, number>;
    const normalizedChecksum = legacyCollections
        ? await sha256Hex(stableStringify(normalizeJson(normalizedPayload)))
        : manifest.checksum;

    return {
        format: BACKUP_ARTIFACT_FORMAT,
        version: BACKUP_ARTIFACT_VERSION,
        manifest: {
            scope: BACKUP_ARTIFACT_SCOPE,
            createdAt: manifest.createdAt,
            checksumAlgorithm: 'sha256',
            checksum: normalizedChecksum,
            collections: [...BACKUP_COLLECTIONS],
            recordCounts: normalizedRecordCounts,
        },
        payload: normalizedPayload,
    };
}
