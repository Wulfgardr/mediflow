/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import test from 'node:test';
import {
    CLINICIAN_SOAP_DRAFT_SCHEMA,
    CLINICIAN_SOAP_OPERATION_ID,
    validateClinicianSoapWriteDraft,
} from './clinician-soap-write-contract.ts';
import { createClinicianSoapEntryFieldSet } from './clinician-soap-entry-field-set.ts';
import { createClinicianSoapEntrySealOwner } from './clinician-soap-entry-seal.ts';

type GoldenFixture = Readonly<{
    inputs: Readonly<{
        epochMilliseconds: number;
        rawMasterKeyHex: string;
        titleIVHex: string;
        contentIVHex: string;
        metadataIVHex: string;
        subjective: string;
        objective: string;
        assessment: string;
        plan: string;
    }>;
    seal: Readonly<Record<string, unknown>>;
}>;

const fixture = JSON.parse(readFileSync(
    new URL('../../native/contracts/headless-soap-entry-h4-golden.v1.json', import.meta.url),
    'utf8',
)) as GoldenFixture;

function bytesFromHex(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
}

function payloadDigestFor(fieldSet: NonNullable<ReturnType<typeof createClinicianSoapEntryFieldSet>>, date: string) {
    const fields = [
        'mediflow.headless.soap-entry-payload-digest.v1',
        'mediflow.headless.soap-entry-field-set.v1',
        'mediflow.headless.soap-draft-digest.v1',
        fieldSet.metadata.sha256.hex,
        'visit',
        'Voce clinica',
        date,
        fieldSet.content,
        'ambulatory',
        JSON.stringify(fieldSet.metadata),
        'mediflow.headless.attachments.absent.v1',
    ];
    const packet = Buffer.concat(fields.flatMap((field) => {
        const bytes = Buffer.from(field, 'utf8'), length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
        return [length, bytes];
    }));
    const bytes = [...createHash('sha256').update(packet).digest()];
    return Object.freeze(Object.assign(Object.create(null), {
        codec: 'mediflow.headless.soap-entry-payload-digest.v1',
        sha256: Object.freeze(Object.assign(Object.create(null), {
            bytes: Object.freeze(bytes), hex: Buffer.from(bytes).toString('hex'),
        })),
    }));
}

function acceptedSnapshot() {
    const result = validateClinicianSoapWriteDraft(Object.assign(Object.create(null), {
        schema: CLINICIAN_SOAP_DRAFT_SCHEMA,
        operationId: CLINICIAN_SOAP_OPERATION_ID,
        subjective: fixture.inputs.subjective,
        objective: fixture.inputs.objective,
        assessment: fixture.inputs.assessment,
        plan: fixture.inputs.plan,
    }));
    assert.equal(result.status, 'accepted');
    if (result.status !== 'accepted') throw new Error('synthetic H1 fixture denied');
    return result;
}

async function goldenOwner() {
    const key = await webcrypto.subtle.importKey(
        'raw',
        bytesFromHex(fixture.inputs.rawMasterKeyHex),
        'AES-GCM',
        false,
        ['encrypt', 'decrypt'],
    );
    const ivs = [
        bytesFromHex(fixture.inputs.titleIVHex),
        bytesFromHex(fixture.inputs.contentIVHex),
        bytesFromHex(fixture.inputs.metadataIVHex),
    ];
    let generation = 7;
    const owner = createClinicianSoapEntrySealOwner({
        readAuthority: () => ({ key: key as CryptoKey, generation }),
        crypto: {
            subtle: webcrypto.subtle as SubtleCrypto,
            getRandomValues: (target) => {
                const source = ivs.shift();
                if (!source || source.byteLength !== target.byteLength) throw new Error('unexpected IV request');
                target.set(source);
                return target;
            },
        },
    });
    return { owner, key, revoke: () => { generation += 1; } };
}

test('seals and reopens the canonical H4 field set byte-exactly against the tri-OS oracle', async () => {
    const fieldSet = createClinicianSoapEntryFieldSet(acceptedSnapshot(), fixture.inputs.epochMilliseconds);
    assert.ok(fieldSet);
    const { owner } = await goldenOwner();

    const sealed = await owner.seal(fieldSet);
    assert.equal(sealed.status, 'sealed');
    if (sealed.status !== 'sealed') return;
    assert.deepEqual(JSON.parse(JSON.stringify(sealed.bundle)), fixture.seal);
    assert.deepEqual(Reflect.ownKeys(sealed.bundle), [
        'schema', 'type', 'date', 'setting', 'title', 'content', 'metadata', 'payloadDigest', 'sealDigest',
    ]);
    assert.equal(Object.getPrototypeOf(sealed.bundle), null);
    assert.equal(Object.isFrozen(sealed.bundle), true);
    assert.equal(Object.hasOwn(sealed.bundle, 'attachments'), false);

    const reopened = await owner.reopen(sealed.bundle, fieldSet);
    assert.equal(reopened.status, 'reopened');
    if (reopened.status !== 'reopened') return;
    assert.deepEqual(reopened.fieldSet, fieldSet);
    assert.notEqual(reopened.fieldSet, fieldSet);
});

