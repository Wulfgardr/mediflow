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

const SOAP_ATTESTATION_A = `hsar_${'a'.repeat(32)}`;
const SOAP_ATTESTATION_C = `hsar_${'c'.repeat(32)}`;
const SOAP_ATTESTATION_F = `hsar_${'f'.repeat(32)}`;

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
    durableReviewCommandStates: [],
    durableReviewCommandOperations: [],
    durableReviewPatientLinks: [],
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
    physicianReviewAttestations: [],
    headlessSoapActiveRoleAttestations: [],
    checkups: [],
    therapies: [],
};

function attachmentCurrentness(overrides: Record<string, unknown> = {}) {
    return {
        id: 'attachment-currentness-1', patientId: 'pat-1',
        documentSourceRef: 'a'.repeat(64), documentRevision: 1, documentFreshnessEpoch: 1,
        ...overrides,
    };
}

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

test('requires an exact host-minted attachment currentness tuple on export and parse', async () => {
    const valid = { ...basePayload, attachments: [attachmentCurrentness()] };
    const parsed = await parseBackupArtifact(JSON.parse(await serializeBackupArtifact(valid)));
    assert.deepEqual(parsed.payload.attachments[0], attachmentCurrentness());

    for (const overrides of [
        { documentSourceRef: 'A'.repeat(64) }, { documentSourceRef: 'a'.repeat(63) },
        { documentRevision: 0 }, { documentFreshnessEpoch: 0 }, { documentRevision: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
        await assert.rejects(() => createBackupArtifact({ ...basePayload, attachments: [attachmentCurrentness(overrides)] }),
            (error: unknown) => error instanceof BackupArtifactError && error.code === 'backup-document-currentness-unsupported' && error.message === 'BACKUP_DOCUMENT_CURRENTNESS_UNSUPPORTED');
    }
    await assert.rejects(() => createBackupArtifact({ ...basePayload, attachments: [attachmentCurrentness(), attachmentCurrentness({ id: 'attachment-currentness-2' })] }),
        (error: unknown) => error instanceof BackupArtifactError && error.code === 'backup-document-currentness-unsupported');
});

test('rejects proxy and accessor attachment tuples without reading them', async () => {
    let reads = 0; let traps = 0;
    const accessor = attachmentCurrentness();
    Object.defineProperty(accessor, 'documentSourceRef', { enumerable: true, get() { reads += 1; return 'a'.repeat(64); } });
    const proxy = new Proxy(attachmentCurrentness(), { get() { traps += 1; throw new Error('synthetic trap'); } });
    for (const attachment of [accessor, proxy]) {
        await assert.rejects(() => createBackupArtifact({ ...basePayload, attachments: [attachment] }),
            (error: unknown) => error instanceof BackupArtifactError && error.code === 'backup-document-currentness-unsupported' && error.message === 'BACKUP_DOCUMENT_CURRENTNESS_UNSUPPORTED');
    }
    assert.equal(reads, 0); assert.equal(traps, 0);
});

/* @Codex */
test('includes durable review records and replay operations in the authenticated artifact', async () => {
    const payload = {
        ...basePayload,
        durableReviewRecords: [],
        durableReviewOperations: [],
        durableReviewCommandStates: [],
        durableReviewCommandOperations: [],
        durableReviewPatientLinks: [],
        physicianReviewAttestations: [],
    };

    const artifact = await createBackupArtifact(payload);

    assert.deepEqual(artifact.manifest.collections, BACKUP_COLLECTIONS);
    assert.equal(artifact.manifest.recordCounts.durableReviewRecords, 0);
    assert.equal(artifact.manifest.recordCounts.durableReviewOperations, 0);
    assert.equal(artifact.manifest.recordCounts.durableReviewCommandStates, 0);
    assert.equal(artifact.manifest.recordCounts.durableReviewCommandOperations, 0);
    assert.equal(artifact.manifest.recordCounts.durableReviewPatientLinks, 0);
    assert.equal(artifact.manifest.recordCounts.physicianReviewAttestations, 0);
    assert.equal(artifact.manifest.recordCounts.headlessSoapActiveRoleAttestations, 0);
});

/* @Codex */
test('rejects command state without the append-only audit ledger needed for replay', async () => {
    await assert.rejects(
        createBackupArtifact({
            ...basePayload,
            durableReviewCommandStates: [{ reviewId: `review_${'a'.repeat(32)}`, reviewState: 'accepted', revision: 2, action: 'accept' }],
        }),
        (error: unknown) => error instanceof BackupArtifactError && error.code === 'invalid-manifest',
    );
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
    for (const collection of artifact.manifest.collections) {
        artifact.manifest.recordCounts[collection] = artifact.payload[collection].length;
    }
    artifact.manifest.checksum = await sha256(stableStringify(artifact.payload));
    return artifact;
}

/* @Codex */
async function checksumValidAuthorityArtifact(mutate: (artifact: any) => void | Promise<void>): Promise<Record<string, unknown>> {
    const { record, operation } = await durableReviewLedgerFixture();
    const artifact = JSON.parse(await serializeBackupArtifact({
        ...basePayload,
        durableReviewRecords: [record],
        durableReviewOperations: [operation],
        durableReviewPatientLinks: [{
            reviewId: record.reviewId,
            patientId: 'pat-1',
            createdAt: '2026-03-17T08:10:00.000Z',
            updatedAt: '2026-03-17T08:10:00.000Z',
        }],
        physicianReviewAttestations: [{
            actorRef: 'actor-synthetic',
            schemaVersion: 'mediflow.physician-review-attestation.v1',
            capability: 'physician_terminal_review',
            status: 'active',
            attestationVersion: 1,
            policyVersion: 'physician_terminal_review.v1',
            revokedAt: null,
            createdAt: '2026-03-17T08:10:00.000Z',
            updatedAt: '2026-03-17T08:10:00.000Z',
        }],
    }));
    await mutate(artifact);
    for (const collection of artifact.manifest.collections) {
        artifact.manifest.recordCounts[collection] = artifact.payload[collection].length;
    }
    artifact.manifest.checksum = await sha256(stableStringify(artifact.payload));
    return artifact;
}

/* @Codex */
async function checksumValidHeadlessSoapAttestationArtifact(mutate: (artifact: any) => void | Promise<void>): Promise<Record<string, unknown>> {
    const artifact = JSON.parse(await serializeBackupArtifact({
        ...basePayload,
        headlessSoapActiveRoleAttestations: [{
            attestationRef: SOAP_ATTESTATION_C,
            actorRef: 'actor-soap-synthetic',
            schemaVersion: 'mediflow.headless-soap-active-role-attestation.v1',
            role: 'physician',
            operationId: 'mediflow.clinical_diary.append_soap.v1',
            policyVersion: 'clinician_confirmed_single_use.v1',
            status: 'active',
            attestationVersion: 1,
            issuerRef: 'issuer-synthetic',
            expiresAt: '2026-03-17T09:10:00.000Z',
            activatedAt: '2026-03-17T08:10:00.000Z',
            revocationGeneration: 0,
            revokedAt: null,
            createdAt: '2026-03-17T08:00:00.000Z',
            updatedAt: '2026-03-17T08:10:00.000Z',
        }],
    }));
    await mutate(artifact);
    for (const collection of artifact.manifest.collections) {
        artifact.manifest.recordCounts[collection] = artifact.payload[collection].length;
    }
    artifact.manifest.checksum = await sha256(stableStringify(artifact.payload));
    return artifact;
}

test('accepts only exact lifecycle-bound headless SOAP active-role attestation rows', async () => {
    const artifact = await checksumValidHeadlessSoapAttestationArtifact(() => {});
    const parsed = await parseBackupArtifact(artifact);

    assert.equal(parsed.payload.headlessSoapActiveRoleAttestations.length, 1);
    assert.equal(parsed.payload.headlessSoapActiveRoleAttestations[0].operationId, 'mediflow.clinical_diary.append_soap.v1');
});

test('uses whole-second non-negative canonical timestamps and a stable H2 attestation order', async () => {
    const source = JSON.parse(await serializeBackupArtifact({
        ...basePayload,
        headlessSoapActiveRoleAttestations: [{
            attestationRef: SOAP_ATTESTATION_F, actorRef: 'actor-z', schemaVersion: 'mediflow.headless-soap-active-role-attestation.v1',
            role: 'physician', operationId: 'mediflow.clinical_diary.append_soap.v1', policyVersion: 'clinician_confirmed_single_use.v1',
            status: 'active', attestationVersion: 1, issuerRef: 'issuer-z', expiresAt: '2026-03-17T09:00:00.000Z', activatedAt: '2026-03-17T08:00:00.000Z', revocationGeneration: 0, revokedAt: null, createdAt: '2026-03-17T08:00:00.000Z', updatedAt: '2026-03-17T08:00:00.000Z',
        }, {
            attestationRef: SOAP_ATTESTATION_A, actorRef: 'actor-a', schemaVersion: 'mediflow.headless-soap-active-role-attestation.v1',
            role: 'physician', operationId: 'mediflow.clinical_diary.append_soap.v1', policyVersion: 'clinician_confirmed_single_use.v1',
            status: 'active', attestationVersion: 1, issuerRef: 'issuer-a', expiresAt: '2026-03-17T09:00:00.000Z', activatedAt: '2026-03-17T08:00:00.000Z', revocationGeneration: 0, revokedAt: null, createdAt: '2026-03-17T08:00:00.000Z', updatedAt: '2026-03-17T08:00:00.000Z',
        }],
    }));
    const rows = source.payload.headlessSoapActiveRoleAttestations;
    const forward = await createBackupArtifact({ ...basePayload, headlessSoapActiveRoleAttestations: rows });
    const reverse = await createBackupArtifact({ ...basePayload, headlessSoapActiveRoleAttestations: [...rows].reverse() });
    assert.deepEqual(forward.payload.headlessSoapActiveRoleAttestations.map((row) => row.attestationRef), [SOAP_ATTESTATION_A, SOAP_ATTESTATION_F]);
    assert.equal(forward.manifest.checksum, reverse.manifest.checksum);

    for (const timestamp of ['1969-12-31T23:59:59.000Z', '2026-03-17T08:00:00.001Z']) {
        const artifact = await checksumValidHeadlessSoapAttestationArtifact((value) => { value.payload.headlessSoapActiveRoleAttestations[0].createdAt = timestamp; });
        await assert.rejects(() => parseBackupArtifact(artifact), (error: unknown) => error instanceof BackupArtifactError && error.code === 'invalid-manifest');
    }
    const dateArtifact = await checksumValidHeadlessSoapAttestationArtifact((value) => { value.payload.headlessSoapActiveRoleAttestations[0].createdAt = new Date('2026-03-17T08:00:00.000Z'); });
    await assert.rejects(() => parseBackupArtifact(dateArtifact), (error: unknown) => error instanceof BackupArtifactError && error.code === 'invalid-manifest');
});

test('rejects Proxy backup roots before reflection with one sanitized error', async () => {
    let transparentTraps = 0;
    const transparent = new Proxy({ format: BACKUP_ARTIFACT_FORMAT }, {
        get: (target, key, receiver) => { transparentTraps += 1; return Reflect.get(target, key, receiver); },
        getPrototypeOf: (target) => { transparentTraps += 1; return Reflect.getPrototypeOf(target); },
        ownKeys: (target) => { transparentTraps += 1; return Reflect.ownKeys(target); },
    });
    let throwingTraps = 0;
    const throwing = new Proxy({}, { get: () => { throwingTraps += 1; throw new Error('private root detail'); } });
    for (const root of [transparent, throwing]) {
        await assert.rejects(
            () => parseBackupArtifact(root),
            (error: unknown) => error instanceof BackupArtifactError && error.code === 'invalid-json' && error.message === 'Backup artifact must be a JSON object.',
        );
    }
    assert.equal(transparentTraps, 0);
    assert.equal(throwingTraps, 0);
});

test('accepts only an exact own data-only canonical backup root', async () => {
    const valid = JSON.parse(await serializeBackupArtifact(basePayload));
    let inheritedReads = 0;
    const inherited = Object.create({ get format() { inheritedReads += 1; return BACKUP_ARTIFACT_FORMAT; } });
    Object.assign(inherited, (({ format: _format, ...rest }) => rest)(valid));
    let accessorReads = 0;
    const accessor = { ...valid };
    Object.defineProperty(accessor, 'format', { enumerable: true, get: () => { accessorReads += 1; return BACKUP_ARTIFACT_FORMAT; } });
    const nonEnumerable = { ...valid };
    Object.defineProperty(nonEnumerable, 'format', { enumerable: false, value: BACKUP_ARTIFACT_FORMAT });
    const symbol = { ...valid, [Symbol('unexpected')]: true };
    const thenable = { ...valid, then: () => undefined };
    const customPrototype = Object.assign(Object.create({}), valid);
    const nullPrototype = Object.assign(Object.create(null), valid);
    for (const root of [inherited, accessor, nonEnumerable, symbol, thenable, customPrototype, nullPrototype]) {
        await assert.rejects(
            () => parseBackupArtifact(root),
            (error: unknown) => error instanceof BackupArtifactError && error.code === 'invalid-manifest' && error.message === 'Backup artifact root is invalid.',
        );
    }
    assert.equal(inheritedReads, 0);
    assert.equal(accessorReads, 0);
});

test('rejects malformed, duplicated, and lifecycle-invalid headless SOAP active-role attestations', async () => {
    const mutations: Array<(artifact: any) => void> = [
        (artifact) => { artifact.payload.headlessSoapActiveRoleAttestations[0].extra = true; },
        (artifact) => { artifact.payload.headlessSoapActiveRoleAttestations[0].attestationRef = 'caller-supplied-ref'; },
        (artifact) => { artifact.payload.headlessSoapActiveRoleAttestations[0].role = 'admin'; },
        (artifact) => { artifact.payload.headlessSoapActiveRoleAttestations[0].operationId = 'other'; },
        (artifact) => { artifact.payload.headlessSoapActiveRoleAttestations[0].policyVersion = 'other.v1'; },
        (artifact) => { artifact.payload.headlessSoapActiveRoleAttestations[0].issuerRef = null; },
        (artifact) => { artifact.payload.headlessSoapActiveRoleAttestations[0].revocationGeneration = 1; },
        (artifact) => { artifact.payload.headlessSoapActiveRoleAttestations[0].activatedAt = '2026-03-17T09:11:00.000Z'; },
        (artifact) => { artifact.payload.headlessSoapActiveRoleAttestations[0].revokedAt = '2026-03-17T08:10:00.000Z'; },
        (artifact) => { artifact.payload.headlessSoapActiveRoleAttestations[0].status = 'revoked'; artifact.payload.headlessSoapActiveRoleAttestations[0].revokedAt = '2026-03-17T08:09:00.000Z'; artifact.payload.headlessSoapActiveRoleAttestations[0].revocationGeneration = 1; },
        (artifact) => { artifact.payload.headlessSoapActiveRoleAttestations.push({ ...artifact.payload.headlessSoapActiveRoleAttestations[0] }); },
    ];
    for (const mutate of mutations) {
        const artifact = await checksumValidHeadlessSoapAttestationArtifact(mutate);
        await assert.rejects(
            () => parseBackupArtifact(artifact),
            (error: unknown) => error instanceof BackupArtifactError && error.code === 'invalid-manifest',
        );
    }
});

test('rejects hostile headless SOAP active-role attestation rows before getters or proxy traps', async () => {
    const row = (await parseBackupArtifact(await checksumValidHeadlessSoapAttestationArtifact(() => {}))).payload.headlessSoapActiveRoleAttestations[0];
    let accessorReads = 0;
    const accessor = { ...row };
    Object.defineProperty(accessor, 'actorRef', { enumerable: true, get: () => { accessorReads += 1; return row.actorRef; } });
    let proxyTraps = 0;
    const proxy = new Proxy(row, {
        get: (target, key, receiver) => { proxyTraps += 1; return Reflect.get(target, key, receiver); },
        getOwnPropertyDescriptor: (target, key) => { proxyTraps += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
        getPrototypeOf: (target) => { proxyTraps += 1; return Reflect.getPrototypeOf(target); },
        ownKeys: (target) => { proxyTraps += 1; return Reflect.ownKeys(target); },
    });
    for (const hostile of [accessor, proxy]) {
        await assert.rejects(
            () => createBackupArtifact({ ...basePayload, headlessSoapActiveRoleAttestations: [hostile] }),
            (error: unknown) => error instanceof BackupArtifactError && error.code === 'invalid-manifest',
        );
    }
    assert.equal(accessorReads, 0);
    assert.equal(proxyTraps, 0);
});

test('rejects a durable review patient link that does not resolve within the artifact', async () => {
    const { record, operation } = await durableReviewLedgerFixture();
    const artifact = JSON.parse(await serializeBackupArtifact({
        ...basePayload,
        durableReviewRecords: [record],
        durableReviewOperations: [operation],
        durableReviewPatientLinks: [{
            reviewId: record.reviewId,
            patientId: 'pat-1',
            createdAt: '2026-03-17T08:10:00.000Z',
            updatedAt: '2026-03-17T08:10:00.000Z',
        }],
    }));
    artifact.payload.durableReviewPatientLinks[0].reviewId = `review_${'f'.repeat(32)}`;
    artifact.manifest.checksum = await sha256(stableStringify(artifact.payload));

    await assert.rejects(
        () => parseBackupArtifact(artifact),
        (error: unknown) => error instanceof BackupArtifactError && error.code === 'invalid-manifest',
    );
});

test('rejects checksum-valid malformed durable review authority rows before restore', async () => {
    const mutations: Array<(artifact: any) => void> = [
        (artifact) => { artifact.payload.durableReviewPatientLinks[0].extra = true; },
        (artifact) => { artifact.payload.physicianReviewAttestations[0].extra = true; },
        (artifact) => { artifact.payload.durableReviewPatientLinks[0].reviewId = 'review_not-canonical'; },
        (artifact) => { artifact.payload.durableReviewPatientLinks[0].updatedAt = '2026-03-17T08:09:59.000Z'; },
        (artifact) => { artifact.payload.durableReviewPatientLinks[0].createdAt = 'not-a-timestamp'; },
        (artifact) => { artifact.payload.durableReviewPatientLinks.push({ ...artifact.payload.durableReviewPatientLinks[0] }); },
        (artifact) => { artifact.payload.physicianReviewAttestations[0].schemaVersion = 'unexpected.v1'; },
        (artifact) => { artifact.payload.physicianReviewAttestations[0].capability = 'unexpected'; },
        (artifact) => { artifact.payload.physicianReviewAttestations[0].attestationVersion = 2; },
        (artifact) => { artifact.payload.physicianReviewAttestations[0].policyVersion = 'unexpected.v1'; },
        (artifact) => { artifact.payload.physicianReviewAttestations[0].status = 'unexpected'; },
        (artifact) => { artifact.payload.physicianReviewAttestations[0].actorRef = ' actor-synthetic'; },
        (artifact) => { artifact.payload.physicianReviewAttestations[0].updatedAt = '2026-03-17T08:09:59.000Z'; },
        (artifact) => { artifact.payload.physicianReviewAttestations[0].createdAt = 'not-a-timestamp'; },
        (artifact) => { artifact.payload.physicianReviewAttestations[0].revokedAt = '2026-03-17T08:10:00.000Z'; },
        (artifact) => { artifact.payload.physicianReviewAttestations[0].status = 'revoked'; },
        (artifact) => { artifact.payload.physicianReviewAttestations[0].status = 'revoked'; artifact.payload.physicianReviewAttestations[0].revokedAt = '2026-03-17T08:09:59.000Z'; },
        (artifact) => { artifact.payload.physicianReviewAttestations.push({ ...artifact.payload.physicianReviewAttestations[0] }); },
    ];

    for (const mutate of mutations) {
        const artifact = await checksumValidAuthorityArtifact(mutate);
        await assert.rejects(
            () => parseBackupArtifact(artifact),
            (error: unknown) => error instanceof BackupArtifactError && error.code === 'invalid-manifest',
        );
    }
});

/* @Codex */
test('rejects hostile durable review authority rows without invoking accessors or proxy traps', async () => {
    const authorityRow = {
        actorRef: 'actor-synthetic',
        schemaVersion: 'mediflow.physician-review-attestation.v1',
        capability: 'physician_terminal_review',
        status: 'active',
        attestationVersion: 1,
        policyVersion: 'physician_terminal_review.v1',
        revokedAt: null,
        createdAt: '2026-03-17T08:10:00.000Z',
        updatedAt: '2026-03-17T08:10:00.000Z',
    };
    let accessorReads = 0;
    const accessorRow = { ...authorityRow };
    Object.defineProperty(accessorRow, 'actorRef', {
        enumerable: true,
        get: () => {
            accessorReads += 1;
            return authorityRow.actorRef;
        },
    });
    let transparentProxyTraps = 0;
    const transparentProxy = new Proxy(authorityRow, {
        get: (target, key, receiver) => { transparentProxyTraps += 1; return Reflect.get(target, key, receiver); },
        getPrototypeOf: (target) => { transparentProxyTraps += 1; return Reflect.getPrototypeOf(target); },
        getOwnPropertyDescriptor: (target, key) => { transparentProxyTraps += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
        ownKeys: (target) => { transparentProxyTraps += 1; return Reflect.ownKeys(target); },
    });
    let throwingProxyTraps = 0;
    const throwingProxy = new Proxy(authorityRow, {
        get: () => { throwingProxyTraps += 1; throw new Error('proxy read'); },
        getPrototypeOf: () => { throwingProxyTraps += 1; throw new Error('proxy reflection'); },
        getOwnPropertyDescriptor: () => { throwingProxyTraps += 1; throw new Error('proxy descriptor'); },
        ownKeys: () => { throwingProxyTraps += 1; throw new Error('proxy keys'); },
    });

    for (const row of [accessorRow, transparentProxy, throwingProxy]) {
        await assert.rejects(
            () => createBackupArtifact({ ...basePayload, physicianReviewAttestations: [row] }),
            (error: unknown) => error instanceof BackupArtifactError && error.code === 'invalid-manifest',
        );
    }

    assert.equal(accessorReads, 0);
    assert.equal(transparentProxyTraps, 0);
    assert.equal(throwingProxyTraps, 0);
});

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

test('rejects checksum-valid replace snapshots that change patientRef', async () => {
    const artifact = await checksumValidDurableArtifact(async (value) => {
        const first = JSON.parse(value.payload.durableReviewOperations[0].recordSnapshot);
        const second = { ...first, patientRef: `ptr_${'e'.repeat(32)}`, reviewRevision: 2 };
        second.receiptBinding = await sha256(`${second.patientRef}\0${second.reviewId}\0${second.receiptRef}`);
        second.provenanceBinding = await sha256(`${second.patientRef}\0${second.reviewId}\0${second.provenanceRef}`);
        value.payload.durableReviewRecords[0] = { ...value.payload.durableReviewRecords[0], ...second };
        const idempotencyKey = 'idem_bbbbbbbbbbbbbbbb';
        value.payload.durableReviewOperations.push({
            id: await sha256(`${second.reviewId}\0${idempotencyKey}`),
            reviewId: second.reviewId,
            idempotencyKey,
            operation: 'replace',
            expectedReviewRevision: 1,
            operationDigest: await sha256(JSON.stringify(['replace', 1, second])),
            recordSnapshot: JSON.stringify(second),
            createdAt: '2026-03-17T08:11:00.000Z',
        });
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
    delete artifact.payload.durableReviewCommandStates;
    delete artifact.payload.durableReviewCommandOperations;
    delete artifact.payload.durableReviewPatientLinks;
    delete artifact.payload.physicianReviewAttestations;
    delete artifact.payload.headlessSoapActiveRoleAttestations;
    artifact.manifest.collections = artifact.manifest.collections.filter((collection: string) => collection !== 'documentDiagnosisProposals');
    artifact.manifest.collections = artifact.manifest.collections.filter((collection: string) => collection !== 'durableReviewRecords' && collection !== 'durableReviewOperations' && collection !== 'durableReviewCommandStates' && collection !== 'durableReviewCommandOperations');
    artifact.manifest.collections = artifact.manifest.collections.filter((collection: string) => collection !== 'durableReviewPatientLinks' && collection !== 'physicianReviewAttestations');
    artifact.manifest.collections = artifact.manifest.collections.filter((collection: string) => collection !== 'headlessSoapActiveRoleAttestations');
    delete artifact.manifest.recordCounts.documentDiagnosisProposals;
    delete artifact.manifest.recordCounts.durableReviewRecords;
    delete artifact.manifest.recordCounts.durableReviewOperations;
    delete artifact.manifest.recordCounts.durableReviewCommandStates;
    delete artifact.manifest.recordCounts.durableReviewCommandOperations;
    delete artifact.manifest.recordCounts.durableReviewPatientLinks;
    delete artifact.manifest.recordCounts.physicianReviewAttestations;
    delete artifact.manifest.recordCounts.headlessSoapActiveRoleAttestations;
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
    assert.deepEqual(parsed.payload.durableReviewCommandStates, []);
    assert.deepEqual(parsed.payload.durableReviewCommandOperations, []);
    assert.deepEqual(parsed.payload.durableReviewPatientLinks, []);
    assert.deepEqual(parsed.payload.physicianReviewAttestations, []);
    assert.deepEqual(parsed.payload.headlessSoapActiveRoleAttestations, []);
    assert.equal(parsed.manifest.recordCounts.documentDiagnosisProposals, 0);
    assert.equal(parsed.manifest.recordCounts.durableReviewRecords, 0);
    assert.equal(parsed.manifest.recordCounts.durableReviewOperations, 0);
    assert.equal(parsed.manifest.recordCounts.durableReviewCommandStates, 0);
    assert.equal(parsed.manifest.recordCounts.durableReviewCommandOperations, 0);
    assert.equal(parsed.manifest.recordCounts.durableReviewPatientLinks, 0);
    assert.equal(parsed.manifest.recordCounts.physicianReviewAttestations, 0);
    assert.equal(parsed.manifest.recordCounts.headlessSoapActiveRoleAttestations, 0);
    assert.deepEqual(parsed.manifest.collections, BACKUP_COLLECTIONS);
    assert.equal(parsed.manifest.checksum, normalizedChecksum);
});

/* @Codex */
test('accepts a legacy artifact without durable review collections', async () => {
    const artifact = JSON.parse(await serializeBackupArtifact(basePayload));
    delete artifact.payload.durableReviewRecords;
    delete artifact.payload.durableReviewOperations;
    delete artifact.payload.durableReviewCommandStates;
    delete artifact.payload.durableReviewCommandOperations;
    delete artifact.payload.durableReviewPatientLinks;
    delete artifact.payload.physicianReviewAttestations;
    delete artifact.payload.headlessSoapActiveRoleAttestations;
    artifact.manifest.collections = artifact.manifest.collections.filter((collection: string) => collection !== 'durableReviewRecords' && collection !== 'durableReviewOperations' && collection !== 'durableReviewCommandStates' && collection !== 'durableReviewCommandOperations');
    artifact.manifest.collections = artifact.manifest.collections.filter((collection: string) => collection !== 'durableReviewPatientLinks' && collection !== 'physicianReviewAttestations');
    artifact.manifest.collections = artifact.manifest.collections.filter((collection: string) => collection !== 'headlessSoapActiveRoleAttestations');
    delete artifact.manifest.recordCounts.durableReviewRecords;
    delete artifact.manifest.recordCounts.durableReviewOperations;
    delete artifact.manifest.recordCounts.durableReviewCommandStates;
    delete artifact.manifest.recordCounts.durableReviewCommandOperations;
    delete artifact.manifest.recordCounts.durableReviewPatientLinks;
    delete artifact.manifest.recordCounts.physicianReviewAttestations;
    delete artifact.manifest.recordCounts.headlessSoapActiveRoleAttestations;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(artifact.payload)));
    artifact.manifest.checksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');

    const parsed = await parseBackupArtifact(artifact);

    assert.deepEqual(parsed.payload.documentDiagnosisProposals, basePayload.documentDiagnosisProposals);
    assert.deepEqual(parsed.payload.durableReviewRecords, []);
    assert.deepEqual(parsed.payload.durableReviewOperations, []);
    assert.deepEqual(parsed.payload.durableReviewCommandStates, []);
    assert.deepEqual(parsed.payload.durableReviewCommandOperations, []);
    assert.deepEqual(parsed.payload.durableReviewPatientLinks, []);
    assert.deepEqual(parsed.payload.physicianReviewAttestations, []);
    assert.deepEqual(parsed.payload.headlessSoapActiveRoleAttestations, []);
});

test('normalizes only an authenticated pre-H2 artifact with the SOAP attestation collection omitted', async () => {
    const artifact = JSON.parse(await serializeBackupArtifact(basePayload));
    delete artifact.payload.headlessSoapActiveRoleAttestations;
    artifact.manifest.collections = artifact.manifest.collections.filter((collection: string) => collection !== 'headlessSoapActiveRoleAttestations');
    delete artifact.manifest.recordCounts.headlessSoapActiveRoleAttestations;
    artifact.manifest.checksum = await sha256(stableStringify(artifact.payload));

    const parsed = await parseBackupArtifact(artifact);
    assert.deepEqual(parsed.payload.headlessSoapActiveRoleAttestations, []);
    assert.equal(parsed.manifest.recordCounts.headlessSoapActiveRoleAttestations, 0);
    assert.deepEqual(parsed.manifest.collections, BACKUP_COLLECTIONS);
});

test('accepts an authority-era artifact without command ledger collections', async () => {
    const artifact = JSON.parse(await serializeBackupArtifact(basePayload));
    delete artifact.payload.durableReviewCommandStates;
    delete artifact.payload.durableReviewCommandOperations;
    artifact.manifest.collections = artifact.manifest.collections.filter((collection: string) => collection !== 'durableReviewCommandStates' && collection !== 'durableReviewCommandOperations');
    delete artifact.manifest.recordCounts.durableReviewCommandStates;
    delete artifact.manifest.recordCounts.durableReviewCommandOperations;
    artifact.manifest.checksum = await sha256(stableStringify(artifact.payload));

    const parsed = await parseBackupArtifact(artifact);

    assert.deepEqual(parsed.payload.durableReviewPatientLinks, []);
    assert.deepEqual(parsed.payload.physicianReviewAttestations, []);
    assert.deepEqual(parsed.payload.durableReviewCommandStates, []);
    assert.deepEqual(parsed.payload.durableReviewCommandOperations, []);
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
