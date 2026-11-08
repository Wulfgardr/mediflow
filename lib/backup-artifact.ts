import { validateAmbulatoryCommandRows } from './ambulatory-destructive-command-backup.ts';
import { validateTherapyStatusCommandRows } from './therapy-status-command-backup.ts';
import { types } from 'node:util';
import { backupAuditCoverage, canonicalizeBackupAuditRows, snapshotBackupAudit } from './backup-audit.ts';
import { assertExemptionImportReceiptRows } from './exemption-import-receipt.ts';
import { assertProstheticsCatalogBackup } from './reference-data/prosthetics-catalog-backup.ts';

export const BACKUP_ARTIFACT_FORMAT = 'mediflow-backup' as const;
export const BACKUP_ARTIFACT_VERSION = 1 as const;
export const BACKUP_ARTIFACT_SCOPE = 'mediflow-web-local-backup' as const;

export const BACKUP_COLLECTIONS = [
    'ambulatories',
    'attachments',
    'conversations',
    'documentDiagnosisProposals',
    'drugs',
    'entries',
    'exemptions',
    'exemptionImportReceipts',
    'prostheticsCatalogEntries',
    'prostheticsCatalogReceipts',
    'prostheticsCatalogSources',
    'prostheticsCatalogDocuments',
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
    'therapyStatusCommands',
    'ambulatoryDestructiveCommands',
    'auditEvents',
] as const;

export type BackupCollectionName = (typeof BACKUP_COLLECTIONS)[number];
export type BackupRecord = Record<string, unknown>;
type AdditiveBackupCollection = 'ambulatoryDestructiveCommands' | 'therapyStatusCommands' | 'prostheticsCatalogSources' | 'prostheticsCatalogDocuments' | 'auditEvents' | 'prostheticsCatalogEntries' | 'prostheticsCatalogReceipts' | 'exemptionImportReceipts';
export type BackupDataset = Record<Exclude<BackupCollectionName, AdditiveBackupCollection>, BackupRecord[]>
    & Partial<Record<AdditiveBackupCollection, BackupRecord[]>>;

/* Collections of the durable AI review and of the headless SOAP write, removed on
 * 2026-11-08. The product never wrote them, so an older artifact may carry them
 * only empty; a non-empty one is refused rather than silently dropped. */
const RETIRED_BACKUP_COLLECTIONS: ReadonlySet<string> = new Set([
    'durableReviewCommandStates', 'durableReviewCommandOperations', 'durableReviewPatientLinks',
    'durableReviewRecords', 'durableReviewOperations', 'headlessSoapActiveRoleAttestations', 'headlessSoapEntryCommits',
]);
/* Every v1 generation is the current set minus any of these groups: each group
 * arrived in one release, so an artifact has a group whole or not at all. */
const OPTIONAL_COLLECTION_GROUPS: readonly (readonly BackupCollectionName[])[] = [
    ['ambulatoryDestructiveCommands'],
    ['auditEvents'],
    ['documentDiagnosisProposals'],
    ['exemptionImportReceipts'],
    ['physicianReviewAttestations'],
    ['prostheticsCatalogSources', 'prostheticsCatalogDocuments'],
    ['prostheticsCatalogEntries', 'prostheticsCatalogReceipts'],
    ['therapyStatusCommands'],
];
const PRE_AUDIT_COLLECTIONS = BACKUP_COLLECTIONS.filter(collection => collection !== 'auditEvents');

function generationCollections(present: readonly string[]): readonly BackupCollectionName[] | null {
    const keys = new Set(present);
    let expected: readonly BackupCollectionName[] = BACKUP_COLLECTIONS;
    for (const group of OPTIONAL_COLLECTION_GROUPS) {
        const found = group.filter(collection => keys.has(collection)).length;
        if (found === 0) expected = expected.filter(collection => !group.includes(collection));
        else if (found !== group.length) return null;
    }
    return expected;
}

