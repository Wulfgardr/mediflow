// Fase 0/1: shared structured 409 VERSION_CONFLICT contract (WUL-308).
// Extracted from the retired MediFlowMac LocalAPIClient. Today the live
// HomeBasePatientsClient collapses every non-2xx into a generic httpStatus and
// the UI only string-matches status == 409 to show a "reload required" message;
// it never surfaces expected-vs-current version. Fase 1 wires this payload into
// HomeBaseClientError (a .versionConflict case) and decodes it in send(), so the
// universal app can show a precise, targeted reconciliation instead.
// NOTE (verify in Fase 1): the dead client targeted the local mTLS /api/v1
// server; the live client targets the paired /api/v1/network surface. Confirm
// the paired backend emits this exact 409 body before relying on it.
import Foundation

// entity is "patient" or one of the clinical sub-resources
// (entry/therapy/checkup/observation); all five share this payload shape.
//
// BOTH directions are wired now. DECODE handles the home-base's 409 body and is
// robust to present-null vs absent. ENCODE (the native authority PRODUCES a 409 in
// the reversed flow: peer fan-out / home-base replacement) is custom, because
// Swift's default Encodable OMITS nil optionals whereas the web's payload shape
// keeps them:
//   - the payload ALWAYS includes currentVersion/currentUpdatedAt/currentSnapshot
//     (as explicit null in the "missing" state) — encodeNil, never encodeIfPresent;
//   - the snapshot is ENTITY-SPECIFIC: a patient snapshot is {id, version,
//     updatedAt, isArchived} (omits patientId/deletedAt); a clinical snapshot is
//     {id, patientId, version, updatedAt, deletedAt} (omits isArchived).
// The contract is the key SET + explicit nulls + entity-specific snapshot, matching
// lib/*-concurrency.ts; JSON key order is not part of it (no consumer depends on it,
// and Foundation's encoder order is not contractually stable). Drift originally
// flagged by the Fase 2 adversarial parity audit.
public struct VersionConflictPayload: Codable, Equatable {
    public let error: String
    public let code: String
    public let entity: String
    public let recordId: String
    public let expectedVersion: Int
    public let currentVersion: Int?
    public let currentUpdatedAt: String?
    public let currentState: String
    public let currentSnapshot: VersionConflictSnapshot?

    public init(error: String, code: String, entity: String, recordId: String,
                expectedVersion: Int, currentVersion: Int?, currentUpdatedAt: String?,
                currentState: String, currentSnapshot: VersionConflictSnapshot?) {
        self.error = error
        self.code = code
        self.entity = entity
        self.recordId = recordId
        self.expectedVersion = expectedVersion
        self.currentVersion = currentVersion
        self.currentUpdatedAt = currentUpdatedAt
        self.currentState = currentState
        self.currentSnapshot = currentSnapshot
    }

    private enum CodingKeys: String, CodingKey {
        case error, code, entity, recordId, expectedVersion
        case currentVersion, currentUpdatedAt, currentState, currentSnapshot
    }

    private enum SnapshotKey: String, CodingKey {
        case id, patientId, version, updatedAt, deletedAt, isArchived
    }

    // Custom encode: explicit nulls for the always-present current* fields, and an
    // entity-specific snapshot (patient vs clinical), matching the web payload shape.
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(error, forKey: .error)
        try container.encode(code, forKey: .code)
        try container.encode(entity, forKey: .entity)
        try container.encode(recordId, forKey: .recordId)
        try container.encode(expectedVersion, forKey: .expectedVersion)
        // ALWAYS present, as explicit JSON null in the "missing" state.
        try encodeOrNull(&container, currentVersion, forKey: .currentVersion)
        try encodeOrNull(&container, currentUpdatedAt, forKey: .currentUpdatedAt)
        try container.encode(currentState, forKey: .currentState)
        guard let snapshot = currentSnapshot else {
            try container.encodeNil(forKey: .currentSnapshot)
            return
        }
        var snap = container.nestedContainer(keyedBy: SnapshotKey.self, forKey: .currentSnapshot)
        try snap.encode(snapshot.id, forKey: .id)
        if entity == "patient" {
            // {id, version, updatedAt, isArchived}
            try snap.encode(snapshot.version, forKey: .version)
            try encodeOrNull(&snap, snapshot.updatedAt, forKey: .updatedAt)
            try encodeOrNull(&snap, snapshot.isArchived, forKey: .isArchived)
        } else {
            // clinical (entry/therapy/checkup/observation): {id, patientId, version, updatedAt, deletedAt}
            try encodeOrNull(&snap, snapshot.patientId, forKey: .patientId)
            try snap.encode(snapshot.version, forKey: .version)
            try encodeOrNull(&snap, snapshot.updatedAt, forKey: .updatedAt)
            try encodeOrNull(&snap, snapshot.deletedAt, forKey: .deletedAt)
        }
    }

    /// Encode an optional as its value or an explicit JSON null (never omitted).
    private func encodeOrNull<K: CodingKey, V: Encodable>(
        _ container: inout KeyedEncodingContainer<K>, _ value: V?, forKey key: K
    ) throws {
        if let value { try container.encode(value, forKey: key) }
        else { try container.encodeNil(forKey: key) }
    }
}

// Patient snapshots carry isArchived; clinical sub-resource snapshots carry
// patientId and deletedAt. The unused fields decode as nil.
public struct VersionConflictSnapshot: Decodable, Equatable {
    public let id: String
    public let patientId: String?
    public let version: Int
    public let updatedAt: String?
    public let deletedAt: String?
    public let isArchived: Bool?

    public init(id: String, patientId: String?, version: Int,
                updatedAt: String?, deletedAt: String?, isArchived: Bool?) {
        self.id = id
        self.patientId = patientId
        self.version = version
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
        self.isArchived = isArchived
    }
}
