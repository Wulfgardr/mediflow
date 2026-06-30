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
// DECODE is the only direction wired today: this decodes the home-base's 409 body,
// and decoding is robust to present-null vs absent. ENCODE PARITY (Fase 3, when the
// native authority PRODUCES + serializes a 409) requires custom Encodable to match
// the web's JSON.stringify byte-for-byte, because Swift's default Encodable OMITS
// nil optionals whereas the web includes explicit nulls:
//   - the payload ALWAYS includes currentVersion/currentUpdatedAt/currentSnapshot
//     (as explicit null in the "missing" state) — do NOT use encodeIfPresent there;
//   - the snapshot is ENTITY-SPECIFIC: a patient snapshot is {id, version,
//     updatedAt, isArchived} (omits patientId/deletedAt); a clinical snapshot is
//     {id, patientId, version, updatedAt, deletedAt} (omits isArchived).
// Verified by the Fase 2 adversarial parity audit (the only real-drift found).
public struct VersionConflictPayload: Decodable, Equatable {
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
