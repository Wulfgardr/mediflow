import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BACKUP_ARTIFACT_FORMAT,
    BACKUP_ARTIFACT_VERSION,
    BACKUP_COLLECTIONS,
    BackupArtifactError,
    createBackupArtifact,
    parseBackupArtifact,
    serializeBackupArtifact,
    stableStringify,
} from './backup-artifact';

const basePayload = {
    ambulatories: [
        {
            id: 'amb-1',
            name: 'Ambulatorio principale',
            createdAt: '2026-03-17T08:00:00.000Z',
        },
    ],
    attachments: [],
    conversations: [
        {
            id: 'conv-1',
            title: 'Scambio clinico',
            createdAt: '2026-03-17T08:05:00.000Z',
        },
    ],
    documentDiagnosisProposals: [
        {
            id: 'proposal-1',
            patientId: 'pat-1',
            sourceDocumentKey: 'source-hmac-1',
            candidateKey: 'candidate-hmac-1',
            payload: 'ENC:iv:cipher',
            status: 'pending',
            confidence: 'high',
            version: 1,
            createdAt: '2026-03-17T08:07:00.000Z',
            updatedAt: '2026-03-17T08:07:00.000Z',
        },
    ],
    durableReviewRecords: [],
    durableReviewOperations: [],
    drugs: [],
    entries: [
        {
            id: 'entry-1',
            patientId: 'pat-1',
            type: 'note',
            date: '2026-03-17T08:10:00.000Z',
            content: 'Nota sintetica',
            createdAt: '2026-03-17T08:10:00.000Z',
        },
    ],
    exemptions: [],
    messages: [
        {
            id: 'msg-1',
            conversationId: 'conv-1',
            role: 'user',
            content: 'Domanda',
            createdAt: '2026-03-17T08:06:00.000Z',
        },
    ],
    observations: [],
    prostheticPrescriptions: [],
    serviceCatalogEntries: [],
    servicePrescriptionItems: [],
    servicePrescriptions: [],
    sissHandoffs: [],
    patients: [
        {
            id: 'pat-1',
            firstName: 'Mario',
            lastName: 'Rossi',
            taxCode: 'RSSMRA80A01H501U',
            address: 'ENC:iv:cipher',
            phone: 'ENC:iv:cipher',
            ambulatoryId: 'amb-1',
            assignedAmbulatoryIds: ['amb-1'],
            createdAt: '2026-03-17T08:00:00.000Z',
            updatedAt: '2026-03-17T08:00:00.000Z',
            version: 1,
        },
    ],
    checkups: [],
    therapies: [],
};

test('creates a stable backup artifact with checksum and manifest', async () => {
    const artifact = await createBackupArtifact(basePayload);

    assert.equal(artifact.format, BACKUP_ARTIFACT_FORMAT);
    assert.equal(artifact.version, BACKUP_ARTIFACT_VERSION);
    assert.equal(artifact.manifest.scope, 'mediflow-web-local-backup');
    assert.deepEqual(artifact.manifest.collections, BACKUP_COLLECTIONS);
    assert.equal(artifact.manifest.recordCounts.patients, 1);
    assert.equal(artifact.manifest.recordCounts.messages, 1);

    const serialized = await serializeBackupArtifact(basePayload);
    const parsed = await parseBackupArtifact(JSON.parse(serialized));

    assert.equal(parsed.manifest.checksum, artifact.manifest.checksum);
    assert.equal(stableStringify(parsed.payload), stableStringify(basePayload));
});

/* @Codex */
test('includes durable review records and replay operations in the authenticated artifact', async () => {
    const payload = {
        ...basePayload,
        durableReviewRecords: [],
        durableReviewOperations: [],
    };

    const artifact = await createBackupArtifact(payload);

    assert.deepEqual(artifact.manifest.collections, BACKUP_COLLECTIONS);
    assert.equal(artifact.manifest.recordCounts.durableReviewRecords, 0);
    assert.equal(artifact.manifest.recordCounts.durableReviewOperations, 0);
});