const PATIENT_DEPENDENT_COLLECTIONS: readonly BackupCollectionName[] = [
    'attachments',
    'checkups',
    'documentDiagnosisProposals',
    'entries',
    'observations',
    'prostheticPrescriptions',
    'servicePrescriptionItems',
    'servicePrescriptions',
    'sissHandoffs',
    'therapies',
];
const DOCUMENT_SOURCE_REF = /^[0-9a-f]{64}$/;
const PHYSICIAN_REVIEW_ATTESTATION_KEYS = ['actorRef', 'schemaVersion', 'capability', 'status', 'attestationVersion', 'policyVersion', 'revokedAt', 'createdAt', 'updatedAt'] as const;
const PHYSICIAN_REVIEW_ATTESTATION_SCHEMA = 'mediflow.physician-review-attestation.v1';
const PHYSICIAN_REVIEW_CAPABILITY = 'physician_terminal_review';
const PHYSICIAN_REVIEW_POLICY = 'physician_terminal_review.v1';
const BACKUP_ARTIFACT_ROOT_KEYS = ['format', 'version', 'manifest', 'payload'] as const;

export interface BackupArtifactManifest {
    scope: typeof BACKUP_ARTIFACT_SCOPE;
    createdAt: string;
    checksumAlgorithm: 'sha256';
    checksum: string;
    collections: readonly BackupCollectionName[];
    recordCounts: Record<Exclude<BackupCollectionName, 'auditEvents' | 'therapyStatusCommands' | 'ambulatoryDestructiveCommands'>, number>
        & Partial<Record<'auditEvents' | 'therapyStatusCommands' | 'ambulatoryDestructiveCommands', number>>;
}

export interface BackupArtifact {
    format: typeof BACKUP_ARTIFACT_FORMAT;
    version: typeof BACKUP_ARTIFACT_VERSION;
    manifest: BackupArtifactManifest;
    payload: BackupDataset;
}

const inputChecksums = new WeakMap<BackupArtifact, string>();

/** Original input payload checksum before additive normalization; no authentication claim. */
export function backupArtifactInputChecksum(artifact: BackupArtifact): string {
    return inputChecksums.get(artifact) ?? artifact.manifest.checksum;
}

export type BackupArtifactErrorCode =
    | 'backup-document-currentness-unsupported'
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

function createEmptyCounts(collections: readonly BackupCollectionName[] = BACKUP_COLLECTIONS): Record<BackupCollectionName, number> {
    return Object.fromEntries(collections.map((collection) => [collection, 0])) as Record<BackupCollectionName, number>;
}

export function createEmptyDataset(): BackupDataset {
    return Object.fromEntries(BACKUP_COLLECTIONS.map((collection) => [collection, []])) as unknown as BackupDataset;
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return false;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Reflect.ownKeys(value).length !== keys.length
            || !keys.every((key) => Object.hasOwn(descriptors, key) && 'value' in descriptors[key]! && descriptors[key]!.enumerable)) {
            return false;
        }
        return Object.getPrototypeOf(value) === Object.prototype;
    } catch {
        return false;
    }
}

/* Authority rows retain dates as Date objects before serialization and canonical ISO strings after parsing. */
function timestampMilliseconds(value: unknown): number | null {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value !== 'string') return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === value ? date.getTime() : null;
}

function assertPhysicianReviewAttestationRows(payload: Partial<Record<BackupCollectionName, BackupRecord[]>>): void {
    const actorRefs = new Set<string>();
    for (const attestation of payload.physicianReviewAttestations ?? []) {
        if (!hasExactKeys(attestation, PHYSICIAN_REVIEW_ATTESTATION_KEYS)) {
            throw new BackupArtifactError('invalid-manifest', 'physicianReviewAttestations contains an invalid authority record.');
        }
        const createdAt = timestampMilliseconds(attestation.createdAt);
        const updatedAt = timestampMilliseconds(attestation.updatedAt);
        const revokedAt = attestation.revokedAt === null ? null : timestampMilliseconds(attestation.revokedAt);
        const active = attestation.status === 'inactive' || attestation.status === 'active';
        const revoked = attestation.status === 'revoked';
        if (typeof attestation.actorRef !== 'string' || attestation.actorRef.trim() !== attestation.actorRef || attestation.actorRef.length === 0 || attestation.actorRef.length > 256 || actorRefs.has(attestation.actorRef)
            || attestation.schemaVersion !== PHYSICIAN_REVIEW_ATTESTATION_SCHEMA
            || attestation.capability !== PHYSICIAN_REVIEW_CAPABILITY
            || attestation.attestationVersion !== 1 || attestation.policyVersion !== PHYSICIAN_REVIEW_POLICY
            || (!active && !revoked) || (active && attestation.revokedAt !== null)
            || (revoked && revokedAt === null)
            || createdAt === null || updatedAt === null || updatedAt < createdAt
            || (revokedAt !== null && revokedAt < createdAt)) {
            throw new BackupArtifactError('invalid-manifest', 'physicianReviewAttestations contains an invalid authority record.');
        }
        actorRefs.add(attestation.actorRef);
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

function parseAssignedAmbulatoryIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    ));
}

