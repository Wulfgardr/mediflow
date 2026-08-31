/* @Codex */
import type {
    ClinicianSoapEntryFieldSetV1,
    ClinicianSoapEntryMetadataV1,
    ClinicianSoapEntryPayloadDigestV1,
} from './clinician-soap-entry-field-set';
import {
    ATTACHMENTS_ABSENT,
    decodeEncrypted,
    distinctIVs,
    encodeEncrypted,
    ENTRY_SETTING,
    ENTRY_TITLE,
    ENTRY_TYPE,
    exactDigest,
    FIELD_SET_SCHEMA,
    frame,
    H1_DIGEST_CODEC,
    hashFromBuffer,
    metadataJSON,
    parseFieldSet,
    parseSeal,
    PAYLOAD_DIGEST_CODEC,
    record,
    sameHash,
    SEAL_DIGEST_CODEC,
    SEAL_SCHEMA,
    type HashValue,
    type ParsedFieldSet,
} from './clinician-soap-entry-seal-codec-internal';

export const CLINICIAN_SOAP_ENTRY_SEAL_SCHEMA = SEAL_SCHEMA;
export const CLINICIAN_SOAP_ENTRY_SEAL_DIGEST_CODEC = SEAL_DIGEST_CODEC;

export type ClinicianSoapEntrySealDigestV1 = Readonly<{
    codec: typeof CLINICIAN_SOAP_ENTRY_SEAL_DIGEST_CODEC;
    sha256: Readonly<{ bytes: readonly number[]; hex: string }>;
}>;
export type ClinicianSoapEntrySealV1 = Readonly<{
    schema: typeof CLINICIAN_SOAP_ENTRY_SEAL_SCHEMA;
    type: typeof ENTRY_TYPE;
    date: string;
    setting: typeof ENTRY_SETTING;
    title: string;
    content: string;
    metadata: string;
    payloadDigest: ClinicianSoapEntryPayloadDigestV1;
    sealDigest: ClinicianSoapEntrySealDigestV1;
}>;
export type ClinicianSoapEntrySealDenialCode =
    | 'field_set_unavailable' | 'seal_unavailable' | 'seal_mismatch' | 'lifecycle_unavailable';
export type ClinicianSoapEntrySealResult =
    | Readonly<{ status: 'sealed'; bundle: ClinicianSoapEntrySealV1 }>
    | Readonly<{ status: 'denied'; code: ClinicianSoapEntrySealDenialCode }>;
export type ClinicianSoapEntryReopenResult =
    | Readonly<{ status: 'reopened'; fieldSet: ClinicianSoapEntryFieldSetV1 }>
    | Readonly<{ status: 'denied'; code: ClinicianSoapEntrySealDenialCode }>;
export type ClinicianSoapEntrySealOwner = Readonly<{
    seal(fieldSet: unknown): Promise<ClinicianSoapEntrySealResult>;
    reopen(bundle: unknown, expectedFieldSet: unknown): Promise<ClinicianSoapEntryReopenResult>;
}>;

type Authority = Readonly<{ key: CryptoKey; generation: number }>;
type CryptoPort = Readonly<{
    subtle: Pick<SubtleCrypto, 'digest' | 'encrypt' | 'decrypt'>;
    getRandomValues(target: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
}>;
type OwnerOptions = Readonly<{ readAuthority(): Authority | null; crypto: CryptoPort }>;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });

function deny(code: ClinicianSoapEntrySealDenialCode) {
    return record({ status: 'denied' as const, code });
}

