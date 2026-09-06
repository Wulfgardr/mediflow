import XCTest
@testable import MediFlowAppleShared

/* @Codex */
final class PatientArchiveContractsTests: XCTestCase {
    func testArchivePatchDistinguishesOmitNullAndSealedValue() throws {
        let cases: [(HomeBasePatientUpdatePayload, Set<String>)] = [
            (.init(version: 4), ["version"]),
            (.init(version: 4, archiveReason: .null, archiveNote: .null), ["version", "archiveReason", "archiveNote"]),
            (.init(version: 4, isArchived: true, archiveReason: .value("ENC:reason:sealed"),
                   archiveNote: .value("ENC:note:sealed")), ["version", "isArchived", "archiveReason", "archiveNote"]),
        ]
        for (payload, expectedKeys) in cases {
            let data = try JSONEncoder().encode(payload)
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            XCTAssertEqual(Set(object.keys), expectedKeys)
            switch payload.archiveReason {
            case .omit: XCTAssertNil(object["archiveReason"])
            case .null: XCTAssertTrue(object["archiveReason"] is NSNull); XCTAssertTrue(object["archiveNote"] is NSNull)
            case .value: XCTAssertEqual(object["archiveReason"] as? String, "ENC:reason:sealed")
                XCTAssertEqual(object["archiveNote"] as? String, "ENC:note:sealed")
            }
        }
    }

    func testArchiveDetailReadsBothFieldsAndAllowsLegacyMissingFields() throws {
        for fields in ["", #", "archiveReason":"ENC:reason:sealed", "archiveNote":"ENC:note:sealed""#] {
            let data = Data("{\"id\":\"p1\",\"firstName\":\"Test\",\"lastName\":\"Sintetico\",\"taxCode\":\"SYNTHETIC\",\"version\":1\(fields)}".utf8)
            let detail = try JSONDecoder().decode(HomeBasePatientDetail.self, from: data)
            XCTAssertEqual(detail.archiveReason, fields.isEmpty ? nil : "ENC:reason:sealed")
            XCTAssertEqual(detail.archiveNote, fields.isEmpty ? nil : "ENC:note:sealed")
        }
    }
}

final class APIPatchValueTests: XCTestCase {
    private struct Patch: Encodable {
        let name: PatchValue<String>
        let note: PatchValue<String>
        enum CodingKeys: String, CodingKey { case name, note }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encodePatch(name, forKey: .name)
            try c.encodePatch(note, forKey: .note)
        }
    }

    private func object(_ patch: Patch) throws -> [String: Any] {
        let data = try JSONEncoder().encode(patch)
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }

    func testOmitDropsTheKeyEntirely() throws {
        let json = try object(Patch(name: .omit, note: .value("x")))
        XCTAssertFalse(json.keys.contains("name"))
        XCTAssertEqual(json["note"] as? String, "x")
    }

    func testNullEncodesAnExplicitJSONNull() throws {
        let data = try JSONEncoder().encode(Patch(name: .null, note: .omit))
        let raw = String(data: data, encoding: .utf8)!
        XCTAssertTrue(raw.contains("\"name\":null"))
        XCTAssertFalse(raw.contains("note"))
    }

    func testValueEncodesTheWrappedPayload() throws {
        let json = try object(Patch(name: .value("Mario"), note: .null))
        XCTAssertEqual(json["name"] as? String, "Mario")
        XCTAssertTrue(json["note"] is NSNull)
    }
}

final class APIVersionConflictTests: XCTestCase {
    func testDecodesPatientConflictWithSnapshot() throws {
        let body = """
        {
          "error": "Version conflict",
          "code": "VERSION_CONFLICT",
          "entity": "patient",
          "recordId": "p1",
          "expectedVersion": 3,
          "currentVersion": 5,
          "currentUpdatedAt": "2026-06-28T10:00:00Z",
          "currentState": "active",
          "currentSnapshot": { "id": "p1", "version": 5, "isArchived": false }
        }
        """.data(using: .utf8)!
        let payload = try JSONDecoder().decode(VersionConflictPayload.self, from: body)
        XCTAssertEqual(payload.code, "VERSION_CONFLICT")
        XCTAssertEqual(payload.entity, "patient")
        XCTAssertEqual(payload.expectedVersion, 3)
        XCTAssertEqual(payload.currentVersion, 5)
        XCTAssertEqual(payload.currentSnapshot?.id, "p1")
        XCTAssertEqual(payload.currentSnapshot?.isArchived, false)
        XCTAssertNil(payload.currentSnapshot?.patientId)
    }

    func testDecodesSubResourceConflictWithNilOptionals() throws {
        let body = """
        {
          "error": "Version conflict",
          "code": "VERSION_CONFLICT",
          "entity": "therapy",
          "recordId": "t1",
          "expectedVersion": 1,
          "currentVersion": null,
          "currentUpdatedAt": null,
          "currentState": "deleted",
          "currentSnapshot": { "id": "t1", "patientId": "p1", "version": 2, "deletedAt": "2026-06-28T10:00:00Z" }
        }
        """.data(using: .utf8)!
        let payload = try JSONDecoder().decode(VersionConflictPayload.self, from: body)
        XCTAssertEqual(payload.entity, "therapy")
        XCTAssertNil(payload.currentVersion)
        XCTAssertEqual(payload.currentSnapshot?.patientId, "p1")
        XCTAssertEqual(payload.currentSnapshot?.deletedAt, "2026-06-28T10:00:00Z")
        XCTAssertNil(payload.currentSnapshot?.isArchived)
    }
}
