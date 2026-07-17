export const BACKUP_ARTIFACT_FORMAT = 'mediflow-backup' as const;
export const BACKUP_ARTIFACT_VERSION = 1 as const;
export const BACKUP_ARTIFACT_SCOPE = 'mediflow-web-local-backup' as const;

export const BACKUP_COLLECTIONS = [
    'ambulatories',
    'attachments',
    'conversations',
    'drugs',
    'entries',
    'exemptions',
    'messages',
    'observations',
    'patients',
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
export type BackupDataset = Record<BackupCollectionName, BackupRecord[]>;

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

function assertCollectionSet(payload: BackupDataset): void {
    const payloadCollections = Object.keys(payload).sort();
    const expectedCollections = [...BACKUP_COLLECTIONS].sort();
    if (payloadCollections.length !== expectedCollections.length || payloadCollections.some((collection, index) => collection !== expectedCollections[index])) {
        throw new BackupArtifactError(
            'collection-mismatch',
            'Backup payload collections do not match the v1 schema.',
        );
    }
}

function assertCollectionCounts(payload: BackupDataset, recordCounts: Record<BackupCollectionName, number>): void {
    for (const collection of BACKUP_COLLECTIONS) {
        const actualCount = payload[collection]?.length ?? 0;
        if (actualCount !== recordCounts[collection]) {
            throw new BackupArtifactError(
                'count-mismatch',
                `Backup manifest count mismatch for ${collection}.`,
            );
        }
    }
}

function assertCollectionArrays(payload: BackupDataset): void {
    for (const collection of BACKUP_COLLECTIONS) {
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

function assertCollectionReferences(payload: BackupDataset): void {
    const ambulatoryIds = new Set(
        payload.ambulatories
            .map((item) => item.id)
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    );
    const patientIds = new Set(
        payload.patients
            .map((item) => item.id)
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    );
    const conversationIds = new Set(
        payload.conversations
            .map((item) => item.id)
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    );

    for (const patient of payload.patients) {
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

    const patientDependentCollections: BackupCollectionName[] = ['attachments', 'checkups', 'entries', 'observations', 'prostheticPrescriptions', 'servicePrescriptionItems', 'servicePrescriptions', 'sissHandoffs', 'therapies'];
    for (const collection of patientDependentCollections) {
        for (const item of payload[collection]) {
            if (typeof item.patientId !== 'string' || !patientIds.has(item.patientId)) {
                throw new BackupArtifactError(
                    'invalid-manifest',
                    `${collection} contains an unknown patient reference.`,
                );
            }
        }
    }

    for (const message of payload.messages) {
        if (typeof message.conversationId !== 'string' || !conversationIds.has(message.conversationId)) {
            throw new BackupArtifactError(
                'invalid-manifest',
                'messages contains an unknown conversation reference.',
            );
        }
    }
}

export async function createBackupArtifact(payload: BackupDataset, createdAt = new Date()): Promise<BackupArtifact> {
    assertCollectionSet(payload);
    assertCollectionReferences(payload);

    const recordCounts = createEmptyCounts();
    for (const collection of BACKUP_COLLECTIONS) {
        recordCounts[collection] = payload[collection].length;
    }

    const payloadSnapshot = normalizeJson(payload);
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
        payload,
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

    const artifact = value as Partial<BackupArtifact> & { manifest?: Partial<BackupArtifactManifest>; payload?: BackupDataset };

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

    assertCollectionSet(payload);
    assertCollectionArrays(payload);

    if (!Array.isArray(manifest.collections) || manifest.collections.length !== BACKUP_COLLECTIONS.length || manifest.collections.some((collection, index) => collection !== BACKUP_COLLECTIONS[index])) {
        throw new BackupArtifactError('collection-mismatch', 'Backup manifest collection list is invalid.');
    }

    if (!manifest.recordCounts || typeof manifest.recordCounts !== 'object') {
        throw new BackupArtifactError('invalid-manifest', 'Backup manifest counts are missing.');
    }

    assertCollectionCounts(payload, manifest.recordCounts as Record<BackupCollectionName, number>);
    assertCollectionReferences(payload);

    const createdAt = new Date(manifest.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
        throw new BackupArtifactError('invalid-manifest', 'Backup manifest createdAt is invalid.');
    }

    const checksum = await sha256Hex(stableStringify(normalizeJson(payload)));
    if (checksum !== manifest.checksum) {
        throw new BackupArtifactError('checksum-mismatch', 'Backup checksum does not match the payload.');
    }

    return {
        format: BACKUP_ARTIFACT_FORMAT,
        version: BACKUP_ARTIFACT_VERSION,
        manifest: {
            scope: BACKUP_ARTIFACT_SCOPE,
            createdAt: manifest.createdAt,
            checksumAlgorithm: 'sha256',
            checksum: manifest.checksum,
            collections: [...BACKUP_COLLECTIONS],
            recordCounts: manifest.recordCounts as Record<BackupCollectionName, number>,
        },
        payload,
    };
}
