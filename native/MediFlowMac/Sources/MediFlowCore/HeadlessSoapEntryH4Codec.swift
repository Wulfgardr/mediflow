/* @Codex */
import Foundation
import Crypto

/// Module-internal byte oracle for ADR 0103. Runtime authority remains in the
/// H3-bound TypeScript host and SecurityProvider; these deterministic seams are
/// exposed only to `@testable` cross-platform golden tests.
enum HeadlessSoapEntryH4Codec {
    static let fieldSetSchema = "mediflow.headless.soap-entry-field-set.v1"
    static let payloadDigestCodec = "mediflow.headless.soap-entry-payload-digest.v1"
    static let sealSchema = "mediflow.headless.soap-entry-seal.v1"
    static let sealDigestCodec = "mediflow.headless.soap-entry-seal-digest.v1"
    static let h1DigestCodec = "mediflow.headless.soap-draft-digest.v1"
    static let absentAttachments = "mediflow.headless.attachments.absent.v1"

    enum CodecError: Error, Equatable {
        case invalidInput
        case invalidDigest
        case invalidDate
        case invalidContent
        case invalidKey
        case invalidIV
        case encryptionFailed
        case invalidEnvelope
        case sealMismatch
    }

    struct SHA256Value: Equatable, Sendable {
        let bytes: [UInt8]
        let hex: String

        init(bytes: [UInt8], hex: String) {
            self.bytes = bytes
            self.hex = hex
        }
    }

    struct Digest: Equatable, Sendable {
        let codec: String
        let sha256: SHA256Value

        init(codec: String, sha256: SHA256Value) {
            self.codec = codec
            self.sha256 = sha256
        }

        var canonicalJSON: String {
            let byteList = sha256.bytes.map(String.init).joined(separator: ",")
            return "{\"codec\":\"\(codec)\",\"sha256\":{\"bytes\":[\(byteList)],\"hex\":\"\(sha256.hex)\"}}"
        }
    }

    struct Sections: Equatable, Sendable {
        let subjective: String
        let objective: String
        let assessment: String
        let plan: String
    }

    struct FieldSet: Equatable, Sendable {
        let schema: String
        let type: String
        let title: String
        let date: String
        let content: String
        let setting: String
        let metadata: Digest
        let payloadDigest: Digest
    }

    struct Seal: Equatable, Sendable {
        let schema: String
        let type: String
        let date: String
        let setting: String
        let title: String
        let content: String
        let metadata: String
        let payloadDigest: Digest
        let sealDigest: Digest

        func replacing(content: String) -> Seal {
            Seal(
                schema: schema,
                type: type,
                date: date,
                setting: setting,
                title: title,
                content: content,
                metadata: metadata,
                payloadDigest: payloadDigest,
                sealDigest: sealDigest
            )
        }
    }

    static func materialize(
        subjective: String,
        objective: String,
        assessment: String,
        plan: String,
        h1Digest: Digest,
        epochMilliseconds: Int64
    ) throws -> FieldSet {
        try validate(h1Digest, codec: h1DigestCodec)
        let date = try canonicalDate(epochMilliseconds)
        let sections = Sections(
            subjective: subjective,
            objective: objective,
            assessment: assessment,
            plan: plan
        )
        let content = encodeContent(sections)
        guard try decodeContent(content) == sections else { throw CodecError.invalidContent }
        let metadataJSON = h1Digest.canonicalJSON
        let payloadDigest = try framedDigest(codec: payloadDigestCodec, fields: [
            payloadDigestCodec,
            fieldSetSchema,
            h1DigestCodec,
            h1Digest.sha256.hex,
            "visit",
            "Voce clinica",
            date,
            content,
            "ambulatory",
            metadataJSON,
            absentAttachments,
        ])
        return FieldSet(
            schema: fieldSetSchema,
            type: "visit",
            title: "Voce clinica",
            date: date,
            content: content,
            setting: "ambulatory",
            metadata: h1Digest,
            payloadDigest: payloadDigest
        )
    }

    static func validate(_ fieldSet: FieldSet) throws {
        guard fieldSet.schema == fieldSetSchema,
              fieldSet.type == "visit",
              byteEqual(fieldSet.title, "Voce clinica"),
              fieldSet.setting == "ambulatory" else { throw CodecError.invalidInput }
        try validate(fieldSet.metadata, codec: h1DigestCodec)
        try validate(fieldSet.payloadDigest, codec: payloadDigestCodec)
        _ = try decodeContent(fieldSet.content)
        let expectedPayload = try framedDigest(codec: payloadDigestCodec, fields: [
            payloadDigestCodec,
            fieldSetSchema,
            h1DigestCodec,
            fieldSet.metadata.sha256.hex,
            "visit",
            "Voce clinica",
            fieldSet.date,
            fieldSet.content,
            "ambulatory",
            fieldSet.metadata.canonicalJSON,
            absentAttachments,
        ])
        guard expectedPayload == fieldSet.payloadDigest else { throw CodecError.invalidDigest }
    }

    static func validate(_ digest: Digest, codec: String) throws {
        guard digest.codec == codec,
              digest.sha256.bytes.count == 32,
              digest.sha256.hex.count == 64,
              digest.sha256.hex.unicodeScalars.allSatisfy({
                  ($0.value >= 48 && $0.value <= 57) || ($0.value >= 97 && $0.value <= 102)
              }),
              hex(digest.sha256.bytes) == digest.sha256.hex else { throw CodecError.invalidDigest }
    }

    static func framedDigest(codec: String, fields: [String]) throws -> Digest {
        var packet = Data()
        for field in fields {
            let bytes = Data(field.utf8)
            guard bytes.count <= Int(UInt32.max) else { throw CodecError.invalidInput }
            let count = UInt32(bytes.count)
            packet.append(contentsOf: [
                UInt8((count >> 24) & 0xff),
                UInt8((count >> 16) & 0xff),
                UInt8((count >> 8) & 0xff),
                UInt8(count & 0xff),
            ])
            packet.append(bytes)
        }
        let bytes = Array(SHA256.hash(data: packet))
        return Digest(codec: codec, sha256: SHA256Value(bytes: bytes, hex: hex(bytes)))
    }

    static func byteEqual(_ left: String, _ right: String) -> Bool {
        Data(left.utf8) == Data(right.utf8)
    }

    private static func hex(_ bytes: [UInt8]) -> String {
        let alphabet = Array("0123456789abcdef".utf8)
        var output = [UInt8]()
        output.reserveCapacity(bytes.count * 2)
        for byte in bytes {
            output.append(alphabet[Int(byte >> 4)])
            output.append(alphabet[Int(byte & 0x0f)])
        }
        return String(decoding: output, as: UTF8.self)
    }
}
