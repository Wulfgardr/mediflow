/* @Codex */
import Crypto
import Foundation

/// Byte-exact canonical JSON and digest half of the language-neutral H9 codec.
extension HeadlessSoapEntryContractCodec {
    static func canonicalDraftJSON(_ draft: Draft) throws -> String {
        try validate(draft)
        return objectJSON([
            stringPair("schema", draft.schema),
            stringPair("operationId", draft.operationId),
            stringPair("subjective", draft.subjective),
            stringPair("objective", draft.objective),
            stringPair("assessment", draft.assessment),
            stringPair("plan", draft.plan),
        ])
    }

    static func canonicalReceiptJSON(_ receipt: Receipt) throws -> String {
        try validate(receipt)
        return objectJSON([
            stringPair("schema", receipt.schema),
            stringPair("receiptRef", receipt.receiptRef),
            stringPair("operationId", receipt.operationId),
            stringPair("outcome", receipt.outcome),
            stringPair("commandId", receipt.commandId),
            stringPair("entryRef", receipt.entryRef),
            stringPair("auditEventRef", receipt.auditEventRef),
            numberPair("patientVersion", receipt.patientVersion),
            numberPair("entryVersion", receipt.entryVersion),
            stringPair("committedAt", receipt.committedAt),
            stringPair("bindingDigest", receipt.bindingDigest),
            stringPair("entryDigest", receipt.entryDigest),
            stringPair("auditDigest", receipt.auditDigest),
        ])
    }

    static func draftDigest(_ draft: Draft) throws -> Digest {
        try validate(draft)
        return try framedDigest(
            codec: draftDigestCodec,
            fields: [
                draft.schema,
                draft.operationId,
                draft.subjective,
                draft.objective,
                draft.assessment,
                draft.plan,
            ]
        )
    }

    static func receiptDigest(_ receipt: Receipt) throws -> Digest {
        let canonical = try canonicalReceiptJSON(receipt)
        var packet = Data(receiptDigestCodec.utf8)
        packet.append(0)
        packet.append(contentsOf: canonical.utf8)
        return digest(codec: receiptDigestCodec, packet: packet)
    }

    private static func framedDigest(codec: String, fields: [String]) throws -> Digest {
        var packet = Data()
        for field in fields {
            let bytes = Data(field.utf8)
            guard bytes.count <= Int(UInt32.max) else {
                throw CodecError.invalidDigestInput
            }
            let count = UInt32(bytes.count)
            packet.append(contentsOf: [
                UInt8((count >> 24) & 0xff),
                UInt8((count >> 16) & 0xff),
                UInt8((count >> 8) & 0xff),
                UInt8(count & 0xff),
            ])
            packet.append(bytes)
        }
        return digest(codec: codec, packet: packet)
    }

    private static func digest(codec: String, packet: Data) -> Digest {
        let bytes = Array(SHA256.hash(data: packet))
        return Digest(codec: codec, bytes: bytes, hex: hex(bytes))
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

    private static func objectJSON(_ pairs: [String]) -> String {
        "{" + pairs.joined(separator: ",") + "}"
    }

    private static func stringPair(_ key: String, _ value: String) -> String {
        jsonString(key) + ":" + jsonString(value)
    }

    private static func numberPair(_ key: String, _ value: Int64) -> String {
        jsonString(key) + ":" + String(value)
    }

    /// Matches JSON.stringify for Swift's valid Unicode scalar strings while
    /// keeping property order under the codec's explicit control.
    private static func jsonString(_ value: String) -> String {
        var output = "\""
        for scalar in value.unicodeScalars {
            switch scalar.value {
            case 0x08: output += "\\b"
            case 0x09: output += "\\t"
            case 0x0a: output += "\\n"
            case 0x0c: output += "\\f"
            case 0x0d: output += "\\r"
            case 0x22: output += "\\\""
            case 0x5c: output += "\\\\"
            case 0x00...0x1f:
                let digits = Array("0123456789abcdef")
                output += "\\u00"
                output.append(digits[Int((scalar.value >> 4) & 0x0f)])
                output.append(digits[Int(scalar.value & 0x0f)])
            default:
                output.unicodeScalars.append(scalar)
            }
        }
        output.append("\"")
        return output
    }
}