function parseAssignedAmbulatoryMemberships(value: unknown): Array<{ ambulatoryId: string; assignedAt: unknown }> {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const membership = item as Record<string, unknown>;
        if (typeof membership.ambulatoryId !== 'string' || membership.ambulatoryId.trim().length === 0) return [];
        return [{ ambulatoryId: membership.ambulatoryId, assignedAt: membership.assignedAt }];
    });
}

/* Backups carry only already-host-minted attachment currentness; they never mint, default, or rebase it. */
function assertAttachmentCurrentnessRows(rows: readonly BackupRecord[]): void {
    const sourceRefs = new Set<string>();
    for (const row of rows) {
        try {
            if (!row || typeof row !== 'object' || Array.isArray(row) || types.isProxy(row) || Object.getPrototypeOf(row) !== Object.prototype) throw new Error();
            const descriptors = Object.getOwnPropertyDescriptors(row);
            const tuple = ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch'].map((key) => descriptors[key]);
            if (tuple.some((descriptor) => !descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))) throw new Error();
            const [sourceRef, revision, freshnessEpoch] = tuple.map((descriptor) => descriptor!.value);
            if (typeof sourceRef !== 'string' || !DOCUMENT_SOURCE_REF.test(sourceRef) || sourceRefs.has(sourceRef)
                || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1
                || typeof freshnessEpoch !== 'number' || !Number.isSafeInteger(freshnessEpoch) || freshnessEpoch < 1) throw new Error();
            sourceRefs.add(sourceRef);
        } catch {
            throw new BackupArtifactError('backup-document-currentness-unsupported', 'BACKUP_DOCUMENT_CURRENTNESS_UNSUPPORTED');
        }
    }
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

    assertAttachmentCurrentnessRows(payload.attachments ?? []);

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

    for (const message of payload.messages ?? []) {
        if (typeof message.conversationId !== 'string' || !conversationIds.has(message.conversationId)) {
            throw new BackupArtifactError(
                'invalid-manifest',
                'messages contains an unknown conversation reference.',
            );
        }
    }

    /* Reject unsupported or inconsistent exemption receipts before restore/export. */
    try { assertExemptionImportReceiptRows(payload.exemptionImportReceipts ?? []); }
    catch { throw new BackupArtifactError('invalid-manifest', 'Exemption import receipts are invalid or unsupported.'); }
    try { assertProstheticsCatalogBackup(payload.prostheticsCatalogEntries ?? [], payload.prostheticsCatalogReceipts ?? [], payload.prostheticsCatalogSources ?? [], payload.prostheticsCatalogDocuments ?? [], payload.prostheticPrescriptions ?? []); }
    catch { throw new BackupArtifactError('invalid-manifest', 'Prosthetics catalog or provenance is invalid or unsupported.'); }
    try { validateTherapyStatusCommandRows(payload.therapyStatusCommands ?? [], payload.auditEvents ?? []); }
    catch { throw new BackupArtifactError('invalid-manifest', 'Therapy status command ledger or audit is invalid.'); }
    try { validateAmbulatoryCommandRows(payload.ambulatoryDestructiveCommands ?? [], payload.auditEvents ?? []); }
    catch { throw new BackupArtifactError('invalid-manifest', 'Ambulatory command ledger or audit is invalid.'); }
    assertPhysicianReviewAttestationRows(payload);
    if (backupAuditCoverage(payload) === 'included') {
        try { canonicalizeBackupAuditRows(payload.auditEvents); }
        catch { throw new BackupArtifactError('invalid-manifest', 'Backup audit rows or identities are invalid.'); }
    }
}