/* @Codex */
async function sha256(value: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/* @Codex */
async function durableReviewLedgerFixture() {
    const record = {
        id: `review_${'a'.repeat(32)}`,
        patientRef: `ptr_${'b'.repeat(32)}`,
        reviewId: `review_${'a'.repeat(32)}`,
        reviewRevision: 1,
        receiptRef: `receipt_${'c'.repeat(32)}`,
        provenanceRef: `provenance_${'d'.repeat(32)}`,
        receiptBinding: '',
        provenanceBinding: '',
        presentationVersion: 'mediflow.ai.durable-review.presentation.v1',
        sealedCiphertext: 'ENC:YWJj:c3ludGhldGljLWR1cmFibGUtcmV2aWV3',
        sealedDigest: '',
        createdAt: '2026-03-17T08:10:00.000Z',
    };
    record.receiptBinding = await sha256(`${record.patientRef}\0${record.reviewId}\0${record.receiptRef}`);
    record.provenanceBinding = await sha256(`${record.patientRef}\0${record.reviewId}\0${record.provenanceRef}`);
    record.sealedDigest = await sha256(record.sealedCiphertext);
    const snapshot = (({ id: _id, createdAt: _createdAt, ...value }) => value)(record);
    const idempotencyKey = 'idem_aaaaaaaaaaaaaaaa';
    const operation = {
        id: await sha256(`${record.reviewId}\0${idempotencyKey}`),
        reviewId: record.reviewId,
        idempotencyKey,
        operation: 'create',
        expectedReviewRevision: 0,
        operationDigest: await sha256(JSON.stringify(['create', 0, snapshot])),
        recordSnapshot: JSON.stringify(snapshot),
        createdAt: '2026-03-17T08:10:00.000Z',
    };
    return { record, operation };
}

/* @Codex */
async function checksumValidDurableArtifact(mutate: (artifact: any) => void | Promise<void>): Promise<Record<string, unknown>> {
    const { record, operation } = await durableReviewLedgerFixture();
    const artifact = JSON.parse(await serializeBackupArtifact({
        ...basePayload,
        durableReviewRecords: [record],
        durableReviewOperations: [operation],
    }));
    await mutate(artifact);
    artifact.manifest.checksum = await sha256(stableStringify(artifact.payload));
    return artifact;
}

test('rejects checksum-valid durable review records that violate canonical invariants', async () => {
    const artifact = await checksumValidDurableArtifact((value) => {
        value.payload.durableReviewRecords[0].id = `review_${'f'.repeat(32)}`;
    });

    await assert.rejects(
        () => parseBackupArtifact(artifact),
        (error: unknown) => error instanceof BackupArtifactError && error.code === 'invalid-manifest',
    );
});

test('rejects checksum-valid durable operations with a mismatched operation identity', async () => {
    const artifact = await checksumValidDurableArtifact((value) => {
        value.payload.durableReviewOperations[0].id = 'not-the-canonical-operation-id';
    });

    await assert.rejects(
        () => parseBackupArtifact(artifact),
        (error: unknown) => error instanceof BackupArtifactError && error.code === 'invalid-manifest',
    );
});

test('rejects checksum-valid orphan durable operations', async () => {
    const artifact = await checksumValidDurableArtifact((value) => {
        value.payload.durableReviewOperations[0].reviewId = `review_${'f'.repeat(32)}`;
    });

    await assert.rejects(
        () => parseBackupArtifact(artifact),
        (error: unknown) => error instanceof BackupArtifactError && error.code === 'invalid-manifest',
    );
});

test('rejects checksum-valid durable operations with an altered replay snapshot', async () => {
    const artifact = await checksumValidDurableArtifact(async (value) => {
        const snapshot = JSON.parse(value.payload.durableReviewOperations[0].recordSnapshot);
        snapshot.sealedCiphertext = 'ENC:YWJj:YWx0ZXJlZC1yZXBsYXk=';
        snapshot.sealedDigest = await sha256(snapshot.sealedCiphertext);
        value.payload.durableReviewOperations[0].recordSnapshot = JSON.stringify(snapshot);
    });

    await assert.rejects(
        () => parseBackupArtifact(artifact),
        (error: unknown) => error instanceof BackupArtifactError && error.code === 'invalid-manifest',
    );
});

test('rejects checksum-valid durable operations with noncanonical snapshot encoding', async () => {
    const artifact = await checksumValidDurableArtifact((value) => {
        value.payload.durableReviewOperations[0].recordSnapshot = JSON.stringify(
            JSON.parse(value.payload.durableReviewOperations[0].recordSnapshot),
            null,
            2,
        );
    });

    await assert.rejects(
        () => parseBackupArtifact(artifact),
        (error: unknown) => error instanceof BackupArtifactError && error.code === 'invalid-manifest',
    );
});

test('rejects tampered payloads before restore', async () => {
    const serialized = await serializeBackupArtifact(basePayload);
    const tampered = JSON.parse(serialized);
    tampered.payload.patients[0].firstName = 'Luigi';

    await assert.rejects(
        () => parseBackupArtifact(tampered),
        (error: unknown) => error instanceof BackupArtifactError && error.code === 'checksum-mismatch',
    );
});

test('preserves patient assigned ambulatory ids inside the backup payload', async () => {
    const serialized = await serializeBackupArtifact({
        ...basePayload,
        patients: [{
            ...basePayload.patients[0],
            assignedAmbulatoryIds: ['amb-2', 'amb-1', 'amb-2'],
        }],
        ambulatories: [
            ...basePayload.ambulatories,
            {
                id: 'amb-2',
                name: 'Ambulatorio secondario',
                createdAt: '2026-03-17T08:01:00.000Z',
            },
        ],
    });

    const parsed = await parseBackupArtifact(JSON.parse(serialized));
    assert.deepEqual(parsed.payload.patients[0].assignedAmbulatoryIds, ['amb-2', 'amb-1', 'amb-2']);
});

/* @Codex */
async function legacyArtifact(): Promise<Record<string, any>> {
    const artifact = JSON.parse(await serializeBackupArtifact(basePayload));
    delete artifact.payload.documentDiagnosisProposals;
    delete artifact.payload.durableReviewRecords;
    delete artifact.payload.durableReviewOperations;
    artifact.manifest.collections = artifact.manifest.collections.filter((collection: string) => collection !== 'documentDiagnosisProposals');
    artifact.manifest.collections = artifact.manifest.collections.filter((collection: string) => collection !== 'durableReviewRecords' && collection !== 'durableReviewOperations');
    delete artifact.manifest.recordCounts.documentDiagnosisProposals;
    delete artifact.manifest.recordCounts.durableReviewRecords;
    delete artifact.manifest.recordCounts.durableReviewOperations;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(artifact.payload)));
    artifact.manifest.checksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return artifact;
}

