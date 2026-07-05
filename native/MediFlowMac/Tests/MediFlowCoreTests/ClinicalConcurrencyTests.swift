import XCTest
@testable import MediFlowCore

/// ADR 0071 Fase 2: the generic clinical optimistic-concurrency authority, 1:1 with
/// lib/{entry,therapy,checkup,observation}-concurrency.ts. Same shape as
/// PatientConcurrency but the snapshot is {id, patientId, version, updatedAt,
/// deletedAt} and the entity literal is parameterized.
final class ClinicalConcurrencyTests: XCTestCase {
    private typealias C = ClinicalConcurrency

    private func date(_ iso: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: iso)!
    }

    func testParseExpectedVersion() {
        XCTAssertNil(C.parseExpectedVersion(nil))
        XCTAssertNil(C.parseExpectedVersion(0))
        XCTAssertNil(C.parseExpectedVersion(-3))
        XCTAssertEqual(C.parseExpectedVersion(4), 4)
    }

    func testEvaluatePaths() {
        let current = C.ConflictSource(id: "e1", patientId: "p1", version: 5, updatedAt: nil, deletedAt: nil)
        // versionRequired (rawVersion invalid)
        XCTAssertEqual(C.evaluate(rawVersion: 0, entity: "entry", recordId: "e1", current: current), .versionRequired)
        // notFound (no snapshot)
        XCTAssertEqual(C.evaluate(rawVersion: 5, entity: "entry", recordId: "e1", current: nil), .notFound)
        // ok (match -> next version)
        XCTAssertEqual(C.evaluate(rawVersion: 5, entity: "entry", recordId: "e1", current: current), .ok(nextVersion: 6))
        // conflict (mismatch)
        guard case .conflict(let payload) = C.evaluate(rawVersion: 4, entity: "entry", recordId: "e1", current: current) else {
            return XCTFail("expected conflict")
        }
        XCTAssertEqual(payload.expectedVersion, 4)
        XCTAssertEqual(payload.currentVersion, 5)
        XCTAssertEqual(payload.entity, "entry")
    }

    func testPresentPayloadCarriesClinicalSnapshot() {
        let current = C.ConflictSource(
            id: "t1", patientId: "p9", version: 7,
            updatedAt: date("2026-03-03T09:00:00.000Z"), deletedAt: date("2026-03-04T09:00:00.000Z"))
        let payload = C.buildVersionConflictPayload(
            entity: "therapy", expectedVersion: 2, recordId: "t1", current: current)
        XCTAssertEqual(payload.entity, "therapy")
        XCTAssertEqual(payload.currentState, "present")
        XCTAssertEqual(payload.currentUpdatedAt, "2026-03-03T09:00:00.000Z")
        XCTAssertEqual(payload.currentSnapshot?.patientId, "p9")
        XCTAssertEqual(payload.currentSnapshot?.deletedAt, "2026-03-04T09:00:00.000Z")
        XCTAssertNil(payload.currentSnapshot?.isArchived)
    }

    func testMissingPayloadIsAllNull() {
        let payload = C.buildVersionConflictPayload(
            entity: "checkup", expectedVersion: 1, recordId: "c1", current: nil)
        XCTAssertEqual(payload.currentState, "missing")
        XCTAssertNil(payload.currentVersion)
        XCTAssertNil(payload.currentUpdatedAt)
        XCTAssertNil(payload.currentSnapshot)
    }

    func testEachEntityEncodesClinicalSnapshotShape() throws {
        for entity in ["entry", "therapy", "checkup", "observation"] {
            let current = C.ConflictSource(id: "x", patientId: "p", version: 3, updatedAt: nil, deletedAt: nil)
            let payload = C.buildVersionConflictPayload(
                entity: entity, expectedVersion: 1, recordId: "x", current: current)
            let data = try JSONEncoder().encode(payload)
            let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
            XCTAssertEqual(object["entity"] as? String, entity)
            let snapshot = try XCTUnwrap(object["currentSnapshot"] as? [String: Any])
            XCTAssertEqual(Set(snapshot.keys), ["id", "patientId", "version", "updatedAt", "deletedAt"],
                           "entity \(entity) must emit the clinical snapshot shape")
        }
    }
}
