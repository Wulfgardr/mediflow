// ADR 0071 Fase 1: the HomeBase API model (DTOs + payloads + error/result types)
// extracted from HomeBasePatientsClient.swift into the platform-free core. These
// name the current /api/v1/network contract; names are kept verbatim for now
// (the future GRDB persistence layer may introduce separate domain models). The
// URLSession transport stays in the Apple layer. Payload encoders use PatchValue
// (same module). Foundation-only: no CryptoKit/URLSession here.
import Foundation

public struct HomeBaseConnectionConfiguration: Hashable, Sendable {
    public var serverURLString: String
    public var tlsPin: String

    public init(serverURLString: String = "https://localhost:3443", tlsPin: String = "") {
        self.serverURLString = serverURLString
        self.tlsPin = tlsPin
    }

    public func serverURL() throws -> URL {
        var candidate = serverURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !candidate.isEmpty else { throw HomeBaseClientError.invalidServerURL }
        if candidate.hasSuffix("/api/v1/") {
            candidate.removeLast("/api/v1/".count)
        } else if candidate.hasSuffix("/api/v1") {
            candidate.removeLast("/api/v1".count)
        }
        if candidate.hasSuffix("/") {
            candidate.removeLast()
        }
        guard let url = URL(string: candidate), url.host != nil else {
            throw HomeBaseClientError.invalidServerURL
        }
        guard url.scheme?.lowercased() == "https" else {
            throw HomeBaseClientError.insecureTransport
        }
        return url
    }

    public func apiBaseURL() throws -> URL {
        try serverURL()
            .appendingPathComponent("api")
            .appendingPathComponent("v1")
    }

