/* @Codex */
import 'server-only';

import { createHash } from 'node:crypto';

import type { ClinicianSoapEntrySealV1 } from '../headless/clinician-soap-entry-seal';
import {
    ATTACHMENTS_ABSENT,
    ENTRY_SETTING,
    ENTRY_TITLE,
    ENTRY_TYPE,
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
} from '../headless/clinician-soap-entry-seal-codec-internal';

function digest(fields: readonly string[]): HashValue | null {
    const packet = frame(fields);
    if (!packet) return null;
    const bytes = Uint8Array.from(createHash('sha256').update(packet).digest());
    return hashFromBuffer(bytes.buffer);
}

/** Verifies and canonically copies one browser-produced H4 bundle without decrypting it. */
export function verifyHeadlessSoapEntryGestureSealBundle(
    fieldSetCandidate: unknown,
    sealBundleCandidate: unknown,
): ClinicianSoapEntrySealV1 | null {
    try {
        const fieldSet = parseFieldSet(fieldSetCandidate);
        if (!fieldSet) return null;
        const payloadHash = digest([
            PAYLOAD_DIGEST_CODEC,
            FIELD_SET_SCHEMA,
            H1_DIGEST_CODEC,
            fieldSet.value.metadata.sha256.hex,
            ENTRY_TYPE,
            ENTRY_TITLE,
            fieldSet.value.date,
            fieldSet.value.content,
            ENTRY_SETTING,
            metadataJSON(fieldSet.value.metadata),
            ATTACHMENTS_ABSENT,
        ]);
        if (!payloadHash || !sameHash(payloadHash, fieldSet.value.payloadDigest.sha256)) return null;

        const seal = parseSeal(sealBundleCandidate);
        if (!seal || seal.type !== fieldSet.value.type || seal.date !== fieldSet.value.date
            || seal.setting !== fieldSet.value.setting
            || !sameHash(seal.payloadDigest.sha256, fieldSet.value.payloadDigest.sha256)) return null;
        const sealHash = digest([
            SEAL_DIGEST_CODEC,
            SEAL_SCHEMA,
            PAYLOAD_DIGEST_CODEC,
            seal.payloadDigest.sha256.hex,
            ENTRY_TYPE,
            seal.date,
            ENTRY_SETTING,
            seal.title,
            seal.content,
            seal.metadata,
            ATTACHMENTS_ABSENT,
        ]);
        if (!sealHash || !sameHash(sealHash, seal.sealDigest.sha256)) return null;
        return record({
            schema: SEAL_SCHEMA,
            type: ENTRY_TYPE,
            date: seal.date,
            setting: ENTRY_SETTING,
            title: seal.title,
            content: seal.content,
            metadata: seal.metadata,
            payloadDigest: seal.payloadDigest,
            sealDigest: seal.sealDigest,
        }) as ClinicianSoapEntrySealV1;
    } catch {
        return null;
    }
}
