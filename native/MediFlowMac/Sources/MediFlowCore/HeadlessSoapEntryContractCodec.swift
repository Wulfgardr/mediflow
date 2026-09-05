/* @Codex */
import Foundation

/// Language-neutral H9 DTO codec for ADR 0103. The values decoded here are
/// data only: this type has no transport, persistence or write authority.
enum HeadlessSoapEntryContractCodec {
    static let draftSchema = "mediflow.soap-draft.v1"
    static let operationId = "mediflow.clinical_diary.append_soap.v1"
    static let draftDigestCodec = "mediflow.headless.soap-draft-digest.v1"
    static let receiptSchema = "mediflow.headless.soap-entry-commit-receipt.v1"
    static let receiptOutcome = "entry_committed"
    static let receiptDigestCodec = "mediflow.headless.soap-entry-commit-receipt-digest.v1"

    static let draftKeys = [
        "schema", "operationId", "subjective", "objective", "assessment", "plan",
    ]
    static let receiptKeys = [
        "schema", "receiptRef", "operationId", "outcome", "commandId", "entryRef",
        "auditEventRef", "patientVersion", "entryVersion", "committedAt", "bindingDigest",
        "entryDigest", "auditDigest",
    ]

    enum CodecError: Error, Equatable {
        case invalidShape
        case invalidLiteral
        case invalidPattern
        case invalidVersion
        case invalidTimestamp
        case invalidDigestInput
    }

    struct Draft: Equatable, Sendable {
        let schema: String
        let operationId: String
        let subjective: String
        let objective: String
        let assessment: String
        let plan: String
    }

    struct Receipt: Equatable, Sendable {
        let schema: String
        let receiptRef: String
        let operationId: String
        let outcome: String
        let commandId: String
        let entryRef: String
        let auditEventRef: String
        let patientVersion: Int64
        let entryVersion: Int64
        let committedAt: String
        let bindingDigest: String
        let entryDigest: String
        let auditDigest: String
    }

    struct Digest: Equatable, Sendable {
        let codec: String
        let bytes: [UInt8]
        let hex: String
    }

    static func decodeDraft(_ data: Data) throws -> Draft {
        try requireClosedObject(data, keys: draftKeys)
        let wire: DraftWire
        do {
            wire = try JSONDecoder().decode(DraftWire.self, from: data)
        } catch {
            throw CodecError.invalidShape
        }
        let draft = Draft(
            schema: wire.schema,
            operationId: wire.operationId,
            subjective: wire.subjective,
            objective: wire.objective,
            assessment: wire.assessment,
            plan: wire.plan
        )
        try validate(draft)
        return draft
    }

    static func decodeReceipt(_ data: Data) throws -> Receipt {
        try requireClosedObject(data, keys: receiptKeys)
        let wire: ReceiptWire
        do {
            wire = try JSONDecoder().decode(ReceiptWire.self, from: data)
        } catch {
            throw CodecError.invalidShape
        }
        let receipt = Receipt(
            schema: wire.schema,
            receiptRef: wire.receiptRef,
            operationId: wire.operationId,
            outcome: wire.outcome,
            commandId: wire.commandId,
            entryRef: wire.entryRef,
            auditEventRef: wire.auditEventRef,
            patientVersion: wire.patientVersion,
            entryVersion: wire.entryVersion,
            committedAt: wire.committedAt,
            bindingDigest: wire.bindingDigest,
            entryDigest: wire.entryDigest,
            auditDigest: wire.auditDigest
        )
        try validate(receipt)
        return receipt
    }

    private struct DraftWire: Decodable {
        let schema: String
        let operationId: String
        let subjective: String
        let objective: String
        let assessment: String
        let plan: String
    }

    private struct ReceiptWire: Decodable {
        let schema: String
        let receiptRef: String
        let operationId: String
        let outcome: String
        let commandId: String
        let entryRef: String
        let auditEventRef: String
        let patientVersion: Int64
        let entryVersion: Int64
        let committedAt: String
        let bindingDigest: String
        let entryDigest: String
        let auditDigest: String
    }

    private static func requireClosedObject(_ data: Data, keys: [String]) throws {
        let value: Any
        do {
            value = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw CodecError.invalidShape
        }
        guard let object = value as? [String: Any],
              object.count == keys.count,
              Set(object.keys) == Set(keys) else {
            throw CodecError.invalidShape
        }
    }

    static func validate(_ draft: Draft) throws {
        guard draft.schema == draftSchema, draft.operationId == operationId else {
            throw CodecError.invalidLiteral
        }
    }

    static func validate(_ receipt: Receipt) throws {
        guard receipt.schema == receiptSchema,
              receipt.operationId == operationId,
              receipt.outcome == receiptOutcome else {
            throw CodecError.invalidLiteral
        }
        guard matches(receipt.receiptRef, prefix: "hser_"),
              matches(receipt.commandId, prefix: "hsac_"),
              matches(receipt.entryRef, prefix: "hsei_"),
              matches(receipt.auditEventRef, prefix: "hsea_"),
              isLowerHexDigest(receipt.bindingDigest),
              isLowerHexDigest(receipt.entryDigest),
              isLowerHexDigest(receipt.auditDigest) else {
            throw CodecError.invalidPattern
        }
        let maximumSafeInteger: Int64 = 9_007_199_254_740_991
        guard receipt.patientVersion >= 1,
              receipt.patientVersion <= maximumSafeInteger,
              receipt.entryVersion == 1 else {
            throw CodecError.invalidVersion
        }
        guard isCanonicalTimestamp(receipt.committedAt) else {
            throw CodecError.invalidTimestamp
        }
    }

    private static func matches(_ value: String, prefix: String) -> Bool {
        let bytes = Array(value.utf8)
        let prefixBytes = Array(prefix.utf8)
        guard bytes.count == prefixBytes.count + 64,
              bytes.starts(with: prefixBytes) else {
            return false
        }
        return bytes.dropFirst(prefixBytes.count).allSatisfy(isLowerHexByte)
    }

    private static func isLowerHexDigest(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        return bytes.count == 64 && bytes.allSatisfy(isLowerHexByte)
    }

    private static func isLowerHexByte(_ byte: UInt8) -> Bool {
        (byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102)
    }

    private static func isCanonicalTimestamp(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard bytes.count == 24,
              bytes[4] == 45, bytes[7] == 45, bytes[10] == 84,
              bytes[13] == 58, bytes[16] == 58, bytes[19] == 46,
              bytes[20] == 48, bytes[21] == 48, bytes[22] == 48,
              bytes[23] == 90,
              let year = decimal(bytes, 0, 4),
              let month = decimal(bytes, 5, 2),
              let day = decimal(bytes, 8, 2),
              let hour = decimal(bytes, 11, 2),
              let minute = decimal(bytes, 14, 2),
              let second = decimal(bytes, 17, 2),
              month >= 1, month <= 12,
              hour <= 23, minute <= 59, second <= 59 else {
            return false
        }
        let leap = year.isMultiple(of: 400) || (year.isMultiple(of: 4) && !year.isMultiple(of: 100))
        let days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        return day >= 1 && day <= days[month - 1]
    }

    private static func decimal(_ bytes: [UInt8], _ offset: Int, _ length: Int) -> Int? {
        var value = 0
        for byte in bytes[offset..<(offset + length)] {
            guard byte >= 48, byte <= 57 else { return nil }
            value = value * 10 + Int(byte - 48)
        }
        return value
    }

}
