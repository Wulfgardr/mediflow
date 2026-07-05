import Foundation

// ADR 0071 Fase 2: optimistic-concurrency authority for the clinical sub-resources
// (entry / therapy / checkup / observation). The four web files
// lib/{entry,therapy,checkup,observation}-concurrency.ts are byte-identical apart
// from the entity literal and share one snapshot shape, so they collapse into this
// single generic (the ADR's "one core, no duplication" goal). The patient entity
// keeps its own PatientConcurrency because its snapshot carries isArchived instead
// of patientId/deletedAt. Pure functions over a snapshot the store reads in a
// transaction; the 409 they emit is byte-identical with the web's.

public enum ClinicalConcurrency {
    /// 1:1 with parse{Entity}ExpectedVersion: a positive integer, else nil.
    public static func parseExpectedVersion(_ value: Int?) -> Int? {
        guard let value, value > 0 else { return nil }
        return value
    }

    /// The current persisted state a clinical conflict payload is built from:
    /// {id, patientId, version, updatedAt, deletedAt} (no isArchived).
    public struct ConflictSource: Equatable {
        public let id: String
        public let patientId: String
        public let version: Int
        public let updatedAt: Date?
        public let deletedAt: Date?

        public init(id: String, patientId: String, version: Int, updatedAt: Date?, deletedAt: Date?) {
            self.id = id
            self.patientId = patientId
            self.version = version
            self.updatedAt = updatedAt
            self.deletedAt = deletedAt
        }
    }

    public enum Verdict: Equatable {
        case ok(nextVersion: Int)              // version matched; the write may proceed
        case versionRequired                   // 400 "Version is required"
        case notFound                          // 404 "Not found"
        case conflict(VersionConflictPayload)  // 409 VERSION_CONFLICT
    }

    /// `entity` is the literal the web emits ("entry"/"therapy"/"checkup"/"observation"),
    /// so the 409 body matches lib/{entity}-concurrency.ts exactly. nil snapshot is the
    /// not-found path; a version mismatch on a present row is the 409 conflict; on
    /// success the next version is expected + 1.
    public static func evaluate(
        rawVersion: Int?, entity: String, recordId: String, current: ConflictSource?
    ) -> Verdict {
        guard let expected = parseExpectedVersion(rawVersion) else { return .versionRequired }
        guard let current else { return .notFound }
        if current.version != expected {
            return .conflict(buildVersionConflictPayload(
                entity: entity, expectedVersion: expected, recordId: recordId, current: current))
        }
        return .ok(nextVersion: expected + 1)
    }

    /// 1:1 with build{Entity}VersionConflictPayload. `current == nil` is the raced
    /// "missing" state; a present row yields the clinical snapshot. Exposed so the
    /// store can emit a missing-conflict if the row vanishes between read and write.
    public static func buildVersionConflictPayload(
        entity: String, expectedVersion: Int, recordId: String, current: ConflictSource?
    ) -> VersionConflictPayload {
        guard let current else {
            return VersionConflictPayload(
                error: "Conflict", code: "VERSION_CONFLICT", entity: entity, recordId: recordId,
                expectedVersion: expectedVersion, currentVersion: nil, currentUpdatedAt: nil,
                currentState: "missing", currentSnapshot: nil)
        }
        let currentUpdatedAt = isoConflictTimestamp(current.updatedAt)
        return VersionConflictPayload(
            error: "Conflict", code: "VERSION_CONFLICT", entity: entity, recordId: recordId,
            expectedVersion: expectedVersion, currentVersion: current.version,
            currentUpdatedAt: currentUpdatedAt, currentState: "present",
            currentSnapshot: VersionConflictSnapshot(
                id: current.id, patientId: current.patientId, version: current.version,
                updatedAt: currentUpdatedAt, deletedAt: isoConflictTimestamp(current.deletedAt),
                isArchived: nil))
    }
}