    public var normalizedTLSPin: String {
        tlsPin
            .lowercased()
            .replacingOccurrences(of: ":", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

public struct HomeBasePairedCredentials: Hashable, Sendable {
    public let clientId: String
    public let clientToken: String

    public init(clientId: String, clientToken: String) {
        self.clientId = clientId
        self.clientToken = clientToken
    }
}

public struct HomeBasePatientSummary: Identifiable, Codable, Hashable, Sendable {
    public init(id: String, firstName: String, lastName: String, birthDate: Date?, taxCode: String, isAdi: Bool?, isArchived: Bool?, version: Int, updatedAt: Date?) {
        self.id = id; self.firstName = firstName; self.lastName = lastName; self.birthDate = birthDate; self.taxCode = taxCode; self.isAdi = isAdi; self.isArchived = isArchived; self.version = version; self.updatedAt = updatedAt
    }
    public let id: String
    public let firstName: String
    public let lastName: String
    public let birthDate: Date?
    public let taxCode: String
    public let isAdi: Bool?
    public let isArchived: Bool?
    public let version: Int
    public let updatedAt: Date?
}

public struct HomeBasePatientDetail: Identifiable, Codable, Hashable, Sendable {
    public init(id: String, firstName: String, lastName: String, birthDate: Date?, taxCode: String, address: String?, phone: String?, caregiver: String?, exemptions: String?, diagnoses: String?, monitoringProfile: String?, statusReason: String?, notes: String?, aiSummary: String?, documentInsights: String?, isAdi: Bool?, isArchived: Bool?, version: Int, ambulatoryId: String?, createdAt: Date?, updatedAt: Date?) {
        self.id = id; self.firstName = firstName; self.lastName = lastName; self.birthDate = birthDate; self.taxCode = taxCode; self.address = address; self.phone = phone; self.caregiver = caregiver; self.exemptions = exemptions; self.diagnoses = diagnoses; self.monitoringProfile = monitoringProfile; self.statusReason = statusReason; self.notes = notes; self.aiSummary = aiSummary; self.documentInsights = documentInsights; self.isAdi = isAdi; self.isArchived = isArchived; self.version = version; self.ambulatoryId = ambulatoryId; self.createdAt = createdAt; self.updatedAt = updatedAt
    }
    public let id: String
    public let firstName: String
    public let lastName: String
    public let birthDate: Date?
    public let taxCode: String
    public let address: String?
    public let phone: String?
    public let caregiver: String?
    public let exemptions: String?
    public let diagnoses: String?
    public let monitoringProfile: String?
    public let statusReason: String?
    public let notes: String?
    public let aiSummary: String?
    public let documentInsights: String?
    public let isAdi: Bool?
    public let isArchived: Bool?
    public let version: Int
    public let ambulatoryId: String?
    public let createdAt: Date?
    public let updatedAt: Date?
}

/* @Codex */
public struct HomeBaseEntrySummary: Identifiable, Codable, Hashable, Sendable {
    public init(id: String, patientId: String, type: String, title: String, date: Date, content: String, setting: String?, metadata: String?, attachments: String?, deletedAt: Date?, deletionReason: String?, version: Int, createdAt: Date?, updatedAt: Date?) {
        self.id = id; self.patientId = patientId; self.type = type; self.title = title; self.date = date; self.content = content; self.setting = setting; self.metadata = metadata; self.attachments = attachments; self.deletedAt = deletedAt; self.deletionReason = deletionReason; self.version = version; self.createdAt = createdAt; self.updatedAt = updatedAt
    }
    public let id: String
    public let patientId: String
    public let type: String
    public let title: String
    public let date: Date
    public let content: String
    public let setting: String?
    public let metadata: String?
    public let attachments: String?
    public let deletedAt: Date?
    public let deletionReason: String?
    public let version: Int
    public let createdAt: Date?
    public let updatedAt: Date?
}

/* @Codex */
public struct HomeBaseTherapySummary: Identifiable, Codable, Hashable, Sendable {
    public init(id: String, patientId: String, drugName: String, aic: String?, atc: String?, activePrinciple: String?, dosage: String, motivation: String?, diagnosisCode: String?, diagnosisName: String?, status: String, startDate: Date, endDate: Date?, version: Int, createdAt: Date?, updatedAt: Date?, deletedAt: Date?, deletionReason: String?) {
        self.id = id; self.patientId = patientId; self.drugName = drugName; self.aic = aic; self.atc = atc; self.activePrinciple = activePrinciple; self.dosage = dosage; self.motivation = motivation; self.diagnosisCode = diagnosisCode; self.diagnosisName = diagnosisName; self.status = status; self.startDate = startDate; self.endDate = endDate; self.version = version; self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt; self.deletionReason = deletionReason
    }
    public let id: String
    public let patientId: String
    public let drugName: String
    public let aic: String?
    public let atc: String?
    public let activePrinciple: String?
    public let dosage: String
    public let motivation: String?
    public let diagnosisCode: String?
    public let diagnosisName: String?
    public let status: String
    public let startDate: Date
    public let endDate: Date?
    public let version: Int
    public let createdAt: Date?
    public let updatedAt: Date?
    public let deletedAt: Date?
    public let deletionReason: String?
}

/* @Codex */
public struct HomeBaseCheckupSummary: Identifiable, Codable, Hashable, Sendable {
    public init(id: String, patientId: String, date: Date, title: String, notes: String?, status: String, source: String?, version: Int, createdAt: Date?, updatedAt: Date?, deletedAt: Date?, deletionReason: String?) {
        self.id = id; self.patientId = patientId; self.date = date; self.title = title; self.notes = notes; self.status = status; self.source = source; self.version = version; self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt; self.deletionReason = deletionReason
    }
    public let id: String
    public let patientId: String
    public let date: Date
    public let title: String
    public let notes: String?
    public let status: String
    public let source: String?
    public let version: Int
    public let createdAt: Date?
    public let updatedAt: Date?
    public let deletedAt: Date?
    public let deletionReason: String?
}

/* @Codex */
public struct HomeBaseObservationSummary: Identifiable, Codable, Hashable, Sendable {
    public init(id: String, patientId: String, codeSystem: String, code: String, display: String, unitSystem: String, unitCode: String, value: String, notes: String?, observedAt: Date, source: String?, version: Int, createdAt: Date?, updatedAt: Date?, deletedAt: Date?, deletionReason: String?) {
        self.id = id; self.patientId = patientId; self.codeSystem = codeSystem; self.code = code; self.display = display; self.unitSystem = unitSystem; self.unitCode = unitCode; self.value = value; self.notes = notes; self.observedAt = observedAt; self.source = source; self.version = version; self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt; self.deletionReason = deletionReason
    }
    public let id: String
    public let patientId: String
    public let codeSystem: String
    public let code: String
    public let display: String
    public let unitSystem: String
    public let unitCode: String
    public let value: String
    public let notes: String?
    public let observedAt: Date
    public let source: String?
    public let version: Int
    public let createdAt: Date?
    public let updatedAt: Date?
    public let deletedAt: Date?
    public let deletionReason: String?
}

// A18: paired ambulatory scope option, mirrors AmbulatorySummary from the web
// contract (createdAt arrives as an ISO string).
public struct NetworkAmbulatorySummary: Identifiable, Codable, Hashable, Sendable {
    public init(id: String, name: String, address: String?, type: String?, isDefault: Bool?, createdAt: String?) {
        self.id = id; self.name = name; self.address = address; self.type = type; self.isDefault = isDefault; self.createdAt = createdAt
    }
    public let id: String
    public let name: String
    public let address: String?
    public let type: String?
    public let isDefault: Bool?
    public let createdAt: String?
}

/* @Codex */
public struct HomeBaseEntryCreatePayload: Encodable, Sendable {
    public let id: String
    public let type: String
    public let title: String?
    public let date: Date
    public let content: String
    // A10: encrypted structured payload for scale entries (ENC: string), omitted
    // when nil so ordinary diary entries are unchanged.
    public let metadata: String?

    public init(id: String, type: String, title: String? = nil, date: Date, content: String, metadata: String? = nil) {
        self.id = id
        self.type = type
        self.title = title
        self.date = date
        self.content = content
        self.metadata = metadata
    }
}

/* @Codex */
public struct HomeBaseEntryUpdatePayload: Encodable, Sendable {
    public let version: Int
    public let type: String?
    public let title: String?
    public let content: String?
    public let deletedAt: Date?
    public let deletionReason: String?

    public init(
        version: Int,
        type: String? = nil,
        title: String? = nil,
        content: String? = nil,
        deletedAt: Date? = nil,
        deletionReason: String? = nil
    ) {
        self.version = version
        self.type = type
        self.title = title
        self.content = content
        self.deletedAt = deletedAt
        self.deletionReason = deletionReason
    }
}

/// A4 patient update. Plain optionals (firstName/lastName/taxCode/isAdi/isArchived)
/// are omit-only; the nullable fields use PatchValue (omit/null/value) because the
/// backend (lib/patient-write-normalization.ts) distinguishes field-absent
/// (unchanged) from explicit null (clear).
public struct HomeBasePatientUpdatePayload: Encodable, Sendable {
    public let version: Int
    public let firstName: String?
    public let lastName: String?
    public let taxCode: String?
    public let isAdi: Bool?
    public let isArchived: Bool?
    public let address: PatchValue<String>
    public let phone: PatchValue<String>
    public let caregiver: PatchValue<String>
    public let notes: PatchValue<String>
    public let monitoringProfile: PatchValue<String>
    public let statusReason: PatchValue<String>
    // A14/A3: the diagnoses JSON-array string. The backend stores a string field
    // verbatim (normalizeStructuredPatientField), so the encoded array round-trips.
    public let diagnoses: PatchValue<String>

    public init(
        version: Int,
        firstName: String? = nil,
        lastName: String? = nil,
        taxCode: String? = nil,
        isAdi: Bool? = nil,
        isArchived: Bool? = nil,
        address: PatchValue<String> = .omit,
        phone: PatchValue<String> = .omit,
        caregiver: PatchValue<String> = .omit,
        notes: PatchValue<String> = .omit,
        monitoringProfile: PatchValue<String> = .omit,
        statusReason: PatchValue<String> = .omit,
        diagnoses: PatchValue<String> = .omit
    ) {
        self.version = version
        self.firstName = firstName
        self.lastName = lastName
        self.taxCode = taxCode
        self.isAdi = isAdi
        self.isArchived = isArchived
        self.address = address
        self.phone = phone
        self.caregiver = caregiver
        self.notes = notes
        self.monitoringProfile = monitoringProfile
        self.statusReason = statusReason
        self.diagnoses = diagnoses
    }

    private enum CodingKeys: String, CodingKey {
        case version, firstName, lastName, taxCode, isAdi, isArchived
        case address, phone, caregiver, notes, monitoringProfile, statusReason, diagnoses
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encodeIfPresent(firstName, forKey: .firstName)
        try container.encodeIfPresent(lastName, forKey: .lastName)
        try container.encodeIfPresent(taxCode, forKey: .taxCode)
        try container.encodeIfPresent(isAdi, forKey: .isAdi)
        try container.encodeIfPresent(isArchived, forKey: .isArchived)
        try container.encodePatch(address, forKey: .address)
        try container.encodePatch(phone, forKey: .phone)
        try container.encodePatch(caregiver, forKey: .caregiver)
        try container.encodePatch(notes, forKey: .notes)
        try container.encodePatch(monitoringProfile, forKey: .monitoringProfile)
        try container.encodePatch(statusReason, forKey: .statusReason)
        try container.encodePatch(diagnoses, forKey: .diagnoses)
    }
}

/* @Codex */
public struct HomeBaseTherapyCreatePayload: Encodable, Sendable {
    public let drugName: String
    public let activePrinciple: String?
    public let dosage: String
    public let status: String
    public let startDate: Date
    public let endDate: Date?
    public let motivation: String?

    public init(
        drugName: String,
        activePrinciple: String? = nil,
        dosage: String,
        status: String,
        startDate: Date,
        endDate: Date? = nil,
        motivation: String? = nil
    ) {
        self.drugName = drugName
        self.activePrinciple = activePrinciple
        self.dosage = dosage
        self.status = status
        self.startDate = startDate
        self.endDate = endDate
        self.motivation = motivation
    }
}

/* @Codex */
public struct HomeBaseTherapyUpdatePayload: Encodable, Sendable {
    public let version: Int
    public let drugName: String?
    public let activePrinciple: String?
    public let dosage: String?
    public let status: String?
    public let startDate: Date?
    public let endDate: Date?
    public let motivation: String?
    public let deletedAt: Date?
    public let deletionReason: String?
    private let shouldEncodeEndDate: Bool

    public init(
        version: Int,
        drugName: String? = nil,
        activePrinciple: String? = nil,
        dosage: String? = nil,
        status: String? = nil,
        startDate: Date? = nil,
        endDate: Date? = nil,
        shouldEncodeEndDate: Bool = false,
        motivation: String? = nil,
        deletedAt: Date? = nil,
        deletionReason: String? = nil
    ) {
        self.version = version
        self.drugName = drugName
        self.activePrinciple = activePrinciple
        self.dosage = dosage
        self.status = status
        self.startDate = startDate
        self.endDate = endDate
        self.shouldEncodeEndDate = shouldEncodeEndDate
        self.motivation = motivation
        self.deletedAt = deletedAt
        self.deletionReason = deletionReason
    }

    enum CodingKeys: String, CodingKey {
        case version
        case drugName
        case activePrinciple
        case dosage
        case status
        case startDate
        case endDate
        case motivation
        case deletedAt
        case deletionReason
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encodeIfPresent(drugName, forKey: .drugName)
        try container.encodeIfPresent(activePrinciple, forKey: .activePrinciple)
        try container.encodeIfPresent(dosage, forKey: .dosage)
        try container.encodeIfPresent(status, forKey: .status)
        try container.encodeIfPresent(startDate, forKey: .startDate)
        if shouldEncodeEndDate {
            if let endDate {
                try container.encode(endDate, forKey: .endDate)
            } else {
                try container.encodeNil(forKey: .endDate)
            }
        }
        try container.encodeIfPresent(motivation, forKey: .motivation)
        try container.encodeIfPresent(deletedAt, forKey: .deletedAt)
        try container.encodeIfPresent(deletionReason, forKey: .deletionReason)
    }
}

/* @Codex */
public struct HomeBaseCheckupCreatePayload: Encodable, Sendable {
    public let date: Date
    public let title: String
    public let status: String
    public let notes: String?
    public let source: String

    public init(date: Date, title: String, status: String, notes: String? = nil, source: String = "manual") {
        self.date = date
        self.title = title
        self.status = status
        self.notes = notes
        self.source = source
    }
}

/* @Codex */
public struct HomeBaseCheckupUpdatePayload: Encodable, Sendable {
    public let version: Int
    public let date: Date?
    public let title: String?
    public let status: String?
    public let notes: String?
    public let deletedAt: Date?
    public let deletionReason: String?

    public init(
        version: Int,
        date: Date? = nil,
        title: String? = nil,
        status: String? = nil,
        notes: String? = nil,
        deletedAt: Date? = nil,
        deletionReason: String? = nil
    ) {
        self.version = version
        self.date = date
        self.title = title
        self.status = status
        self.notes = notes
        self.deletedAt = deletedAt
        self.deletionReason = deletionReason
    }
}

/* @Codex */
public struct HomeBaseObservationCreatePayload: Encodable, Sendable {
    public let codeSystem: String
    public let code: String
    public let display: String
    public let unitSystem: String
    public let unitCode: String
    public let value: String
    public let observedAt: Date
    public let notes: String?
    public let source: String

    public init(
        codeSystem: String = "LOINC",
        code: String,
        display: String,
        unitSystem: String = "UCUM",
        unitCode: String,
        value: String,
        observedAt: Date,
        notes: String? = nil,
        source: String = "manual"
    ) {
        self.codeSystem = codeSystem
        self.code = code
        self.display = display
        self.unitSystem = unitSystem
        self.unitCode = unitCode
        self.value = value
        self.observedAt = observedAt
        self.notes = notes
        self.source = source
    }
}

/* @Codex */
public struct HomeBaseObservationUpdatePayload: Encodable, Sendable {
    public let version: Int
    public let code: String?
    public let display: String?
    public let unitCode: String?
    public let value: String?
    public let observedAt: Date?
    public let notes: String?
    public let deletedAt: Date?
    public let deletionReason: String?

    public init(
        version: Int,
        code: String? = nil,
        display: String? = nil,
        unitCode: String? = nil,
        value: String? = nil,
        observedAt: Date? = nil,
        notes: String? = nil,
        deletedAt: Date? = nil,
        deletionReason: String? = nil
    ) {
        self.version = version
        self.code = code
        self.display = display
        self.unitCode = unitCode
        self.value = value
        self.observedAt = observedAt
        self.notes = notes
        self.deletedAt = deletedAt
        self.deletionReason = deletionReason
    }
}

/* @Codex */
public struct HomeBaseMutationAcknowledgement: Decodable, Equatable, Sendable {
    public let success: Bool

    public init(success: Bool) {
        self.success = success
    }
}

public enum HomeBaseClientError: LocalizedError, Equatable {
    case invalidServerURL
    case insecureTransport
    case missingSessionCookie
    case transport(HomeBaseTransportIssue)
    case httpStatus(Int, String?)
    case versionConflict(VersionConflictPayload)
    case contract

    public var errorDescription: String? {
        switch self {
        case .invalidServerURL:
            return "URL home-base non valida."
        case .insecureTransport:
            return "Trasporto non sicuro: HTTPS richiesto."
        case .missingSessionCookie:
            return "La login non ha restituito una sessione operatore valida."
        case .transport(let issue):
            return issue.localizedDescription
        case .httpStatus(_, let message):
            return message ?? "La richiesta verso l'home-base non e andata a buon fine."
        case .versionConflict(let conflict):
            let current = conflict.currentVersion.map(String.init) ?? "piu recente"
            return "Conflitto di versione su \(conflict.entity): la versione \(conflict.expectedVersion) e superata dalla \(current). Ricarica e confronta prima di salvare."
        case .contract:
            return "La risposta dell'home-base non rispetta il contratto atteso."
        }
    }
}

public enum HomeBaseTransportIssue: Equatable {
    case tlsHandshakeFailed
    case unreachable
    case timeout
    case other(Int)

    var localizedDescription: String {
        switch self {
        case .tlsHandshakeFailed:
            return "Handshake TLS fallito. Verifica fingerprint o certificato."
        case .unreachable:
            return "Home-base non raggiungibile."
        case .timeout:
            return "Timeout verso l'home-base."
        case .other:
            return "Errore di trasporto verso l'home-base."
        }
    }
}
