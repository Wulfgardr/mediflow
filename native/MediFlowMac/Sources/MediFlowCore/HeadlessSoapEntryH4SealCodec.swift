/* @Codex */
import Foundation
import Crypto

extension HeadlessSoapEntryH4Codec {
    static func seal(_ fieldSet: FieldSet, masterKey: SymmetricKey) throws -> Seal {
        guard masterKey.bitCount == 256 else { throw CodecError.invalidKey }
        var ivs: [Data] = []
        while ivs.count < 3 {
            let candidate = Data(AES.GCM.Nonce())
            if !ivs.contains(candidate) { ivs.append(candidate) }
        }
        return try seal(
            fieldSet,
            masterKey: masterKey,
            titleIV: ivs[0],
            contentIV: ivs[1],
            metadataIV: ivs[2]
        )
    }

    static func seal(
        _ fieldSet: FieldSet,
        masterKey: SymmetricKey,
        titleIV: Data,
        contentIV: Data,
        metadataIV: Data
    ) throws -> Seal {
        guard masterKey.bitCount == 256 else { throw CodecError.invalidKey }
        try validate(fieldSet)
        let ivs = [titleIV, contentIV, metadataIV]
        guard ivs.allSatisfy({ $0.count == 12 }), Set(ivs).count == 3 else { throw CodecError.invalidIV }
        let title = try encryptRawJSON(jsonString(fieldSet.title), key: masterKey, iv: titleIV)
        let content = try encryptRawJSON(jsonString(fieldSet.content), key: masterKey, iv: contentIV)
        let metadata = try encryptRawJSON(fieldSet.metadata.canonicalJSON, key: masterKey, iv: metadataIV)
        let sealDigest = try framedDigest(codec: sealDigestCodec, fields: [
            sealDigestCodec,
            sealSchema,
            payloadDigestCodec,
            fieldSet.payloadDigest.sha256.hex,
            "visit",
            fieldSet.date,
            "ambulatory",
            title,
            content,
            metadata,
            absentAttachments,
        ])
        return Seal(
            schema: sealSchema,
            type: fieldSet.type,
            date: fieldSet.date,
            setting: fieldSet.setting,
            title: title,
            content: content,
            metadata: metadata,
            payloadDigest: fieldSet.payloadDigest,
            sealDigest: sealDigest
        )
    }

    static func reopen(_ seal: Seal, masterKey: SymmetricKey, expected: FieldSet) throws -> FieldSet {
        guard masterKey.bitCount == 256 else { throw CodecError.invalidKey }
        try validate(expected)
        guard seal.schema == sealSchema,
              seal.type == "visit",
              byteEqual(seal.date, expected.date),
              seal.setting == "ambulatory",
              seal.payloadDigest == expected.payloadDigest else { throw CodecError.sealMismatch }
        try validate(seal.payloadDigest, codec: payloadDigestCodec)
        try validate(seal.sealDigest, codec: sealDigestCodec)
        let computedSealDigest = try framedDigest(codec: sealDigestCodec, fields: [
            sealDigestCodec,
            sealSchema,
            payloadDigestCodec,
            seal.payloadDigest.sha256.hex,
            seal.type,
            seal.date,
            seal.setting,
            seal.title,
            seal.content,
            seal.metadata,
            absentAttachments,
        ])
        guard computedSealDigest == seal.sealDigest else { throw CodecError.sealMismatch }

        let titleJSON = try decryptRawJSON(seal.title, key: masterKey)
        let contentJSON = try decryptRawJSON(seal.content, key: masterKey)
        let metadataJSON = try decryptRawJSON(seal.metadata, key: masterKey)
        guard byteEqual(titleJSON, jsonString(expected.title)),
              byteEqual(contentJSON, jsonString(expected.content)),
              byteEqual(metadataJSON, expected.metadata.canonicalJSON) else { throw CodecError.sealMismatch }
        _ = try decodeContent(expected.content)
        return expected
    }

    private static func jsonString(_ value: String) -> String {
        var output = "\""
        for scalar in value.unicodeScalars {
            switch scalar.value {
            case 34: output += "\\\""
            case 92: output += "\\\\"
            case 8: output += "\\b"
            case 9: output += "\\t"
            case 10: output += "\\n"
            case 12: output += "\\f"
            case 13: output += "\\r"
            case 0...31: output += String(format: "\\u%04x", scalar.value)
            default: output.unicodeScalars.append(scalar)
            }
        }
        output += "\""
        return output
    }

    private static func encryptRawJSON(_ value: String, key: SymmetricKey, iv: Data) throws -> String {
        guard iv.count == 12 else { throw CodecError.invalidIV }
        do {
            let nonce = try AES.GCM.Nonce(data: iv)
            let box = try AES.GCM.seal(Data(value.utf8), using: key, nonce: nonce)
            let combined = box.ciphertext + box.tag
            return "ENC:\(iv.base64EncodedString()):\(combined.base64EncodedString())"
        } catch {
            throw CodecError.encryptionFailed
        }
    }

    private static func decryptRawJSON(_ value: String, key: SymmetricKey) throws -> String {
        let parts = value.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 3,
              parts[0] == "ENC",
              let iv = Data(base64Encoded: String(parts[1])),
              let combined = Data(base64Encoded: String(parts[2])),
              iv.count == 12,
              combined.count >= 16,
              iv.base64EncodedString() == parts[1],
              combined.base64EncodedString() == parts[2] else { throw CodecError.invalidEnvelope }
        do {
            let nonce = try AES.GCM.Nonce(data: iv)
            let box = try AES.GCM.SealedBox(
                nonce: nonce,
                ciphertext: combined.dropLast(16),
                tag: combined.suffix(16)
            )
            let plaintext = try AES.GCM.open(box, using: key)
            guard let decoded = String(data: plaintext, encoding: .utf8) else { throw CodecError.invalidEnvelope }
            return decoded
        } catch let error as CodecError {
            throw error
        } catch {
            throw CodecError.invalidEnvelope
        }
    }
}
