import Foundation

// ADR 0071 Fase 2: optimistic-concurrency authority logic, ported 1:1 from
// lib/patient-concurrency.ts. Pure functions over a snapshot the store reads in a
// transaction; they produce the same VersionConflictPayload the web emits, so a
// 409 is byte-identical on both sides. The store owns the transaction/SQL; the
// conflict policy lives here (Codex review: never bury it in SQL helpers).

public enum PatientConcurrency {
    /// 1:1 with parseExpectedVersion: a positive integer, else nil. (In Swift the
    /// "is integer" half of the web check is the type; only the > 0 guard remains.)
    public static func parseExpectedVersion(_ value: Int?) -> Int? {
        guard let value, value > 0 else { return nil }
        return value
    }

    /// The current persisted state a conflict payload is built from. A patient
    /// snapshot carries isArchived (clinical sub-resources will carry patientId /
    /// deletedAt in their own port).
    public struct ConflictSource: Equatable {
        public let id: String
        public let version: Int
        public let updatedAt: Date?
        public let isArchived: Bool?

        public init(id: String, version: Int, updatedAt: Date?, isArchived: Bool?) {
            self.id = id
            self.version = version
            self.updatedAt = updatedAt
            self.isArchived = isArchived
        }
    }

    public enum Verdict: Equatable {
        case ok(nextVersion: Int)                  // version matched; the write may proceed
        case versionRequired                       // 400 "Version is required"
        case notFound                              // 404 "Not found" (no row in scope)
        case conflict(VersionConflictPayload)      // 409 VERSION_CONFLICT
    }

    /// Optimistic concurrency over a definitive snapshot. nil snapshot is the
    /// not-found path (the web SELECT miss -> 404); a version mismatch on a present
    /// row is the 409 conflict. On success the next version is expected + 1.
    public static func evaluate(rawVersion: Int?, recordId: String, current: ConflictSource?) -> Verdict {
        guard let expected = parseExpectedVersion(rawVersion) else { return .versionRequired }
        guard let current else { return .notFound }
        if current.version != expected {
            return .conflict(buildVersionConflictPayload(expectedVersion: expected, recordId: recordId, current: current))
        }
        return .ok(nextVersion: expected + 1)
    }

    /// 1:1 with buildPatientVersionConflictPayload. `current == nil` is the raced
    /// "missing" state (currentState = "missing"); a present row yields a full
    /// snapshot. Exposed so the store can emit a missing-conflict if the row
    /// vanishes between read and write.
    public static func buildVersionConflictPayload(
        expectedVersion: Int,
        recordId: String,
        current: ConflictSource?
    ) -> VersionConflictPayload {
        guard let current else {
            return VersionConflictPayload(
                error: "Conflict", code: "VERSION_CONFLICT", entity: "patient", recordId: recordId,
                expectedVersion: expectedVersion, currentVersion: nil, currentUpdatedAt: nil,
                currentState: "missing", currentSnapshot: nil)
        }
        let currentUpdatedAt = isoConflictTimestamp(current.updatedAt)
        return VersionConflictPayload(
            error: "Conflict", code: "VERSION_CONFLICT", entity: "patient", recordId: recordId,
            expectedVersion: expectedVersion, currentVersion: current.version, currentUpdatedAt: currentUpdatedAt,
            currentState: "present",
            currentSnapshot: VersionConflictSnapshot(
                id: current.id, patientId: nil, version: current.version,
                updatedAt: currentUpdatedAt, deletedAt: nil, isArchived: current.isArchived))
    }

    /// JS Date.toISOString() equivalent; delegates to the shared conflict-timestamp
    /// formatter (see isoConflictTimestamp in APIVersionConflict.swift).
    static func toIsoString(_ value: Date?) -> String? { isoConflictTimestamp(value) }
}
