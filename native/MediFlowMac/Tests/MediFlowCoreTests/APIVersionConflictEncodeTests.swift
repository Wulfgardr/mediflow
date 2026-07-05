import XCTest
@testable import MediFlowCore

/// ADR 0071 Fase 2 (NEXT STEP 2): encode parity for the 409 VERSION_CONFLICT body
/// the native authority now PRODUCES. The contract (vs lib/*-concurrency.ts):
///   - currentVersion/currentUpdatedAt/currentSnapshot are ALWAYS present, as
///     explicit JSON null in the "missing" state (Swift would otherwise omit nil);
///   - the snapshot is entity-specific: patient = {id, version, updatedAt,
///     isArchived}; clinical = {id, patientId, version, updatedAt, deletedAt}.
/// Asserted on the parsed JSON object (key set + nulls + values), order-independent.
final class APIVersionConflictEncodeTests: XCTestCase {

    private func encodeToObject(_ payload: VersionConflictPayload) throws -> [String: Any] {
        let data = try JSONEncoder().encode(payload)
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testPatientPresentSnapshotShapeAndValues() throws {
        let date = ISO8601DateFormatter().date(from: "2026-01-01T00:00:00Z")
        let payload = PatientConcurrency.buildVersionConflictPayload(
            expectedVersion: 3, recordId: "pat-1",
            current: PatientConcurrency.ConflictSource(
                id: "pat-1", version: 5, updatedAt: date, isArchived: false))

        let object = try encodeToObject(payload)
        XCTAssertEqual(object["error"] as? String, "Conflict")
        XCTAssertEqual(object["code"] as? String, "VERSION_CONFLICT")
        XCTAssertEqual(object["entity"] as? String, "patient")
        XCTAssertEqual(object["recordId"] as? String, "pat-1")
        XCTAssertEqual(object["expectedVersion"] as? Int, 3)
        XCTAssertEqual(object["currentVersion"] as? Int, 5)
        XCTAssertEqual(object["currentUpdatedAt"] as? String, "2026-01-01T00:00:00.000Z")
        XCTAssertEqual(object["currentState"] as? String, "present")

        let snapshot = try XCTUnwrap(object["currentSnapshot"] as? [String: Any])
        XCTAssertEqual(Set(snapshot.keys), ["id", "version", "updatedAt", "isArchived"])
        XCTAssertEqual(snapshot["id"] as? String, "pat-1")
        XCTAssertEqual(snapshot["version"] as? Int, 5)
        XCTAssertEqual(snapshot["updatedAt"] as? String, "2026-01-01T00:00:00.000Z")
        XCTAssertEqual(snapshot["isArchived"] as? Bool, false)
        // A patient snapshot must NOT leak the clinical fields.
        XCTAssertFalse(snapshot.keys.contains("patientId"))
        XCTAssertFalse(snapshot.keys.contains("deletedAt"))
    }

    func testMissingStateKeepsExplicitNulls() throws {
        let payload = PatientConcurrency.buildVersionConflictPayload(
            expectedVersion: 2, recordId: "pat-9", current: nil)

        let object = try encodeToObject(payload)
        XCTAssertEqual(object["currentState"] as? String, "missing")
        // Present-as-null, never omitted.
        XCTAssertTrue(object.keys.contains("currentVersion"))
        XCTAssertTrue(object.keys.contains("currentUpdatedAt"))
        XCTAssertTrue(object.keys.contains("currentSnapshot"))
        XCTAssertTrue(object["currentVersion"] is NSNull)
        XCTAssertTrue(object["currentUpdatedAt"] is NSNull)
        XCTAssertTrue(object["currentSnapshot"] is NSNull)
    }

    func testClinicalSnapshotShapeOmitsIsArchived() throws {
        // entry/therapy/checkup/observation share the clinical snapshot shape.
        let payload = VersionConflictPayload(
            error: "Conflict", code: "VERSION_CONFLICT", entity: "entry", recordId: "ent-1",
            expectedVersion: 4, currentVersion: 6, currentUpdatedAt: "2026-02-02T10:00:00.000Z",
            currentState: "present",
            currentSnapshot: VersionConflictSnapshot(
                id: "ent-1", patientId: "pat-1", version: 6,
                updatedAt: "2026-02-02T10:00:00.000Z", deletedAt: nil, isArchived: nil))

        let object = try encodeToObject(payload)
        XCTAssertEqual(object["entity"] as? String, "entry")
        let snapshot = try XCTUnwrap(object["currentSnapshot"] as? [String: Any])
        XCTAssertEqual(Set(snapshot.keys), ["id", "patientId", "version", "updatedAt", "deletedAt"])
        XCTAssertEqual(snapshot["patientId"] as? String, "pat-1")
        XCTAssertEqual(snapshot["version"] as? Int, 6)
        // deletedAt present-as-null (an active record), isArchived absent.
        XCTAssertTrue(snapshot.keys.contains("deletedAt"))
        XCTAssertTrue(snapshot["deletedAt"] is NSNull)
        XCTAssertFalse(snapshot.keys.contains("isArchived"))
    }

    func testEncodeDecodeRoundTrip() throws {
        let original = PatientConcurrency.buildVersionConflictPayload(
            expectedVersion: 1, recordId: "pat-7",
            current: PatientConcurrency.ConflictSource(
                id: "pat-7", version: 2, updatedAt: nil, isArchived: true))
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(VersionConflictPayload.self, from: data)
        XCTAssertEqual(decoded, original)
    }
}