export async function createBackupArtifact(payload: BackupDataset, createdAt = new Date()): Promise<BackupArtifact> {
    /* Existing v1 producers add the audit-dependent collections as empty until audit restore is separately contracted. */
    const currentPayload = { ...createEmptyDataset(), ...payload } as BackupDataset;
    const collections = backupAuditCoverage(payload) === 'included' ? BACKUP_COLLECTIONS : PRE_AUDIT_COLLECTIONS;
    if (backupAuditCoverage(payload) === 'omitted') delete currentPayload.auditEvents;
    else {
        try { currentPayload.auditEvents = currentPayload.auditEvents!.map(snapshotBackupAudit); }
        catch { throw new BackupArtifactError('invalid-manifest', 'Backup audit snapshot is invalid.'); }
    }
    assertCollectionSet(currentPayload as Record<string, unknown>, collections);
    await assertCollectionReferences(currentPayload);
    const canonicalPayload = {
        ...currentPayload,
        exemptionImportReceipts: [...(currentPayload.exemptionImportReceipts ?? [])].sort((a, b) => Number(a.id) - Number(b.id)),
        ambulatoryDestructiveCommands: validateAmbulatoryCommandRows(currentPayload.ambulatoryDestructiveCommands ?? [], currentPayload.auditEvents ?? []),
        therapyStatusCommands: validateTherapyStatusCommandRows(currentPayload.therapyStatusCommands ?? [], currentPayload.auditEvents ?? []),
        ...(backupAuditCoverage(currentPayload) === 'included'
            ? { auditEvents: canonicalizeBackupAuditRows(currentPayload.auditEvents) } : {}),
    } as BackupDataset;

    const recordCounts = createEmptyCounts(collections);
    for (const collection of collections) {
        recordCounts[collection] = canonicalPayload[collection]?.length ?? 0;
    }

    const payloadSnapshot = normalizeJson(canonicalPayload);
    const checksum = await sha256Hex(stableStringify(payloadSnapshot));

    return {
        format: BACKUP_ARTIFACT_FORMAT,
        version: BACKUP_ARTIFACT_VERSION,
        manifest: {
            scope: BACKUP_ARTIFACT_SCOPE,
            createdAt: createdAt.toISOString(),
            checksumAlgorithm: 'sha256',
            checksum,
            collections: [...collections],
            recordCounts,
        },
        payload: canonicalPayload,
    };
}

export async function serializeBackupArtifact(payload: BackupDataset, createdAt = new Date()): Promise<string> {
    const artifact = await createBackupArtifact(payload, createdAt);
    return JSON.stringify(normalizeJson(artifact), null, 2);
}

