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
    public init(id: String, firstName: String, lastName: String, birthDate: Date?, taxCode: String, isAdi: Bool?, isArchived: Bool?, version: Int, updatedAt: Date?, deletedAt: Date? = nil, deletionReason: String? = nil) {
        self.id = id; self.firstName = firstName; self.lastName = lastName; self.birthDate = birthDate; self.taxCode = taxCode; self.isAdi = isAdi; self.isArchived = isArchived; self.version = version; self.updatedAt = updatedAt; self.deletedAt = deletedAt; self.deletionReason = deletionReason
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
    public let deletedAt: Date?
    public let deletionReason: String?
}

public struct HomeBasePatientDetail: Identifiable, Codable, Hashable, Sendable {
    public init(id: String, firstName: String, lastName: String, birthDate: Date?, taxCode: String, address: String?, phone: String?, caregiver: String?, exemptions: String?, diagnoses: String?, monitoringProfile: String?, statusReason: String?, notes: String?, aiSummary: String?, documentInsights: String?, isAdi: Bool?, isArchived: Bool?, version: Int, ambulatoryId: String?, createdAt: Date?, updatedAt: Date?, deletedAt: Date? = nil, deletionReason: String? = nil) {
        self.id = id; self.firstName = firstName; self.lastName = lastName; self.birthDate = birthDate; self.taxCode = taxCode; self.address = address; self.phone = phone; self.caregiver = caregiver; self.exemptions = exemptions; self.diagnoses = diagnoses; self.monitoringProfile = monitoringProfile; self.statusReason = statusReason; self.notes = notes; self.aiSummary = aiSummary; self.documentInsights = documentInsights; self.isAdi = isAdi; self.isArchived = isArchived; self.version = version; self.ambulatoryId = ambulatoryId; self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt; self.deletionReason = deletionReason
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
    public let deletedAt: Date?
    public let deletionReason: String?
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

/* @Codex */
public struct HomeBaseServicePrescriptionSummary: Identifiable, Codable, Hashable, Sendable {
    public init(id: String, patientId: String, prescribedAt: Date, status: String, category: String,
                priority: String?, codeSystem: String?, serviceCode: String?, serviceName: String,
                clinicalQuestion: String?, provider: String?, scheduledAt: Date?, performedAt: Date?,
                reportReceivedAt: Date?, outcomeNote: String?, requestReference: String?, source: String,
                documentRefs: String?, notes: String?, version: Int, createdAt: Date?, updatedAt: Date?) {
        self.id = id; self.patientId = patientId; self.prescribedAt = prescribedAt; self.status = status; self.category = category; self.priority = priority; self.codeSystem = codeSystem; self.serviceCode = serviceCode; self.serviceName = serviceName; self.clinicalQuestion = clinicalQuestion; self.provider = provider; self.scheduledAt = scheduledAt; self.performedAt = performedAt; self.reportReceivedAt = reportReceivedAt; self.outcomeNote = outcomeNote; self.requestReference = requestReference; self.source = source; self.documentRefs = documentRefs; self.notes = notes; self.version = version; self.createdAt = createdAt; self.updatedAt = updatedAt
    }
    public let id: String
    public let patientId: String
    public let prescribedAt: Date
    public let status: String
    public let category: String
    public let priority: String?
    public let codeSystem: String?
    public let serviceCode: String?
    public let serviceName: String
    public let clinicalQuestion: String?
    public let provider: String?
    public let scheduledAt: Date?
    public let performedAt: Date?
    public let reportReceivedAt: Date?
    public let outcomeNote: String?
    public let requestReference: String?
    public let source: String
    public let documentRefs: String?
    public let notes: String?
    public let version: Int
    public let createdAt: Date?
    public let updatedAt: Date?
}

/* @Codex */
public struct HomeBaseServicePrescriptionItemSummary: Identifiable, Codable, Hashable, Sendable {
    public init(id: String, patientId: String, prescriptionId: String, ordinal: Int, status: String,
                category: String?, codeSystem: String?, serviceCode: String?, serviceName: String,
                catalogEntryId: String?, catalogDisplayName: String?, matchStatus: String,
                confidence: String?, evidence: String?, notes: String?, scheduledAt: Date?,
                performedAt: Date?, reportReceivedAt: Date?, outcomeNote: String?, version: Int,
                createdAt: Date?, updatedAt: Date?) {
        self.id = id; self.patientId = patientId; self.prescriptionId = prescriptionId; self.ordinal = ordinal; self.status = status; self.category = category; self.codeSystem = codeSystem; self.serviceCode = serviceCode; self.serviceName = serviceName; self.catalogEntryId = catalogEntryId; self.catalogDisplayName = catalogDisplayName; self.matchStatus = matchStatus; self.confidence = confidence; self.evidence = evidence; self.notes = notes; self.scheduledAt = scheduledAt; self.performedAt = performedAt; self.reportReceivedAt = reportReceivedAt; self.outcomeNote = outcomeNote; self.version = version; self.createdAt = createdAt; self.updatedAt = updatedAt
    }
    public let id: String
    public let patientId: String
    public let prescriptionId: String
    public let ordinal: Int
    public let status: String
    public let category: String?
    public let codeSystem: String?
    public let serviceCode: String?
    public let serviceName: String
    public let catalogEntryId: String?
    public let catalogDisplayName: String?
    public let matchStatus: String
    public let confidence: String?
    public let evidence: String?
    public let notes: String?
    public let scheduledAt: Date?
    public let performedAt: Date?
    public let reportReceivedAt: Date?
    public let outcomeNote: String?
    public let version: Int
    public let createdAt: Date?
    public let updatedAt: Date?
}

/* @Codex */
public struct HomeBaseProstheticPrescriptionSummary: Identifiable, Codable, Hashable, Sendable {
    public init(id: String, patientId: String, prescribedAt: Date, status: String, category: String,
                isoCode: String?, description: String, measures: String?, clinicalReason: String?,
                regionalPrescriptionId: String?, supplier: String?, collaudoAt: Date?,
                collaudoOutcome: String?, source: String, documentRefs: String?, notes: String?,
                version: Int, createdAt: Date?, updatedAt: Date?) {
        self.id = id; self.patientId = patientId; self.prescribedAt = prescribedAt; self.status = status; self.category = category; self.isoCode = isoCode; self.description = description; self.measures = measures; self.clinicalReason = clinicalReason; self.regionalPrescriptionId = regionalPrescriptionId; self.supplier = supplier; self.collaudoAt = collaudoAt; self.collaudoOutcome = collaudoOutcome; self.source = source; self.documentRefs = documentRefs; self.notes = notes; self.version = version; self.createdAt = createdAt; self.updatedAt = updatedAt
    }
    public let id: String
    public let patientId: String
    public let prescribedAt: Date
    public let status: String
    public let category: String
    public let isoCode: String?
    public let description: String
    public let measures: String?
    public let clinicalReason: String?
    public let regionalPrescriptionId: String?
    public let supplier: String?
    public let collaudoAt: Date?
    public let collaudoOutcome: String?
    public let source: String
    public let documentRefs: String?
    public let notes: String?
    public let version: Int
    public let createdAt: Date?
    public let updatedAt: Date?
}

/* @Codex */
public struct HomeBaseServiceCatalogEntrySummary: Identifiable, Codable, Hashable, Sendable {
    public init(id: String, codeSystem: String, serviceCode: String, displayName: String,
                category: String, branchCode: String?, synonyms: String?, source: String,
                version: String?, active: Bool, importedAt: Date?, updatedAt: Date?) {
        self.id = id; self.codeSystem = codeSystem; self.serviceCode = serviceCode; self.displayName = displayName; self.category = category; self.branchCode = branchCode; self.synonyms = synonyms; self.source = source; self.version = version; self.active = active; self.importedAt = importedAt; self.updatedAt = updatedAt
    }
    public let id: String
    public let codeSystem: String
    public let serviceCode: String
    public let displayName: String
    public let category: String
    public let branchCode: String?
    public let synonyms: String?
    public let source: String
    public let version: String?
    public let active: Bool
    public let importedAt: Date?
    public let updatedAt: Date?
}

/* @Codex */
public struct HomeBaseCatalogCountResponse: Codable, Hashable, Sendable {
    public let count: Int

    public init(count: Int) {
        self.count = count
    }
}

/* @Codex */
public struct NetworkRevisionSummary: Codable, Hashable, Sendable {
    public let revision: String
    public let sourceFingerprint: String
    public let fingerprint: String

    public init(revision: String, sourceFingerprint: String, fingerprint: String) {
        self.revision = revision
        self.sourceFingerprint = sourceFingerprint
        self.fingerprint = fingerprint
    }
}

/* @Codex */
public struct NetworkCapability: Codable, Hashable, Sendable {
    public let key: String
    public let status: String
    public let requiresPairing: Bool
    public let description: String

    public init(key: String, status: String, requiresPairing: Bool, description: String) {
        self.key = key
        self.status = status
        self.requiresPairing = requiresPairing
        self.description = description
    }
}

/* @Codex */
public struct NetworkCapabilitiesResponse: Codable, Hashable, Sendable {
    public let nodeId: String
    public let operatingMode: String
    public let protocolVersion: String
    public let capabilities: [NetworkCapability]

    public init(nodeId: String, operatingMode: String, protocolVersion: String, capabilities: [NetworkCapability]) {
        self.nodeId = nodeId
        self.operatingMode = operatingMode
        self.protocolVersion = protocolVersion
        self.capabilities = capabilities
    }
}

/* @Codex */
public struct NetworkNodeSummary: Codable, Hashable, Sendable {
    public struct Transport: Codable, Hashable, Sendable {
        public let apiBasePath: String
        public let tlsRequired: Bool
        public let localTlsPort: Int

        public init(apiBasePath: String, tlsRequired: Bool, localTlsPort: Int) {
            self.apiBasePath = apiBasePath
            self.tlsRequired = tlsRequired
            self.localTlsPort = localTlsPort
        }
    }

    public let nodeId: String
    public let displayName: String
    public let role: String
    public let operatingMode: String
    public let protocolVersion: String
    public let transport: Transport

    public init(nodeId: String, displayName: String, role: String, operatingMode: String,
                protocolVersion: String, transport: Transport) {
        self.nodeId = nodeId; self.displayName = displayName; self.role = role; self.operatingMode = operatingMode; self.protocolVersion = protocolVersion; self.transport = transport
    }
}

/* @Codex */
public struct NetworkIdentitySummary: Codable, Hashable, Sendable {
    public struct OperatorSummary: Codable, Hashable, Sendable {
        public let userId: String?
        public let username: String?
        public let displayName: String?
        public let role: String?
        public let authChannel: String
    }

    public struct ScopeSummary: Codable, Hashable, Sendable {
        public let policy: String
        public let effectiveAmbulatoryId: String?
        public let effectiveAmbulatoryName: String?
        public let defaultAmbulatoryId: String?
        public let defaultAmbulatoryName: String?
        public let source: String
    }

    public struct AuditSummary: Codable, Hashable, Sendable {
        public let actorType: String
        public let actorBinding: String
    }

    public let identityModel: String
    public let pairingBoundary: String
    public let credentialState: String
    public let loginMode: String
    public let usernameHint: String?
    public let displayNameHint: String?
    public let `operator`: OperatorSummary
    public let scope: ScopeSummary
    public let audit: AuditSummary
    public let limitations: [String]
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
    public let setting: String?
    // A10: encrypted structured payload for scale entries. The store accepts either a
    // plaintext JSON (sealed in-core) or an already-encrypted ENC: string (stored
    // verbatim), omitted when nil so ordinary diary entries are unchanged.
    public let metadata: String?

    public init(id: String, type: String, title: String? = nil, date: Date, content: String,
                setting: String? = nil, metadata: String? = nil) {
        self.id = id
        self.type = type
        self.title = title
        self.date = date
        self.content = content
        self.setting = setting
        self.metadata = metadata
    }
}

/* @Codex */
public struct HomeBaseEntryUpdatePayload: Encodable, Sendable {
    public let version: Int
    public let type: String?
    public let title: String?
    public let content: String?
    public let date: Date?
    public let setting: String?
    public let deletedAt: Date?
    public let deletionReason: String?
    private let shouldEncodeDeletedAt: Bool
    private let shouldEncodeDeletionReason: Bool
    // NOTE: metadata (an ENCRYPTED structured field) is intentionally absent here:
    // its update input shape (plaintext-to-seal vs pre-encrypted) is unresolved, so
    // metadata edits stay create-only on-device. attachments is excluded by design
    // (the web boundary rejects attachment writes).

    public init(
        version: Int,
        type: String? = nil,
        title: String? = nil,
        content: String? = nil,
        date: Date? = nil,
        setting: String? = nil,
        deletedAt: Date? = nil,
        deletionReason: String? = nil,
        shouldEncodeDeletedAt: Bool = false,
        shouldEncodeDeletionReason: Bool = false
    ) {
        self.version = version
        self.type = type
        self.title = title
        self.content = content
        self.date = date
        self.setting = setting
        self.deletedAt = deletedAt
        self.deletionReason = deletionReason
        self.shouldEncodeDeletedAt = shouldEncodeDeletedAt
        self.shouldEncodeDeletionReason = shouldEncodeDeletionReason
    }

    enum CodingKeys: String, CodingKey {
        case version
        case type
        case title
        case content
        case date
        case setting
        case deletedAt
        case deletionReason
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encodeIfPresent(type, forKey: .type)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encodeIfPresent(content, forKey: .content)
        try container.encodeIfPresent(date, forKey: .date)
        try container.encodeIfPresent(setting, forKey: .setting)
        if shouldEncodeDeletedAt {
            if let deletedAt {
                try container.encode(deletedAt, forKey: .deletedAt)
            } else {
                try container.encodeNil(forKey: .deletedAt)
            }
        } else {
            try container.encodeIfPresent(deletedAt, forKey: .deletedAt)
        }
        if shouldEncodeDeletionReason {
            if let deletionReason {
                try container.encode(deletionReason, forKey: .deletionReason)
            } else {
                try container.encodeNil(forKey: .deletionReason)
            }
        } else {
            try container.encodeIfPresent(deletionReason, forKey: .deletionReason)
        }
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
    // exemptions: the structured exemption-codes JSON-array string (same convention
    // as diagnoses). birthDate: omit/null/value, matching normalizeBirthDateForUpdate.
    public let exemptions: PatchValue<String>
    public let birthDate: PatchValue<Date>

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
        diagnoses: PatchValue<String> = .omit,
        exemptions: PatchValue<String> = .omit,
        birthDate: PatchValue<Date> = .omit
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
        self.exemptions = exemptions
        self.birthDate = birthDate
    }

    private enum CodingKeys: String, CodingKey {
        case version, firstName, lastName, taxCode, isAdi, isArchived
        case address, phone, caregiver, notes, monitoringProfile, statusReason, diagnoses
        case exemptions, birthDate
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
        try container.encodePatch(exemptions, forKey: .exemptions)
        try container.encodePatch(birthDate, forKey: .birthDate)
    }
}

/// A4 patient create (reversed flow: the native core inserts locally). Plaintext
/// inputs; SQLitePatientStore.createPatient seals the ENCRYPTED_FIELDS in-core.
/// firstName/lastName/taxCode are required; the rest are optional. exemptions and
/// diagnoses carry the array-JSON STRING (structured fields), like the update payload.
/// Mirrors normalizePatientCreateInput (lib/patient-write-normalization.ts).
public struct HomeBasePatientCreatePayload: Encodable, Sendable {
    public let firstName: String
    public let lastName: String
    public let taxCode: String
    public let birthDate: Date?
    public let address: String?
    public let phone: String?
    public let caregiver: String?
    public let exemptions: String?
    public let diagnoses: String?
    public let monitoringProfile: String?
    public let statusReason: String?
    public let notes: String?
    public let isAdi: Bool
    public let isArchived: Bool

    public init(
        firstName: String,
        lastName: String,
        taxCode: String,
        birthDate: Date? = nil,
        address: String? = nil,
        phone: String? = nil,
        caregiver: String? = nil,
        exemptions: String? = nil,
        diagnoses: String? = nil,
        monitoringProfile: String? = nil,
        statusReason: String? = nil,
        notes: String? = nil,
        isAdi: Bool = false,
        isArchived: Bool = false
    ) {
        self.firstName = firstName
        self.lastName = lastName
        self.taxCode = taxCode
        self.birthDate = birthDate
        self.address = address
        self.phone = phone
        self.caregiver = caregiver
        self.exemptions = exemptions
        self.diagnoses = diagnoses
        self.monitoringProfile = monitoringProfile
        self.statusReason = statusReason
        self.notes = notes
        self.isAdi = isAdi
        self.isArchived = isArchived
    }

    private enum CodingKeys: String, CodingKey {
        case firstName, lastName, taxCode, birthDate, address, phone, caregiver
        case exemptions, diagnoses, monitoringProfile, statusReason, notes, isAdi
    }

    // isArchived is intentionally absent from CodingKeys: the create boundary
    // rejects every server-controlled field by presence (spec D6), so the wire
    // payload must omit it. The local authority path reads the property directly
    // from the struct, not from its JSON encoding.
}

/* @Codex */
public struct HomeBasePatientSoftDeletePayload: Encodable, Sendable {
    public let version: Int
    public let deletionReason: String?

    public init(version: Int, deletionReason: String? = nil) {
        self.version = version
        self.deletionReason = deletionReason
    }
}

/* @Codex */
public struct HomeBasePatientRestorePayload: Encodable, Sendable {
    public let version: Int

    public init(version: Int) {
        self.version = version
    }
}

/* @Codex */
public struct HomeBaseTherapyCreatePayload: Encodable, Sendable {
    public let drugName: String
    public let aic: String?
    public let atc: String?
    public let activePrinciple: String?
    public let diagnosisCode: String?
    public let diagnosisName: String?
    public let dosage: String
    public let status: String
    public let startDate: Date
    public let endDate: Date?
    public let motivation: String?

    public init(
        drugName: String,
        aic: String? = nil,
        atc: String? = nil,
        activePrinciple: String? = nil,
        diagnosisCode: String? = nil,
        diagnosisName: String? = nil,
        dosage: String,
        status: String,
        startDate: Date,
        endDate: Date? = nil,
        motivation: String? = nil
    ) {
        self.drugName = drugName
        self.aic = aic
        self.atc = atc
        self.activePrinciple = activePrinciple
        self.diagnosisCode = diagnosisCode
        self.diagnosisName = diagnosisName
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
    public let aic: String?
    public let atc: String?
    public let activePrinciple: String?
    public let diagnosisCode: String?
    public let diagnosisName: String?
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
        aic: String? = nil,
        atc: String? = nil,
        activePrinciple: String? = nil,
        diagnosisCode: String? = nil,
        diagnosisName: String? = nil,
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
        self.aic = aic
        self.atc = atc
        self.activePrinciple = activePrinciple
        self.diagnosisCode = diagnosisCode
        self.diagnosisName = diagnosisName
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
        case aic
        case atc
        case activePrinciple
        case diagnosisCode
        case diagnosisName
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
        try container.encodeIfPresent(aic, forKey: .aic)
        try container.encodeIfPresent(atc, forKey: .atc)
        try container.encodeIfPresent(activePrinciple, forKey: .activePrinciple)
        try container.encodeIfPresent(diagnosisCode, forKey: .diagnosisCode)
        try container.encodeIfPresent(diagnosisName, forKey: .diagnosisName)
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
    public let source: String?
    public let deletedAt: Date?
    public let deletionReason: String?

    public init(
        version: Int,
        date: Date? = nil,
        title: String? = nil,
        status: String? = nil,
        notes: String? = nil,
        source: String? = nil,
        deletedAt: Date? = nil,
        deletionReason: String? = nil
    ) {
        self.version = version
        self.date = date
        self.title = title
        self.status = status
        self.notes = notes
        self.source = source
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
    public let codeSystem: String?
    public let code: String?
    public let display: String?
    public let unitSystem: String?
    public let unitCode: String?
    public let value: String?
    public let observedAt: Date?
    public let notes: String?
    public let source: String?
    public let deletedAt: Date?
    public let deletionReason: String?

    public init(
        version: Int,
        codeSystem: String? = nil,
        code: String? = nil,
        display: String? = nil,
        unitSystem: String? = nil,
        unitCode: String? = nil,
        value: String? = nil,
        observedAt: Date? = nil,
        notes: String? = nil,
        source: String? = nil,
        deletedAt: Date? = nil,
        deletionReason: String? = nil
    ) {
        self.version = version
        self.codeSystem = codeSystem
        self.code = code
        self.display = display
        self.unitSystem = unitSystem
        self.unitCode = unitCode
        self.value = value
        self.observedAt = observedAt
        self.notes = notes
        self.source = source
        self.deletedAt = deletedAt
        self.deletionReason = deletionReason
    }
}

/* @Codex */
public struct HomeBaseServicePrescriptionCreatePayload: Encodable, Sendable {
    public let id: String?
    public let patientId: String
    public let prescribedAt: Date
    public let status: String?
    public let category: String?
    public let priority: String?
    public let codeSystem: String?
    public let serviceCode: String?
    public let serviceName: String
    public let clinicalQuestion: String?
    public let provider: String?
    public let scheduledAt: Date?
    public let performedAt: Date?
    public let reportReceivedAt: Date?
    public let outcomeNote: String?
    public let requestReference: String?
    public let source: String?
    public let documentRefs: String?
    public let notes: String?

    public init(id: String? = nil, patientId: String, prescribedAt: Date, serviceName: String,
                status: String? = nil, category: String? = nil, priority: String? = nil,
                codeSystem: String? = nil, serviceCode: String? = nil, clinicalQuestion: String? = nil,
                provider: String? = nil, scheduledAt: Date? = nil, performedAt: Date? = nil,
                reportReceivedAt: Date? = nil, outcomeNote: String? = nil, requestReference: String? = nil,
                source: String? = nil, documentRefs: String? = nil, notes: String? = nil) {
        self.id = id; self.patientId = patientId; self.prescribedAt = prescribedAt; self.serviceName = serviceName; self.status = status; self.category = category; self.priority = priority; self.codeSystem = codeSystem; self.serviceCode = serviceCode; self.clinicalQuestion = clinicalQuestion; self.provider = provider; self.scheduledAt = scheduledAt; self.performedAt = performedAt; self.reportReceivedAt = reportReceivedAt; self.outcomeNote = outcomeNote; self.requestReference = requestReference; self.source = source; self.documentRefs = documentRefs; self.notes = notes
    }
}

/* @Codex */
public struct HomeBaseServicePrescriptionUpdatePayload: Encodable, Sendable {
    public let version: Int
    public let prescribedAt: Date?
    public let status: String?
    public let category: String?
    public let priority: PatchValue<String>
    public let codeSystem: PatchValue<String>
    public let serviceCode: PatchValue<String>
    public let serviceName: String?
    public let clinicalQuestion: PatchValue<String>
    public let provider: PatchValue<String>
    public let scheduledAt: PatchValue<Date>
    public let performedAt: PatchValue<Date>
    public let reportReceivedAt: PatchValue<Date>
    public let outcomeNote: PatchValue<String>
    public let requestReference: PatchValue<String>
    public let source: String?
    public let documentRefs: PatchValue<String>
    public let notes: PatchValue<String>

    public init(version: Int, prescribedAt: Date? = nil, status: String? = nil, category: String? = nil,
                priority: PatchValue<String> = .omit, codeSystem: PatchValue<String> = .omit,
                serviceCode: PatchValue<String> = .omit, serviceName: String? = nil,
                clinicalQuestion: PatchValue<String> = .omit, provider: PatchValue<String> = .omit,
                scheduledAt: PatchValue<Date> = .omit, performedAt: PatchValue<Date> = .omit,
                reportReceivedAt: PatchValue<Date> = .omit, outcomeNote: PatchValue<String> = .omit,
                requestReference: PatchValue<String> = .omit, source: String? = nil,
                documentRefs: PatchValue<String> = .omit, notes: PatchValue<String> = .omit) {
        self.version = version; self.prescribedAt = prescribedAt; self.status = status; self.category = category; self.priority = priority; self.codeSystem = codeSystem; self.serviceCode = serviceCode; self.serviceName = serviceName; self.clinicalQuestion = clinicalQuestion; self.provider = provider; self.scheduledAt = scheduledAt; self.performedAt = performedAt; self.reportReceivedAt = reportReceivedAt; self.outcomeNote = outcomeNote; self.requestReference = requestReference; self.source = source; self.documentRefs = documentRefs; self.notes = notes
    }

    private enum CodingKeys: String, CodingKey {
        case version, prescribedAt, status, category, priority, codeSystem, serviceCode, serviceName
        case clinicalQuestion, provider, scheduledAt, performedAt, reportReceivedAt, outcomeNote
        case requestReference, source, documentRefs, notes
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encodeIfPresent(prescribedAt, forKey: .prescribedAt)
        try container.encodeIfPresent(status, forKey: .status)
        try container.encodeIfPresent(category, forKey: .category)
        try container.encodePatch(priority, forKey: .priority)
        try container.encodePatch(codeSystem, forKey: .codeSystem)
        try container.encodePatch(serviceCode, forKey: .serviceCode)
        try container.encodeIfPresent(serviceName, forKey: .serviceName)
        try container.encodePatch(clinicalQuestion, forKey: .clinicalQuestion)
        try container.encodePatch(provider, forKey: .provider)
        try container.encodePatch(scheduledAt, forKey: .scheduledAt)
        try container.encodePatch(performedAt, forKey: .performedAt)
        try container.encodePatch(reportReceivedAt, forKey: .reportReceivedAt)
        try container.encodePatch(outcomeNote, forKey: .outcomeNote)
        try container.encodePatch(requestReference, forKey: .requestReference)
        try container.encodeIfPresent(source, forKey: .source)
        try container.encodePatch(documentRefs, forKey: .documentRefs)
        try container.encodePatch(notes, forKey: .notes)
    }
}

/* @Codex */
public struct HomeBaseServicePrescriptionItemCreatePayload: Encodable, Sendable {
    public let id: String?
    public let prescriptionId: String
    public let ordinal: Int?
    public let status: String?
    public let category: String?
    public let codeSystem: String?
    public let serviceCode: String?
    public let serviceName: String
    public let catalogEntryId: String?
    public let catalogDisplayName: String?
    public let matchStatus: String?
    public let confidence: String?
    public let evidence: String?
    public let notes: String?
    public let scheduledAt: Date?
    public let performedAt: Date?
    public let reportReceivedAt: Date?
    public let outcomeNote: String?

    public init(id: String? = nil, prescriptionId: String, serviceName: String, ordinal: Int? = nil,
                status: String? = nil, category: String? = nil, codeSystem: String? = nil,
                serviceCode: String? = nil, catalogEntryId: String? = nil, catalogDisplayName: String? = nil,
                matchStatus: String? = nil, confidence: String? = nil, evidence: String? = nil,
                notes: String? = nil, scheduledAt: Date? = nil, performedAt: Date? = nil,
                reportReceivedAt: Date? = nil, outcomeNote: String? = nil) {
        self.id = id; self.prescriptionId = prescriptionId; self.serviceName = serviceName; self.ordinal = ordinal; self.status = status; self.category = category; self.codeSystem = codeSystem; self.serviceCode = serviceCode; self.catalogEntryId = catalogEntryId; self.catalogDisplayName = catalogDisplayName; self.matchStatus = matchStatus; self.confidence = confidence; self.evidence = evidence; self.notes = notes; self.scheduledAt = scheduledAt; self.performedAt = performedAt; self.reportReceivedAt = reportReceivedAt; self.outcomeNote = outcomeNote
    }
}

/* @Codex */
public struct HomeBaseServicePrescriptionItemUpdatePayload: Encodable, Sendable {
    public let version: Int
    public let ordinal: Int?
    public let status: String?
    public let category: PatchValue<String>
    public let codeSystem: PatchValue<String>
    public let serviceCode: PatchValue<String>
    public let serviceName: String?
    public let catalogEntryId: PatchValue<String>
    public let catalogDisplayName: PatchValue<String>
    public let matchStatus: String?
    public let confidence: PatchValue<String>
    public let evidence: PatchValue<String>
    public let notes: PatchValue<String>
    public let scheduledAt: PatchValue<Date>
    public let performedAt: PatchValue<Date>
    public let reportReceivedAt: PatchValue<Date>
    public let outcomeNote: PatchValue<String>

    public init(version: Int, ordinal: Int? = nil, status: String? = nil, category: PatchValue<String> = .omit,
                codeSystem: PatchValue<String> = .omit, serviceCode: PatchValue<String> = .omit,
                serviceName: String? = nil, catalogEntryId: PatchValue<String> = .omit,
                catalogDisplayName: PatchValue<String> = .omit, matchStatus: String? = nil,
                confidence: PatchValue<String> = .omit, evidence: PatchValue<String> = .omit,
                notes: PatchValue<String> = .omit, scheduledAt: PatchValue<Date> = .omit,
                performedAt: PatchValue<Date> = .omit, reportReceivedAt: PatchValue<Date> = .omit,
                outcomeNote: PatchValue<String> = .omit) {
        self.version = version; self.ordinal = ordinal; self.status = status; self.category = category; self.codeSystem = codeSystem; self.serviceCode = serviceCode; self.serviceName = serviceName; self.catalogEntryId = catalogEntryId; self.catalogDisplayName = catalogDisplayName; self.matchStatus = matchStatus; self.confidence = confidence; self.evidence = evidence; self.notes = notes; self.scheduledAt = scheduledAt; self.performedAt = performedAt; self.reportReceivedAt = reportReceivedAt; self.outcomeNote = outcomeNote
    }

    private enum CodingKeys: String, CodingKey {
        case version, ordinal, status, category, codeSystem, serviceCode, serviceName
        case catalogEntryId, catalogDisplayName, matchStatus, confidence, evidence, notes
        case scheduledAt, performedAt, reportReceivedAt, outcomeNote
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encodeIfPresent(ordinal, forKey: .ordinal)
        try container.encodeIfPresent(status, forKey: .status)
        try container.encodePatch(category, forKey: .category)
        try container.encodePatch(codeSystem, forKey: .codeSystem)
        try container.encodePatch(serviceCode, forKey: .serviceCode)
        try container.encodeIfPresent(serviceName, forKey: .serviceName)
        try container.encodePatch(catalogEntryId, forKey: .catalogEntryId)
        try container.encodePatch(catalogDisplayName, forKey: .catalogDisplayName)
        try container.encodeIfPresent(matchStatus, forKey: .matchStatus)
        try container.encodePatch(confidence, forKey: .confidence)
        try container.encodePatch(evidence, forKey: .evidence)
        try container.encodePatch(notes, forKey: .notes)
        try container.encodePatch(scheduledAt, forKey: .scheduledAt)
        try container.encodePatch(performedAt, forKey: .performedAt)
        try container.encodePatch(reportReceivedAt, forKey: .reportReceivedAt)
        try container.encodePatch(outcomeNote, forKey: .outcomeNote)
    }
}

/* @Codex */
public struct HomeBaseProstheticPrescriptionCreatePayload: Encodable, Sendable {
    public let id: String?
    public let patientId: String
    public let prescribedAt: Date
    public let status: String?
    public let category: String?
    public let isoCode: String?
    public let description: String
    public let measures: String?
    public let clinicalReason: String?
    public let regionalPrescriptionId: String?
    public let supplier: String?
    public let collaudoAt: Date?
    public let collaudoOutcome: String?
    public let source: String?
    public let documentRefs: String?
    public let notes: String?

    public init(id: String? = nil, patientId: String, prescribedAt: Date, description: String,
                status: String? = nil, category: String? = nil, isoCode: String? = nil,
                measures: String? = nil, clinicalReason: String? = nil, regionalPrescriptionId: String? = nil,
                supplier: String? = nil, collaudoAt: Date? = nil, collaudoOutcome: String? = nil,
                source: String? = nil, documentRefs: String? = nil, notes: String? = nil) {
        self.id = id; self.patientId = patientId; self.prescribedAt = prescribedAt; self.description = description; self.status = status; self.category = category; self.isoCode = isoCode; self.measures = measures; self.clinicalReason = clinicalReason; self.regionalPrescriptionId = regionalPrescriptionId; self.supplier = supplier; self.collaudoAt = collaudoAt; self.collaudoOutcome = collaudoOutcome; self.source = source; self.documentRefs = documentRefs; self.notes = notes
    }
}

/* @Codex */
public struct HomeBaseProstheticPrescriptionUpdatePayload: Encodable, Sendable {
    public let version: Int
    public let prescribedAt: Date?
    public let status: String?
    public let category: String?
    public let isoCode: PatchValue<String>
    public let description: String?
    public let measures: PatchValue<String>
    public let clinicalReason: PatchValue<String>
    public let regionalPrescriptionId: PatchValue<String>
    public let supplier: PatchValue<String>
    public let collaudoAt: PatchValue<Date>
    public let collaudoOutcome: PatchValue<String>
    public let source: String?
    public let documentRefs: PatchValue<String>
    public let notes: PatchValue<String>

    public init(version: Int, prescribedAt: Date? = nil, status: String? = nil, category: String? = nil,
                isoCode: PatchValue<String> = .omit, description: String? = nil,
                measures: PatchValue<String> = .omit, clinicalReason: PatchValue<String> = .omit,
                regionalPrescriptionId: PatchValue<String> = .omit, supplier: PatchValue<String> = .omit,
                collaudoAt: PatchValue<Date> = .omit, collaudoOutcome: PatchValue<String> = .omit,
                source: String? = nil, documentRefs: PatchValue<String> = .omit,
                notes: PatchValue<String> = .omit) {
        self.version = version; self.prescribedAt = prescribedAt; self.status = status; self.category = category; self.isoCode = isoCode; self.description = description; self.measures = measures; self.clinicalReason = clinicalReason; self.regionalPrescriptionId = regionalPrescriptionId; self.supplier = supplier; self.collaudoAt = collaudoAt; self.collaudoOutcome = collaudoOutcome; self.source = source; self.documentRefs = documentRefs; self.notes = notes
    }

    private enum CodingKeys: String, CodingKey {
        case version, prescribedAt, status, category, isoCode, description, measures
        case clinicalReason, regionalPrescriptionId, supplier, collaudoAt, collaudoOutcome
        case source, documentRefs, notes
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encodeIfPresent(prescribedAt, forKey: .prescribedAt)
        try container.encodeIfPresent(status, forKey: .status)
        try container.encodeIfPresent(category, forKey: .category)
        try container.encodePatch(isoCode, forKey: .isoCode)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encodePatch(measures, forKey: .measures)
        try container.encodePatch(clinicalReason, forKey: .clinicalReason)
        try container.encodePatch(regionalPrescriptionId, forKey: .regionalPrescriptionId)
        try container.encodePatch(supplier, forKey: .supplier)
        try container.encodePatch(collaudoAt, forKey: .collaudoAt)
        try container.encodePatch(collaudoOutcome, forKey: .collaudoOutcome)
        try container.encodeIfPresent(source, forKey: .source)
        try container.encodePatch(documentRefs, forKey: .documentRefs)
        try container.encodePatch(notes, forKey: .notes)
    }
}

/* @Codex */
public enum HomeBaseJSONValue: Codable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: HomeBaseJSONValue])
    case array([HomeBaseJSONValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([HomeBaseJSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: HomeBaseJSONValue].self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

/* @Codex */
public struct HomeBaseFseDocumentValidationPayload: Encodable, Sendable {
    public let profile: String
    public let document: HomeBaseJSONValue?
    public let payload: HomeBaseJSONValue?

    public init(profile: String, document: HomeBaseJSONValue? = nil, payload: HomeBaseJSONValue? = nil) {
        self.profile = profile
        self.document = document
        self.payload = payload
    }
}

/* @Codex */
public struct HomeBaseFseValidationIssue: Codable, Hashable, Sendable {
    public let field: String
    public let code: String
    public let message: String

    public init(field: String, code: String, message: String) {
        self.field = field
        self.code = code
        self.message = message
    }
}

/* @Codex */
public struct HomeBaseFseValidationItem: Codable, Hashable, Sendable {
    public let id: String
    public let ok: Bool
    public let errors: [HomeBaseFseValidationIssue]
    public let warnings: [HomeBaseFseValidationIssue]

    public init(id: String, ok: Bool, errors: [HomeBaseFseValidationIssue], warnings: [HomeBaseFseValidationIssue]) {
        self.id = id
        self.ok = ok
        self.errors = errors
        self.warnings = warnings
    }
}

/* @Codex */
public struct HomeBaseFseValidationSummary: Codable, Hashable, Sendable {
    public let total: Int
    public let ok: Int
    public let withErrors: Int
    public let withWarnings: Int
    public let errorCount: Int
    public let warningCount: Int
    public let items: [HomeBaseFseValidationItem]

    public init(total: Int, ok: Int, withErrors: Int, withWarnings: Int,
                errorCount: Int, warningCount: Int, items: [HomeBaseFseValidationItem]) {
        self.total = total; self.ok = ok; self.withErrors = withErrors; self.withWarnings = withWarnings; self.errorCount = errorCount; self.warningCount = warningCount; self.items = items
    }
}

/* @Codex */
public struct HomeBaseValidatePatientExportResponse: Codable, Hashable, Sendable {
    public let patientId: String
    public let hasErrors: Bool
    public let hasWarnings: Bool
    public let therapyMedication: HomeBaseFseValidationSummary
    public let observationVitals: HomeBaseFseValidationSummary

    public init(patientId: String, hasErrors: Bool, hasWarnings: Bool,
                therapyMedication: HomeBaseFseValidationSummary,
                observationVitals: HomeBaseFseValidationSummary) {
        self.patientId = patientId; self.hasErrors = hasErrors; self.hasWarnings = hasWarnings; self.therapyMedication = therapyMedication; self.observationVitals = observationVitals
    }
}

/* @Codex */
public struct HomeBaseFseDocumentValidationResponse: Codable, Hashable, Sendable {
    public let ok: Bool
    public let profile: String
    public let errors: [HomeBaseFseValidationIssue]
    public let warnings: [HomeBaseFseValidationIssue]

    public init(ok: Bool, profile: String, errors: [HomeBaseFseValidationIssue], warnings: [HomeBaseFseValidationIssue]) {
        self.ok = ok
        self.profile = profile
        self.errors = errors
        self.warnings = warnings
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
