import test from 'node:test';
import { readFileSync } from 'node:fs';
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
    exemptionImportReceipts: [],
    prostheticsCatalogEntries: [], // Additive repertory generation.
    prostheticsCatalogReceipts: [],
    prostheticsCatalogSources: [],
    prostheticsCatalogDocuments: [],
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
    checkups: [],
    therapies: [],
    therapyStatusCommands: [],
    ambulatoryDestructiveCommands: [],
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
    assert.deepEqual(artifact.manifest.collections, BACKUP_COLLECTIONS.filter(collection => collection !== 'auditEvents'));
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


async function sha256(value: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}


async function checksumValidAuthorityArtifact(mutate: (artifact: any) => void | Promise<void>): Promise<Record<string, unknown>> {
    const artifact = JSON.parse(await serializeBackupArtifact({
        ...basePayload,
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
    return reauthor(artifact);
}

/* Recomputes counts and checksum as an older producer would have written them. */
async function reauthor(artifact: any): Promise<Record<string, any>> {
    for (const collection of artifact.manifest.collections) {
        artifact.manifest.recordCounts[collection] = artifact.payload[collection].length;
    }
    artifact.manifest.checksum = await sha256(stableStringify(artifact.payload));
    return artifact;
}

async function withoutCollections(omitted: readonly string[]): Promise<Record<string, any>> {
    const artifact = JSON.parse(await serializeBackupArtifact(basePayload));
    for (const collection of omitted) {
        delete artifact.payload[collection];
        delete artifact.manifest.recordCounts[collection];
    }
    artifact.manifest.collections = artifact.manifest.collections.filter((collection: string) => !omitted.includes(collection));
    return reauthor(artifact);
}

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


test('rejects checksum-valid malformed physician review attestations before restore', async () => {
    const mutations: Array<(artifact: any) => void> = [
        (artifact) => { artifact.payload.physicianReviewAttestations[0].extra = true; },
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

test('rejects hostile physician review attestations without invoking accessors or proxy traps', async () => {
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


const OPTIONAL_GROUPS = [
    ['ambulatoryDestructiveCommands'],
    ['documentDiagnosisProposals'],
    ['exemptionImportReceipts'],
    ['physicianReviewAttestations'],
    ['prostheticsCatalogSources', 'prostheticsCatalogDocuments'],
    ['prostheticsCatalogEntries', 'prostheticsCatalogReceipts'],
    ['therapyStatusCommands'],
];
const RETIRED_COLLECTIONS = [
    'durableReviewCommandStates', 'durableReviewCommandOperations', 'durableReviewPatientLinks',
    'durableReviewRecords', 'durableReviewOperations', 'headlessSoapActiveRoleAttestations', 'headlessSoapEntryCommits',
];

test('accepts every older v1 generation and normalizes the missing collections to empty', async () => {
    const current = BACKUP_COLLECTIONS.filter(collection => collection !== 'auditEvents');
    for (let mask = 0; mask < 1 << OPTIONAL_GROUPS.length; mask += 1) {
        const omitted = OPTIONAL_GROUPS.filter((_group, index) => mask & (1 << index)).flat();
        const parsed = await parseBackupArtifact(await withoutCollections(omitted));
        assert.deepEqual(parsed.manifest.collections, current);
        for (const collection of omitted) {
            assert.deepEqual((parsed.payload as Record<string, unknown>)[collection], []);
            assert.equal((parsed.manifest.recordCounts as Record<string, number>)[collection], 0);
        }
        assert.equal(parsed.manifest.checksum, await sha256(stableStringify(parsed.payload)));
    }
});

test('rejects a generation that carries only part of a collection group', async () => {
    for (const omitted of [['prostheticsCatalogSources'], ['prostheticsCatalogReceipts'], ['therapies']]) {
        await assert.rejects(() => withoutCollections(omitted).then(parseBackupArtifact),
            (error: unknown) => error instanceof BackupArtifactError && error.code === 'collection-mismatch');
    }
});

test('drops the empty collections of removed features from an older artifact', async () => {
    const artifact = JSON.parse(await serializeBackupArtifact(basePayload));
    for (const collection of RETIRED_COLLECTIONS) {
        artifact.payload[collection] = [];
        artifact.manifest.collections.push(collection);
    }
    const parsed = await parseBackupArtifact(await reauthor(artifact));
    for (const collection of RETIRED_COLLECTIONS) {
        assert.equal(Object.hasOwn(parsed.payload, collection), false);
        assert.equal(Object.hasOwn(parsed.manifest.recordCounts, collection), false);
    }
    assert.deepEqual(parsed.manifest.collections, BACKUP_COLLECTIONS.filter(collection => collection !== 'auditEvents'));
    assert.equal(stableStringify(parsed.payload), stableStringify(basePayload));
});

test('refuses rather than drops a removed feature collection that holds rows', async () => {
    for (const collection of RETIRED_COLLECTIONS) {
        const artifact = JSON.parse(await serializeBackupArtifact(basePayload));
        artifact.payload[collection] = [{ id: 'synthetic' }];
        artifact.manifest.collections.push(collection);
        await assert.rejects(() => reauthor(artifact).then(parseBackupArtifact),
            (error: unknown) => error instanceof BackupArtifactError && error.code === 'collection-mismatch'
                && error.message.includes(collection));
    }
    const listedOnly = JSON.parse(await serializeBackupArtifact(basePayload));
    listedOnly.manifest.collections.push('headlessSoapEntryCommits');
    listedOnly.manifest.recordCounts.headlessSoapEntryCommits = 0;
    await assert.rejects(() => parseBackupArtifact(listedOnly),
        (error: unknown) => error instanceof BackupArtifactError && error.code === 'collection-mismatch');
});

async function legacyArtifact(): Promise<Record<string, any>> {
    return withoutCollections(['documentDiagnosisProposals', 'physicianReviewAttestations']);
}


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

test('still opens artifacts written before the removal of the durable review and headless SOAP collections', async () => {
    const { artifacts } = JSON.parse(readFileSync(new URL('../scripts/fixtures/backup-artifacts-v1-generations.json', import.meta.url), 'utf8'));
    assert.equal(artifacts.length, 3);
    assert.ok(RETIRED_COLLECTIONS.every(collection => Object.hasOwn(artifacts[0].payload, collection)));
    for (const artifact of artifacts) {
        const parsed = await parseBackupArtifact(artifact);
        assert.deepEqual(Object.keys(parsed.payload).sort(), BACKUP_COLLECTIONS.filter(collection => collection !== 'auditEvents').sort());
        assert.equal(parsed.payload.entries.length, 1);
    }
});
