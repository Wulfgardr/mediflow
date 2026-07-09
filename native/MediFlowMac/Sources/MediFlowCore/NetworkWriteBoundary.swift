import Foundation

// ADR 0071 Fase 2: the network write-boundary authority logic, ported 1:1 from
// lib/network-*-write.ts. These are the rules the native app enforces LOCALLY once
// it becomes the write authority (reversed flow): a write must not carry
// AI/document-derived fields, must not set server-controlled fields, and (patient)
// must stay in ambulatory scope. Pure logic over the set of field names present in
// a write body; the persistence/conflict/commit layer is separate (GRDB, later).
// The byte-for-byte status codes and copy match the web so a write rejected here is
// rejected identically there.

public enum NetworkWriteBoundary {
    public enum Verdict: Equatable {
        case allowed
        case rejected(status: Int, error: String)
    }

    // MARK: Patient (lib/network-patient-write.ts validateNetworkPatientMutationBoundary)

    public static let patientWriteCapability = "network.replica.write-patient-profile"
    public static let patientLifecycleCapability = "network.replica.write-patient-lifecycle"
    /// Ordered to match the web Set's insertion order (the copy is field-agnostic,
    /// but the order keeps the port faithful).
    public static let forbiddenPatientWriteFields = ["aiSummary", "documentInsights"]
    public static let patientCreateServerControlledFields = [
        "version", "createdAt", "updatedAt", "isArchived", "deletedAt",
    ]
    public static let patientCreateSensitiveFields = [
        "address", "phone", "caregiver", "exemptions", "diagnoses",
        "statusReason", "notes",
    ]

    /// `presentFields`: names present in the write body. `ambulatoryIdInBody`:
    /// `.omit` when 'ambulatoryId' is absent, else `.null`/`.value` mirroring the
    /// JSON (a present null still fails the `!== scope` check, exactly like the web).
    public static func validatePatient(
        presentFields: Set<String>,
        ambulatoryIdInBody: PatchValue<String>,
        scopeAmbulatoryId: String
    ) -> Verdict {
        for field in forbiddenPatientWriteFields where presentFields.contains(field) {
            return .rejected(status: 403, error: "Network patient write boundary excludes AI fields")
        }
        switch ambulatoryIdInBody {
        case .omit:
            break
        case .null:
            return .rejected(status: 403, error: "Network scope violation")
        case .value(let value):
            if value != scopeAmbulatoryId {
                return .rejected(status: 403, error: "Network scope violation")
            }
        }
        return .allowed
    }

    public static func validatePatientCreate(
        presentFields: Set<String>,
        sensitiveValues: [String: String?]
    ) -> Verdict {
        for field in forbiddenPatientWriteFields where presentFields.contains(field) {
            return .rejected(status: 403, error: "Network patient write boundary excludes AI fields")
        }
        for field in patientCreateServerControlledFields where presentFields.contains(field) {
            return .rejected(status: 400, error: "Network patient create boundary rejects client-controlled \(field)")
        }
        for field in patientCreateSensitiveFields where presentFields.contains(field) {
            guard let encoded = sensitiveValues[field], let value = encoded else { continue }
            if !value.hasPrefix("ENC:") {
                return .rejected(status: 400, error: "Network create requires sealed sensitive fields")
            }
        }
        return .allowed
    }

    // MARK: Clinical sub-resources (entry/therapy/checkup/observation)

    public enum SubResource: String, CaseIterable {
        case entry
        case therapy
        case checkup
        case observation

        /// The label used in the boundary error copy ("diary" for entries).
        public var label: String { self == .entry ? "diary" : rawValue }
    }

    public enum Mode {
        case create
        case update
    }

    public static let forbiddenSubResourceWriteFields =
        ["aiSummary", "documentInsights", "documentInsightId", "sourceDocumentId"]

    /// Server-controlled fields a client may not set. Entries carry no soft-delete
    /// columns on create; therapy/checkup/observation do.
    public static func forbiddenClientFields(_ resource: SubResource, _ mode: Mode) -> [String] {
        switch mode {
        case .create:
            return resource == .entry
                ? ["patientId", "createdAt", "updatedAt", "version"]
                : ["patientId", "createdAt", "updatedAt", "version", "deletedAt", "deletionReason"]
        case .update:
            return ["patientId", "createdAt", "updatedAt"]
        }
    }

    /// `attachmentsNonEmpty`: the caller's equivalent of !isEmptyAttachmentValue
    /// (entry only). Only consulted when 'attachments' is in `presentFields`.
    public static func validateSubResource(
        _ resource: SubResource,
        mode: Mode,
        presentFields: Set<String>,
        attachmentsNonEmpty: Bool = false
    ) -> Verdict {
        let label = resource.label
        for field in forbiddenSubResourceWriteFields where presentFields.contains(field) {
            return .rejected(status: 403, error: "Network \(label) write boundary excludes AI/document-derived fields")
        }
        for field in forbiddenClientFields(resource, mode) where presentFields.contains(field) {
            return .rejected(status: 400, error: "Network \(label) write boundary rejects client-controlled \(field)")
        }
        if resource == .entry, presentFields.contains("attachments"), attachmentsNonEmpty {
            return .rejected(status: 403, error: "Network diary write boundary excludes attachment writes")
        }
        return .allowed
    }

    // MARK: Prescriptions and FSE validation

    public static let servicePrescriptionReadCapability = "network.replica.readonly-service-prescriptions"
    public static let servicePrescriptionWriteCapability = "network.replica.write-service-prescriptions"
    public static let prostheticPrescriptionReadCapability = "network.replica.readonly-prosthetic-prescriptions"
    public static let prostheticPrescriptionWriteCapability = "network.replica.write-prosthetic-prescriptions"
    public static let fseValidateCapability = "network.fse.validate"

    public enum PrescriptionFamily: String {
        case servicePrescription = "service prescription"
        case servicePrescriptionItem = "service prescription item"
        case prostheticPrescription = "prosthetic prescription"
    }

    public static let forbiddenPrescriptionWriteFields =
        ["aiSummary", "documentInsights", "documentInsightId", "sourceDocumentId"]

    public static let prescriptionCreateServerControlledFields = [
        "version", "createdAt", "updatedAt",
    ]

    public static let prescriptionUpdateServerControlledFields = [
        "createdAt", "updatedAt",
    ]

    public static func validatePrescription(
        _ family: PrescriptionFamily,
        mode: Mode,
        presentFields: Set<String>
    ) -> Verdict {
        for field in forbiddenPrescriptionWriteFields where presentFields.contains(field) {
            return .rejected(status: 403, error: "Network \(family.rawValue) write boundary excludes AI/document-derived fields")
        }
        let serverControlled = mode == .create
            ? prescriptionCreateServerControlledFields
            : prescriptionUpdateServerControlledFields
        for field in serverControlled where presentFields.contains(field) {
            return .rejected(status: 400, error: "Network \(family.rawValue) write boundary rejects client-controlled \(field)")
        }
        return .allowed
    }
}