test('fails closed on tamper, foreign seals, attachments, and a mismatched host DTO', async () => {
    const fieldSet = createClinicianSoapEntryFieldSet(acceptedSnapshot(), fixture.inputs.epochMilliseconds);
    assert.ok(fieldSet);
    const { owner } = await goldenOwner();
    const sealed = await owner.seal(fieldSet);
    assert.equal(sealed.status, 'sealed');
    if (sealed.status !== 'sealed') return;

    const copied = Object.freeze(Object.assign(Object.create(null), sealed.bundle));
    assert.equal((await owner.reopen(copied, fieldSet)).status, 'reopened');

    const encryptedParts = sealed.bundle.content.split(':');
    assert.equal(encryptedParts.length, 3);
    const firstCipherCharacter = encryptedParts[2]![0]!;
    encryptedParts[2] = `${firstCipherCharacter === 'A' ? 'B' : 'A'}${encryptedParts[2]!.slice(1)}`;
    const tampered = Object.freeze(Object.assign(Object.create(null), sealed.bundle, {
        content: encryptedParts.join(':'),
    }));
    assert.deepEqual(await owner.reopen(tampered, fieldSet), Object.assign(Object.create(null), {
        status: 'denied', code: 'seal_mismatch',
    }));

    const withAttachments = Object.freeze(Object.assign(Object.create(null), sealed.bundle, { attachments: null }));
    assert.deepEqual(await owner.reopen(withAttachments, fieldSet), Object.assign(Object.create(null), {
        status: 'denied', code: 'seal_unavailable',
    }));

    const mismatchedHostDTO = Object.freeze(Object.assign(Object.create(null), fieldSet, {
        content: fieldSet.content.replace('<p>A:</p>', '<p>A: Differente</p>'),
    }));
    assert.deepEqual(await owner.reopen(sealed.bundle, mismatchedHostDTO), Object.assign(Object.create(null), {
        status: 'denied', code: 'field_set_unavailable',
    }));

    const { owner: foreignOwner } = await goldenOwner();
    assert.deepEqual(await foreignOwner.reopen(sealed.bundle, fieldSet), Object.assign(Object.create(null), {
        status: 'denied', code: 'seal_unavailable',
    }));
});

test('revocation generation fences every WebCrypto await and retires prior bundles', async () => {
    const fieldSet = createClinicianSoapEntryFieldSet(acceptedSnapshot(), fixture.inputs.epochMilliseconds);
    assert.ok(fieldSet);
    const { owner, revoke } = await goldenOwner();
    const sealed = await owner.seal(fieldSet);
    assert.equal(sealed.status, 'sealed');
    if (sealed.status !== 'sealed') return;

    revoke();
    assert.deepEqual(await owner.reopen(sealed.bundle, fieldSet), Object.assign(Object.create(null), {
        status: 'denied', code: 'seal_unavailable',
    }));
});

test('does not publish a seal when revocation overtakes an in-flight WebCrypto operation', async () => {
    const fieldSet = createClinicianSoapEntryFieldSet(acceptedSnapshot(), fixture.inputs.epochMilliseconds);
    assert.ok(fieldSet);
    const key = await webcrypto.subtle.importKey(
        'raw', bytesFromHex(fixture.inputs.rawMasterKeyHex), 'AES-GCM', false, ['encrypt', 'decrypt'],
    );
    let generation = 11;
    let signalDigestStarted!: () => void;
    let releaseDigest!: () => void;
    const digestStarted = new Promise<void>((resolve) => { signalDigestStarted = resolve; });
    const digestGate = new Promise<void>((resolve) => { releaseDigest = resolve; });
    let randomCalls = 0;
    const owner = createClinicianSoapEntrySealOwner({
        readAuthority: () => ({ key: key as CryptoKey, generation }),
        crypto: {
            subtle: {
                digest: (async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
                    signalDigestStarted();
                    await digestGate;
                    return webcrypto.subtle.digest(algorithm, data);
                }) as SubtleCrypto['digest'],
                encrypt: webcrypto.subtle.encrypt.bind(webcrypto.subtle) as SubtleCrypto['encrypt'],
                decrypt: webcrypto.subtle.decrypt.bind(webcrypto.subtle) as SubtleCrypto['decrypt'],
            },
            getRandomValues: (target) => {
                randomCalls += 1;
                webcrypto.getRandomValues(target);
                return target;
            },
        },
    });

    const pending = owner.seal(fieldSet);
    await digestStarted;
    generation += 1;
    releaseDigest();

    assert.deepEqual(await pending, Object.assign(Object.create(null), {
        status: 'denied', code: 'seal_unavailable',
    }));
    assert.equal(randomCalls, 0);
});

