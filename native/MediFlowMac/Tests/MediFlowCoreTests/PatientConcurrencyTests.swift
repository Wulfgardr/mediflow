import XCTest
@testable import MediFlowCore

/// ADR 0071 Fase 2: parity tests for the optimistic-concurrency authority logic
/// ported from lib/patient-concurrency.ts. The 409 payload must match the web.
final class PatientConcurrencyTests: XCTestCase {
    typealias C = PatientConcurrency

    private func date(_ iso: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: iso)!
    }

    func testParseExpectedVersion() {
        XCTAssertEqual(C.parseExpectedVersion(1), 1)
        XCTAssertEqual(C.parseExpectedVersion(7), 7)
        XCTAssertNil(C.parseExpectedVersion(0))
        XCTAssertNil(C.parseExpectedVersion(-3))
        XCTAssertNil(C.parseExpectedVersion(nil))
    }

    func testToIsoStringMatchesJSDateToISOString() {
        XCTAssertEqual(C.toIsoString(date("2026-06-29T10:15:00.000Z")), "2026-06-29T10:15:00.000Z")
        XCTAssertNil(C.toIsoString(nil))
    }

    func testEvaluateVersionRequired() {
        XCTAssertEqual(C.evaluate(rawVersion: nil, recordId: "p1", current: nil), .versionRequired)
        XCTAssertEqual(C.evaluate(rawVersion: 0, recordId: "p1", current: nil), .versionRequired)
    }

    func testEvaluateNotFound() {
        XCTAssertEqual(C.evaluate(rawVersion: 2, recordId: "p1", current: nil), .notFound)
    }

    func testEvaluateOkBumpsVersion() {
        let current = C.ConflictSource(id: "p1", version: 2, updatedAt: date("2026-06-29T10:15:00.000Z"), isArchived: false)
        XCTAssertEqual(C.evaluate(rawVersion: 2, recordId: "p1", current: current), .ok(nextVersion: 3))
    }

    func testEvaluateConflictPresent() {
        let current = C.ConflictSource(id: "p1", version: 3, updatedAt: date("2026-06-29T10:15:00.000Z"), isArchived: true)
        guard case let .conflict(payload) = C.evaluate(rawVersion: 1, recordId: "p1", current: current) else {
            return XCTFail("expected conflict")
        }
        XCTAssertEqual(payload.code, "VERSION_CONFLICT")
        XCTAssertEqual(payload.entity, "patient")
        XCTAssertEqual(payload.recordId, "p1")
        XCTAssertEqual(payload.expectedVersion, 1)
        XCTAssertEqual(payload.currentVersion, 3)
        XCTAssertEqual(payload.currentUpdatedAt, "2026-06-29T10:15:00.000Z")
        XCTAssertEqual(payload.currentState, "present")
        XCTAssertEqual(payload.currentSnapshot?.id, "p1")
        XCTAssertEqual(payload.currentSnapshot?.version, 3)
        XCTAssertEqual(payload.currentSnapshot?.isArchived, true)
        XCTAssertNil(payload.currentSnapshot?.patientId)
    }

    func testBuildMissingConflictPayload() {
        let payload = C.buildVersionConflictPayload(expectedVersion: 4, recordId: "p9", current: nil)
        XCTAssertEqual(payload.currentState, "missing")
        XCTAssertNil(payload.currentVersion)
        XCTAssertNil(payload.currentUpdatedAt)
        XCTAssertNil(payload.currentSnapshot)
        XCTAssertEqual(payload.expectedVersion, 4)
        XCTAssertEqual(payload.recordId, "p9")
    }
}
