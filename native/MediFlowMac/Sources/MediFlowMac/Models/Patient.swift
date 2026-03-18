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
    let date: Date
    let content: String
    let createdAt: Date?
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
    let createdAt: Date?
}

struct CheckupSummary: Identifiable, Decodable {
    let id: String
    let patientId: String
    let date: Date
    let title: String
    let status: String
    let createdAt: Date?
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
    let createdAt: Date?
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