export async function parseBackupArtifact(value: unknown): Promise<BackupArtifact> {
    if (!value || typeof value !== 'object' || types.isProxy(value)) {
        throw new BackupArtifactError('invalid-json', 'Backup artifact must be a JSON object.');
    }
    if (!hasExactKeys(value, BACKUP_ARTIFACT_ROOT_KEYS)) {
        throw new BackupArtifactError('invalid-manifest', 'Backup artifact root is invalid.');
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

    const retiredCollections = Object.keys(payload).filter((collection) => RETIRED_BACKUP_COLLECTIONS.has(collection)).sort();
    for (const collection of retiredCollections) {
        if (!Array.isArray(payload[collection]) || payload[collection].length !== 0) {
            throw new BackupArtifactError('collection-mismatch', `Backup collection ${collection} belongs to a removed feature and must be empty.`);
        }
    }
    const currentPayload = Object.fromEntries(Object.entries(payload).filter(([collection]) => !RETIRED_BACKUP_COLLECTIONS.has(collection)));
    const expectedCollections = generationCollections(Object.keys(currentPayload)) ?? BACKUP_COLLECTIONS;
    const legacy = expectedCollections.length !== BACKUP_COLLECTIONS.length || retiredCollections.length > 0;
    const missingLegacyCollections = BACKUP_COLLECTIONS.filter((collection) => collection !== 'auditEvents' && !expectedCollections.includes(collection));
    const expectedPatientDependentCollections = PATIENT_DEPENDENT_COLLECTIONS.filter(
        (collection) => expectedCollections.includes(collection),
    );

    assertCollectionSet(currentPayload, expectedCollections);
    assertCollectionArrays(currentPayload, expectedCollections);

    const manifestCollections = Array.isArray(manifest.collections) ? manifest.collections : null;
    const listedCollections = manifestCollections?.filter((collection) => !RETIRED_BACKUP_COLLECTIONS.has(collection));
    const listedRetired = manifestCollections?.filter((collection) => RETIRED_BACKUP_COLLECTIONS.has(collection)).sort();
    if (!listedCollections || !listedRetired || listedCollections.length !== expectedCollections.length
        || listedCollections.some((collection, index) => collection !== expectedCollections[index])
        || listedRetired.join() !== retiredCollections.join()) {
        throw new BackupArtifactError('collection-mismatch', 'Backup manifest collection list is invalid.');
    }

    if (!manifest.recordCounts || typeof manifest.recordCounts !== 'object') {
        throw new BackupArtifactError('invalid-manifest', 'Backup manifest counts are missing.');
    }
    const recordCounts = Object.fromEntries(Object.entries(manifest.recordCounts as Record<string, unknown>)
        .filter(([collection]) => !RETIRED_BACKUP_COLLECTIONS.has(collection)));
    if (Object.keys(manifest.recordCounts).length - Object.keys(recordCounts).length !== retiredCollections.length
        || retiredCollections.some((collection) => (manifest.recordCounts as Record<string, unknown>)[collection] !== 0)) {
        throw new BackupArtifactError('collection-mismatch', 'Backup manifest record counts do not match the v1 schema.');
    }

    assertCollectionCounts(currentPayload, recordCounts, expectedCollections);
    await assertCollectionReferences(currentPayload as Partial<Record<BackupCollectionName, BackupRecord[]>>, expectedPatientDependentCollections);

    const createdAt = new Date(manifest.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
        throw new BackupArtifactError('invalid-manifest', 'Backup manifest createdAt is invalid.');
    }

    const checksum = await sha256Hex(stableStringify(normalizeJson(payload)));
    if (checksum !== manifest.checksum) {
        throw new BackupArtifactError('checksum-mismatch', 'Backup checksum does not match the payload.');
    }

    // Checksum verifies the original payload before normalization; it does not authenticate its source.
    const normalizedPayload = legacy
        ? { ...currentPayload, ...Object.fromEntries(missingLegacyCollections.map((collection) => [collection, []])) } as BackupDataset
        : payload as BackupDataset;
    const normalizedRecordCounts = legacy
        ? { ...recordCounts, ...Object.fromEntries(missingLegacyCollections.map((collection) => [collection, 0])) } as Record<BackupCollectionName, number>
        : manifest.recordCounts as Record<BackupCollectionName, number>;
    const normalizedChecksum = legacy
        ? await sha256Hex(stableStringify(normalizeJson(normalizedPayload)))
        : manifest.checksum;

    const normalized: BackupArtifact = {
        format: BACKUP_ARTIFACT_FORMAT,
        version: BACKUP_ARTIFACT_VERSION,
        manifest: {
            scope: BACKUP_ARTIFACT_SCOPE,
            createdAt: manifest.createdAt,
            checksumAlgorithm: 'sha256',
            checksum: normalizedChecksum,
            collections: [...(backupAuditCoverage(payload) === 'included' ? BACKUP_COLLECTIONS : PRE_AUDIT_COLLECTIONS)],
            recordCounts: normalizedRecordCounts,
        },
        payload: normalizedPayload,
    };
    inputChecksums.set(normalized, manifest.checksum);
    return normalized;
}
