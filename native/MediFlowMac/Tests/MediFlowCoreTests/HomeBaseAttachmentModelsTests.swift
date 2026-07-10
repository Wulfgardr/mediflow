import Crypto
import Foundation
import XCTest
@testable import MediFlowCore

final class HomeBaseAttachmentModelsTests: XCTestCase {
    private let masterKey = SymmetricKey(data: Data(repeating: 7, count: 32))

    func testAttachmentReferenceValidatorAcceptsOwnedIds() throws {
        let referenced = ["attachment-2", "attachment-1"]

        XCTAssertEqual(
            try HomeBaseAttachmentReferenceValidator.validate(
                patientAttachmentIds: ["attachment-1", "attachment-2", "attachment-3"],
                referencedAttachmentIds: referenced
            ),
            referenced
        )

        let sealed = try ClinicalFieldCrypto.sealEntryAttachmentReferences(
            patientAttachmentIds: ["attachment-1", "attachment-2"],
            referencedAttachmentIds: referenced,
            masterKey: masterKey
        )
        let value = try XCTUnwrap(sealed.encodedValue)
        XCTAssertTrue(value.hasPrefix(CryptoService.encPrefix))
        let decrypted = try XCTUnwrap(CryptoService.decryptField(value, masterKey: masterKey))
        XCTAssertEqual(
            try JSONDecoder().decode([String].self, from: Data(decrypted.utf8)),
            referenced
        )
    }

    func testAttachmentReferenceValidatorRejectsForeignIdBeforeSealing() {
        XCTAssertThrowsError(
            try ClinicalFieldCrypto.sealEntryAttachmentReferences(
                patientAttachmentIds: ["attachment-1"],
                referencedAttachmentIds: ["attachment-1", "foreign-attachment"],
                masterKey: masterKey
            )
        ) { error in
            XCTAssertEqual(
                error as? HomeBaseAttachmentCryptoError,
                .attachmentNotOwned(["foreign-attachment"])
            )
        }
    }

    func testEmptyAttachmentReferencesEncodeAsEntryClear() throws {
        let references = try ClinicalFieldCrypto.sealEntryAttachmentReferences(
            patientAttachmentIds: [],
            referencedAttachmentIds: [],
            masterKey: masterKey
        )
        XCTAssertTrue(references.isClear)

        let payload = HomeBaseEntryUpdatePayload(version: 4, attachmentReferences: references)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any]
        )
        XCTAssertTrue(object.keys.contains("attachments"))
        XCTAssertEqual(object["attachments"] as? NSNull, NSNull())
    }

    func testLargeSealedAttachmentDetailEncodesAndDecodes() throws {
        let largePayload = "ENC:synthetic:" + String(repeating: "A", count: 5 * 1_024 * 1_024)
        let detail = HomeBaseAttachmentDetail(
            id: "attachment-large",
            patientId: "patient-1",
            name: "ENC:name:value",
            type: "application/pdf",
            size: 5 * 1_024 * 1_024,
            path: "ENC:path:value",
            summarySnapshot: nil,
            parseEvidenceArtifactSnapshot: nil,
            ocrQueueState: .pending,
            ocrQueueReason: .pairedUpload,
            ocrQueueUpdatedAt: Date(timeIntervalSince1970: 1_752_000_000.123),
            ocrReplayArtifactSnapshot: nil,
            createdAt: Date(timeIntervalSince1970: 1_752_000_001.456),
            data: largePayload
        )

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let encoded = try encoder.encode(detail)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = HomeBaseDateCoding.tolerantISO8601Strategy
        let decoded = try decoder.decode(HomeBaseAttachmentDetail.self, from: encoded)

        XCTAssertEqual(decoded.data?.count, largePayload.count)
        XCTAssertEqual(decoded.id, detail.id)
        XCTAssertEqual(decoded.size, detail.size)
        XCTAssertEqual(decoded.ocrQueueState, .pending)
        XCTAssertEqual(decoded.ocrQueueReason, .pairedUpload)
    }

    // @Codex: a decrypted attachment name is client-controlled. Sharing must
    // never let path components escape the owned temporary directory or let a
    // same-name share overwrite a previous file.
    func testAttachmentShareFileConfinesNamesAndUsesFreshDirectories() throws {
        let testRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("HomeBaseAttachmentShareFileTests-\(UUID().uuidString)", isDirectory: true)
        let ownedDirectory = testRoot.appendingPathComponent("owned", isDirectory: true)
        let sentinel = testRoot.appendingPathComponent("sentinel.txt", isDirectory: false)
        defer { try? FileManager.default.removeItem(at: testRoot) }

        try FileManager.default.createDirectory(at: ownedDirectory, withIntermediateDirectories: true)
        try Data("sentinel".utf8).write(to: sentinel)

        let first = try HomeBaseAttachmentShareFile.write(
            bytes: Data("first".utf8),
            suggestedName: "../sentinel.txt",
            to: ownedDirectory
        )
        let second = try HomeBaseAttachmentShareFile.write(
            bytes: Data("second".utf8),
            suggestedName: "sentinel.txt",
            to: ownedDirectory
        )

        XCTAssertEqual(try Data(contentsOf: sentinel), Data("sentinel".utf8))
        XCTAssertEqual(first.lastPathComponent, "sentinel.txt")
        XCTAssertEqual(second.lastPathComponent, "sentinel.txt")
        XCTAssertNotEqual(first.deletingLastPathComponent(), second.deletingLastPathComponent())
        XCTAssertEqual(first.deletingLastPathComponent().deletingLastPathComponent(), ownedDirectory.standardizedFileURL)
        XCTAssertEqual(second.deletingLastPathComponent().deletingLastPathComponent(), ownedDirectory.standardizedFileURL)
        XCTAssertEqual(try Data(contentsOf: first), Data("first".utf8))
        XCTAssertEqual(try Data(contentsOf: second), Data("second".utf8))
    }
}