/** Creates the browser H4 seal owner around one SecurityProvider-owned key/generation closure. */
export function createClinicianSoapEntrySealOwner(options: OwnerOptions): ClinicianSoapEntrySealOwner {
    const publishedSeals = new Set<string>(), claimedPayloads = new Set<string>();
    let registryKey: WeakRef<CryptoKey> | null = null, registryGeneration = -1;

    const validKey = (key: CryptoKey): boolean => {
        try { const algorithm = key.algorithm as AesKeyAlgorithm, usages = key.usages;
            return key.type === 'secret' && algorithm.name === 'AES-GCM' && algorithm.length === 256
                && usages.length === 2 && usages.includes('encrypt') && usages.includes('decrypt');
        } catch { return false; }
    };
    const authority = (): Authority | null => {
        try { const current = options.readAuthority();
            return current && validKey(current.key) && Number.isSafeInteger(current.generation) && current.generation >= 0
                ? { key: current.key, generation: current.generation } : null;
        } catch { return null; }
    };
    const fence = (captured: Authority): boolean => {
        const current = authority();
        return current !== null && current.key === captured.key && current.generation === captured.generation;
    };
    const align = (captured: Authority) => {
        if (registryKey?.deref() !== captured.key || registryGeneration !== captured.generation) {
            publishedSeals.clear(); claimedPayloads.clear(); registryKey = new WeakRef(captured.key);
            registryGeneration = captured.generation;
        }
    };
    const digest = async (fields: readonly string[], captured: Authority): Promise<HashValue | null> => {
        const packet = frame(fields); if (!packet) return null;
        const output = await options.crypto.subtle.digest('SHA-256', packet);
        return fence(captured) ? hashFromBuffer(output) : null;
    };
    const checkedFieldSet = async (value: unknown, captured: Authority): Promise<ParsedFieldSet | null> => {
        const parsed = parseFieldSet(value); if (!parsed) return null;
        const expected = await digest([PAYLOAD_DIGEST_CODEC, FIELD_SET_SCHEMA, H1_DIGEST_CODEC,
            parsed.value.metadata.sha256.hex, ENTRY_TYPE, ENTRY_TITLE, parsed.value.date, parsed.value.content,
            ENTRY_SETTING, parsed.metadataJSON, ATTACHMENTS_ABSENT], captured);
        return expected && sameHash(expected, parsed.value.payloadDigest.sha256) ? parsed : null;
    };
    const encrypt = async (plaintext: string, iv: Uint8Array<ArrayBuffer>, captured: Authority): Promise<string | null> => {
        const output = await options.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, tagLength: 128 }, captured.key, encoder.encode(plaintext));
        return fence(captured) ? encodeEncrypted(iv, output) : null;
    };
    const decrypt = async (encrypted: string, captured: Authority): Promise<string | null> => {
        const parsed = decodeEncrypted(encrypted); if (!parsed) return null;
        const output = await options.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: parsed.iv, tagLength: 128 }, captured.key, parsed.ciphertextAndTag);
        if (!fence(captured)) return null;
        try { return decoder.decode(output); } catch { return null; }
    };

    const seal = async (input: unknown): Promise<ClinicianSoapEntrySealResult> => {
        const captured = authority(); if (!captured) return deny('seal_unavailable');
        try { const parsed = await checkedFieldSet(input, captured);
            if (!parsed) return deny(fence(captured) ? 'field_set_unavailable' : 'seal_unavailable');
            if (!fence(captured)) return deny('seal_unavailable'); align(captured);
            const payloadIdentity = parsed.value.payloadDigest.sha256.hex;
            if (claimedPayloads.has(payloadIdentity)) return deny('seal_unavailable');
            claimedPayloads.add(payloadIdentity);
            const ivs = distinctIVs((target) => options.crypto.getRandomValues(target));
            if (!ivs || !fence(captured)) return deny(ivs ? 'seal_unavailable' : 'lifecycle_unavailable');
            const title = await encrypt(JSON.stringify(parsed.value.title), ivs[0], captured);
            if (!title) return deny('seal_unavailable');
            const content = await encrypt(JSON.stringify(parsed.value.content), ivs[1], captured);
            if (!content) return deny('seal_unavailable');
            const metadata = await encrypt(parsed.metadataJSON, ivs[2], captured);
            if (!metadata) return deny('seal_unavailable');
            const sealHash = await digest([SEAL_DIGEST_CODEC, SEAL_SCHEMA, PAYLOAD_DIGEST_CODEC,
                parsed.value.payloadDigest.sha256.hex, ENTRY_TYPE, parsed.value.date, ENTRY_SETTING,
                title, content, metadata, ATTACHMENTS_ABSENT], captured);
            if (!sealHash || !fence(captured)) return deny('seal_unavailable');
            const sealDigest = record({ codec: SEAL_DIGEST_CODEC, sha256: sealHash }) as ClinicianSoapEntrySealDigestV1;
            const bundle = record({ schema: SEAL_SCHEMA, type: ENTRY_TYPE, date: parsed.value.date,
                setting: ENTRY_SETTING, title, content, metadata, payloadDigest: parsed.value.payloadDigest,
                sealDigest }) as ClinicianSoapEntrySealV1;
            if (!fence(captured)) return deny('seal_unavailable'); align(captured); publishedSeals.add(sealHash.hex);
            return record({ status: 'sealed' as const, bundle });
        } catch { return deny('seal_unavailable'); }
    };

    const reopen = async (bundleInput: unknown, expectedInput: unknown): Promise<ClinicianSoapEntryReopenResult> => {
        const captured = authority(); if (!captured) return deny('seal_unavailable');
        try { align(captured); const expected = await checkedFieldSet(expectedInput, captured);
            if (!expected) return deny(fence(captured) ? 'field_set_unavailable' : 'seal_unavailable');
            const bundle = parseSeal(bundleInput);
            if (!bundle || !fence(captured) || !publishedSeals.has(bundle.sealDigest.sha256.hex)) return deny('seal_unavailable');
            const sealHash = await digest([SEAL_DIGEST_CODEC, SEAL_SCHEMA, PAYLOAD_DIGEST_CODEC,
                bundle.payloadDigest.sha256.hex, ENTRY_TYPE, bundle.date, ENTRY_SETTING,
                bundle.title, bundle.content, bundle.metadata, ATTACHMENTS_ABSENT], captured);
            if (!sealHash) return deny('seal_unavailable');
            if (!sameHash(sealHash, bundle.sealDigest.sha256)) return deny('seal_mismatch');
            const titleJSON = await decrypt(bundle.title, captured); if (titleJSON === null) return deny(fence(captured) ? 'seal_mismatch' : 'seal_unavailable');
            const contentJSON = await decrypt(bundle.content, captured); if (contentJSON === null) return deny(fence(captured) ? 'seal_mismatch' : 'seal_unavailable');
            const metadataRaw = await decrypt(bundle.metadata, captured); if (metadataRaw === null) return deny(fence(captured) ? 'seal_mismatch' : 'seal_unavailable');
            let title: unknown, content: unknown, metadataValue: unknown;
            try { title = JSON.parse(titleJSON); content = JSON.parse(contentJSON); metadataValue = JSON.parse(metadataRaw); }
            catch { return deny('seal_mismatch'); }
            const metadata = exactDigest(metadataValue, H1_DIGEST_CODEC);
            if (typeof title !== 'string' || JSON.stringify(title) !== titleJSON || typeof content !== 'string'
                || JSON.stringify(content) !== contentJSON || !metadata
                || metadataJSON(metadata as ClinicianSoapEntryMetadataV1) !== metadataRaw) return deny('seal_mismatch');
            if (bundle.type !== expected.value.type || bundle.date !== expected.value.date || bundle.setting !== expected.value.setting
                || title !== expected.value.title || content !== expected.value.content || metadataRaw !== expected.metadataJSON
                || !sameHash(bundle.payloadDigest.sha256, expected.value.payloadDigest.sha256)) return deny('seal_mismatch');
            return fence(captured) ? record({ status: 'reopened' as const, fieldSet: expected.value }) : deny('seal_unavailable');
        } catch { return deny(fence(captured) ? 'seal_mismatch' : 'seal_unavailable'); }
    };
    return record({ seal, reopen });
}