test('rejects a current CryptoKey unless it is exactly AES-GCM 256 with encrypt/decrypt usage', async () => {
    const fieldSet = createClinicianSoapEntryFieldSet(acceptedSnapshot(), fixture.inputs.epochMilliseconds);
    assert.ok(fieldSet);
    const shortKey = await webcrypto.subtle.importKey(
        'raw', new Uint8Array(16), 'AES-GCM', false, ['encrypt', 'decrypt'],
    );
    let ivSeed = 0;
    const owner = createClinicianSoapEntrySealOwner({
        readAuthority: () => ({ key: shortKey as CryptoKey, generation: 1 }),
        crypto: {
            subtle: webcrypto.subtle as SubtleCrypto,
            getRandomValues: (target) => {
                target.fill(ivSeed++);
                return target;
            },
        },
    });

    assert.deepEqual(await owner.seal(fieldSet), Object.assign(Object.create(null), {
        status: 'denied', code: 'seal_unavailable',
    }));
});

test('rejects a byte-consistent field set dated before the non-negative host epoch', async () => {
    const fieldSet = createClinicianSoapEntryFieldSet(acceptedSnapshot(), fixture.inputs.epochMilliseconds);
    assert.ok(fieldSet);
    const date = '1969-12-31T23:59:59.000Z';
    const preEpoch = Object.freeze(Object.assign(Object.create(null), fieldSet, {
        date,
        payloadDigest: payloadDigestFor(fieldSet, date),
    }));
    const { owner } = await goldenOwner();

    assert.deepEqual(await owner.seal(preEpoch), Object.assign(Object.create(null), {
        status: 'denied', code: 'field_set_unavailable',
    }));
});

test('claims one seal per payload and authority generation before IV allocation or encryption', async () => {
    const fieldSet = createClinicianSoapEntryFieldSet(acceptedSnapshot(), fixture.inputs.epochMilliseconds);
    assert.ok(fieldSet);
    const key = await webcrypto.subtle.importKey(
        'raw', bytesFromHex(fixture.inputs.rawMasterKeyHex), 'AES-GCM', false, ['encrypt', 'decrypt'],
    );
    let generation = 21;
    let randomCalls = 0;
    let encryptCalls = 0;
    const owner = createClinicianSoapEntrySealOwner({
        readAuthority: () => ({ key: key as CryptoKey, generation }),
        crypto: {
            subtle: {
                digest: webcrypto.subtle.digest.bind(webcrypto.subtle) as SubtleCrypto['digest'],
                encrypt: ((...args: Parameters<SubtleCrypto['encrypt']>) => {
                    encryptCalls += 1;
                    return webcrypto.subtle.encrypt(...args);
                }) as SubtleCrypto['encrypt'],
                decrypt: webcrypto.subtle.decrypt.bind(webcrypto.subtle) as SubtleCrypto['decrypt'],
            },
            getRandomValues: (target) => {
                target.fill(++randomCalls);
                return target;
            },
        },
    });

    const concurrent = await Promise.all([owner.seal(fieldSet), owner.seal(fieldSet)]);
    assert.equal(concurrent.filter((result) => result.status === 'sealed').length, 1);
    assert.equal(concurrent.filter((result) => result.status === 'denied').length, 1);
    assert.equal(randomCalls, 3);
    assert.equal(encryptCalls, 3);

    assert.deepEqual(await owner.seal(fieldSet), Object.assign(Object.create(null), {
        status: 'denied', code: 'seal_unavailable',
    }));
    assert.equal(randomCalls, 3);
    assert.equal(encryptCalls, 3);

    generation += 1;
    assert.equal((await owner.seal(fieldSet)).status, 'sealed');
    assert.equal(randomCalls, 6);
    assert.equal(encryptCalls, 6);
});

test('keeps the one-shot payload claim after an encryption failure', async () => {
    const fieldSet = createClinicianSoapEntryFieldSet(acceptedSnapshot(), fixture.inputs.epochMilliseconds);
    assert.ok(fieldSet);
    const key = await webcrypto.subtle.importKey(
        'raw', bytesFromHex(fixture.inputs.rawMasterKeyHex), 'AES-GCM', false, ['encrypt', 'decrypt'],
    );
    let randomCalls = 0, encryptCalls = 0;
    const owner = createClinicianSoapEntrySealOwner({
        readAuthority: () => ({ key: key as CryptoKey, generation: 31 }),
        crypto: {
            subtle: {
                digest: webcrypto.subtle.digest.bind(webcrypto.subtle) as SubtleCrypto['digest'],
                encrypt: (async () => { encryptCalls += 1; throw new Error('synthetic encrypt failure'); }) as SubtleCrypto['encrypt'],
                decrypt: webcrypto.subtle.decrypt.bind(webcrypto.subtle) as SubtleCrypto['decrypt'],
            },
            getRandomValues: (target) => { target.fill(++randomCalls); return target; },
        },
    });

    assert.equal((await owner.seal(fieldSet)).status, 'denied');
    assert.equal((await owner.seal(fieldSet)).status, 'denied');
    assert.equal(randomCalls, 3);
    assert.equal(encryptCalls, 1);
});