test('accepts an authentic legacy v1 artifact and normalizes missing optional collections', async () => {
    const parsed = await parseBackupArtifact(await legacyArtifact());
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(parsed.payload)));
    const normalizedChecksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');

    assert.deepEqual(parsed.payload.documentDiagnosisProposals, []);
    assert.deepEqual(parsed.payload.durableReviewRecords, []);
    assert.deepEqual(parsed.payload.durableReviewOperations, []);
    assert.equal(parsed.manifest.recordCounts.documentDiagnosisProposals, 0);
    assert.equal(parsed.manifest.recordCounts.durableReviewRecords, 0);
    assert.equal(parsed.manifest.recordCounts.durableReviewOperations, 0);
    assert.deepEqual(parsed.manifest.collections, BACKUP_COLLECTIONS);
    assert.equal(parsed.manifest.checksum, normalizedChecksum);
});

/* @Codex */
test('accepts a legacy artifact without durable review collections', async () => {
    const artifact = JSON.parse(await serializeBackupArtifact(basePayload));
    delete artifact.payload.durableReviewRecords;
    delete artifact.payload.durableReviewOperations;
    artifact.manifest.collections = artifact.manifest.collections.filter((collection: string) => collection !== 'durableReviewRecords' && collection !== 'durableReviewOperations');
    delete artifact.manifest.recordCounts.durableReviewRecords;
    delete artifact.manifest.recordCounts.durableReviewOperations;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(artifact.payload)));
    artifact.manifest.checksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');

    const parsed = await parseBackupArtifact(artifact);

    assert.deepEqual(parsed.payload.documentDiagnosisProposals, basePayload.documentDiagnosisProposals);
    assert.deepEqual(parsed.payload.durableReviewRecords, []);
    assert.deepEqual(parsed.payload.durableReviewOperations, []);
});

test('rejects almost-legacy and unknown backup collections', async () => {
    const missingHistorical = await legacyArtifact();
    delete missingHistorical.payload.therapies;
    missingHistorical.manifest.collections = missingHistorical.manifest.collections.filter((collection: string) => collection !== 'therapies');
    delete missingHistorical.manifest.recordCounts.therapies;

    await assert.rejects(
        () => parseBackupArtifact(missingHistorical),
        (error: unknown) => error instanceof BackupArtifactError && error.code === 'collection-mismatch',
    );

    const unknownCollection = JSON.parse(await serializeBackupArtifact(basePayload));
    unknownCollection.payload.unexpected = [];
    unknownCollection.manifest.collections.push('unexpected');
    unknownCollection.manifest.recordCounts.unexpected = 0;

    await assert.rejects(
        () => parseBackupArtifact(unknownCollection),
        (error: unknown) => error instanceof BackupArtifactError && error.code === 'collection-mismatch',
    );
});

test('rejects patient assigned ambulatory ids that reference missing ambulatories', async () => {
    const serialized = await serializeBackupArtifact(basePayload);
    const tampered = JSON.parse(serialized);
    tampered.payload.patients[0].assignedAmbulatoryIds = ['amb-missing'];

    await assert.rejects(
        () => parseBackupArtifact(tampered),
        (error: unknown) => error instanceof BackupArtifactError && error.code === 'invalid-manifest',
    );
});
