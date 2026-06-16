// @Codex
import Foundation

struct PatientSummary: Identifiable, Decodable {
    let id: String
    let firstName: String
    let lastName: String
    let birthDate: Date?
    let taxCode: String
    let isAdi: Bool?
    let isArchived: Bool?
    let version: Int
    let updatedAt: Date?
}

struct PatientDetail: Identifiable, Decodable {
    let id: String
    let firstName: String
    let lastName: String
    let birthDate: Date?
    let taxCode: String
    let address: String?
    let phone: String?
    let caregiver: String?
    /* @Codex */
    let exemptions: String?
    /* @Codex */
    let diagnoses: String?
    /* @Codex */
    let monitoringProfile: String?
    let notes: String?
    /* @Codex */
    let aiSummary: String?
    /* @Codex */
    let documentInsights: String?
    let isAdi: Bool?
    let isArchived: Bool?
    let version: Int
    let ambulatoryId: String?
    let createdAt: Date?
    let updatedAt: Date?
}

struct AmbulatorySummary: Identifiable, Decodable {
    let id: String
    let name: String
    let address: String?
    let type: String?
    let isDefault: Bool?
    let createdAt: Date?
}

struct EntrySummary: Identifiable, Decodable {
    let id: String
    let patientId: String
    let type: String
    let title: String?
    let date: Date
    let content: String
    let setting: String?
    let metadata: EntryJSONValue?
    let attachments: EntryJSONValue?
    let version: Int?
    let createdAt: Date?
    let updatedAt: Date?
    let deletedAt: Date?
    let deletionReason: String?

    var isDeleted: Bool { deletedAt != nil }
}

enum EntryJSONValue: Decodable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([EntryJSONValue])
    case object([String: EntryJSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
            return
        }
        if let value = try? container.decode(Bool.self) {
            self = .bool(value)
            return
        }
        if let value = try? container.decode(Double.self) {
            self = .number(value)
            return
        }
        if let value = try? container.decode(String.self) {
            self = .string(value)
            return
        }
        if let value = try? container.decode([EntryJSONValue].self) {
            self = .array(value)
            return
        }
        if let value = try? container.decode([String: EntryJSONValue].self) {
            self = .object(value)
            return
        }
        throw DecodingError.dataCorruptedError(
            in: container,
            debugDescription: "Unsupported JSON value for EntrySummary."
        )
    }
}

struct TherapySummary: Identifiable, Decodable {
    let id: String
    let patientId: String
    let drugName: String
    /* @Codex */
    let aic: String?
    /* @Codex */
    let atc: String?
    /* @Codex */
    let activePrinciple: String?
    let dosage: String
    /* @Codex */
    let motivation: String?
    /* @Codex */
    let diagnosisCode: String?
    /* @Codex */
    let diagnosisName: String?
    let status: String
    let startDate: Date
    let endDate: Date?
    let version: Int?
    let createdAt: Date?
}

struct CheckupSummary: Identifiable, Decodable {
    let id: String
    let patientId: String
    let date: Date
    let title: String
    /* @Codex */
    let notes: String?
    let status: String
    /* @Codex */
    let source: String?
    /* @Codex */
    let version: Int?
    let createdAt: Date?
    /* @Codex */
    let updatedAt: Date?
    /* @Codex */
    let deletedAt: Date?
    /* @Codex */
    let deletionReason: String?
}

/* @Codex */
struct ObservationSummary: Identifiable, Decodable {
    let id: String
    let patientId: String
    let codeSystem: String
    let code: String
    let display: String
    let unitSystem: String
    let unitCode: String
    let value: String
    let notes: String?
    let observedAt: Date
    let source: String?
    /* @Codex */
    let version: Int?
    let createdAt: Date?
    /* @Codex */
    let updatedAt: Date?
    /* @Codex */
    let deletedAt: Date?
    /* @Codex */
    let deletionReason: String?

    /* @Codex */
    init(
        id: String,
        patientId: String,
        codeSystem: String,
        code: String,
        display: String,
        unitSystem: String,
        unitCode: String,
        value: String,
        notes: String?,
        observedAt: Date,
        source: String?,
        version: Int? = nil,
        createdAt: Date?,
        updatedAt: Date? = nil,
        deletedAt: Date? = nil,
        deletionReason: String? = nil
    ) {
        self.id = id
        self.patientId = patientId
        self.codeSystem = codeSystem
        self.code = code
        self.display = display
        self.unitSystem = unitSystem
        self.unitCode = unitCode
        self.value = value
        self.notes = notes
        self.observedAt = observedAt
        self.source = source
        self.version = version
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
        self.deletionReason = deletionReason
    }
}

/* @Codex */
struct TerminologySearchItem: Identifiable, Decodable {
    let system: String
    let code: String
    let display: String
    let version: String?
    let source: String

    var id: String {
        "\(system):\(code)"
    }
}
