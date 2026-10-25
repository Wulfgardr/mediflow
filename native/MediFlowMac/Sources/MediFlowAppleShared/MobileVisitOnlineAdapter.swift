import CryptoKit
import Foundation
import MediFlowCore

@MainActor
protocol MobileVisitOnlineReading {
    var loginDigest: Data { get }
    func acquire(patientID: String, forImport: Bool) async throws -> MobileVisitDossier
}

@MainActor
struct MobileVisitOnlineAdapter: MobileVisitOnlineReading {
    private let makeClient: () -> HomeBasePatientsClient
    let configuration: HomeBaseConnectionConfiguration
    let credentials: HomeBasePairedCredentials
    let sessionCookie: String
    let operatorID: String
    let scopeID: String
    let masterKey: SymmetricKey
    let isCurrent: () -> Bool
    var now: () -> Date = Date.init
    var loginDigest: Data { Data(SHA256.hash(data: Data(sessionCookie.utf8))) }

    init(configuration: HomeBaseConnectionConfiguration, credentials: HomeBasePairedCredentials,
         sessionCookie: String, operatorID: String, scopeID: String, masterKey: SymmetricKey,
         isCurrent: @escaping () -> Bool, now: @escaping () -> Date = Date.init,
         clientFactory: (() -> HomeBasePatientsClient)? = nil) {
        self.configuration = configuration
        self.credentials = credentials
        self.sessionCookie = sessionCookie
        self.operatorID = operatorID
        self.scopeID = scopeID
        self.masterKey = masterKey
        self.isCurrent = isCurrent
        self.now = now
        self.makeClient = clientFactory ?? { HomeBasePatientsClient(configuration: configuration) }
    }

    func acquire(patientID: String, forImport: Bool) async throws -> MobileVisitDossier {
        let started = now()
        try checkCurrent()
        let before = try await authority(patientID: patientID, forImport: forImport)
        try checkCurrent()
        let client = makeClient()
        let entries = try await client.fetchEntries(patientId: patientID, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: scopeID, limit: 100, fresh: true)
        try checkCurrent()
        let therapies = try await client.fetchTherapies(patientId: patientID, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: scopeID, limit: 100, fresh: true)
        try checkCurrent()
        let after = try await authority(patientID: patientID, forImport: forImport)
        try checkCurrent()
        guard before.context == after.context, before.patient.version == after.patient.version,
              before.patient.updatedAt == after.patient.updatedAt,
              entries.allSatisfy({ $0.patientId == patientID && $0.version > 0 }),
              therapies.allSatisfy({ $0.patientId == patientID && $0.version > 0 }),
              Set(entries.map(\.id)).count == entries.count,
              Set(therapies.map(\.id)).count == therapies.count,
              now() >= started, now().timeIntervalSince(started) < 86_400 else { throw MobileVisitError.changed }
        let patient = after.patient
        let profileText = ["\(patient.lastName) \(patient.firstName)",
                           "Diagnosi: \(field(patient.diagnoses))", "Note: \(field(patient.notes))"].joined(separator: "\n")
        let sections = [
            MobileVisitSection(id: "profile", source: "GET /api/v1/network/patients/{id}",
                rows: [.init(id: patientID, version: patient.version, text: profileText)],
                limitation: "Profilo minimo: anagrafica, diagnosi e note; altri campi non acquisiti."),
            MobileVisitSection(id: "therapies", source: "GET /api/v1/network/patients/{id}/therapies?limit=100",
                rows: therapies.filter { $0.deletedAt == nil }.map {
                    .init(id: $0.id, version: $0.version,
                          text: "\(field($0.drugName)) — \(field($0.dosage)) · \($0.status)")
                }, limitation: "Massimo 100 terapie; selezione limitata, non prova di completezza dell’archivio."),
            MobileVisitSection(id: "diary", source: "GET /api/v1/network/patients/{id}/entries?limit=100",
                rows: entries.filter { $0.deletedAt == nil }.map {
                    .init(id: $0.id, version: $0.version,
                          text: "\($0.date.formatted(date: .numeric, time: .shortened)) · \(field($0.title))\n\(field($0.content))")
                }, limitation: "Massimo 100 voci; allegati esclusi. Le sezioni sono lette in sequenza, non in uno snapshot transazionale.")
        ]
        return MobileVisitDossier(id: UUID(), context: after.context,
            patientName: "\(patient.lastName) \(patient.firstName)", acquiredAt: started,
            expiresAt: started.addingTimeInterval(86_400), sections: sections,
            omissions: ["Documenti e allegati", "Checkup e osservazioni", "Prescrizioni", "Funzioni intelligenti: richiedono l’host online"])
    }

    private func checkCurrent() throws {
        guard isCurrent(), !Task.isCancelled else { throw MobileVisitError.locked }
    }

    private func authority(patientID: String, forImport: Bool) async throws
        -> (context: MobileVisitContext, patient: HomeBasePatientDetail) {
        try checkCurrent()
        let client = makeClient()
        let profile = try await client.fetchAccountProfile(credentials: credentials, sessionCookie: sessionCookie)
        try checkCurrent()
        let identity = try await client.fetchNetworkIdentity(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: scopeID)
        try checkCurrent()
        let capabilities = try await client.fetchNetworkCapabilities(credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: scopeID)
        try checkCurrent()
        let available = Set(capabilities.capabilities.filter { $0.status == "available" }.map(\.key))
        guard profile.userId == operatorID, identity.operator.userId == operatorID,
              identity.scope.effectiveAmbulatoryId == scopeID,
              available.contains("network.replica.readonly-patients"),
              !forImport || (available.contains("network.replica.write-clinical-diary")) else {
            throw MobileVisitError.denied
        }
        let patient = try await client.fetchPatient(id: patientID, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: scopeID, fresh: true)
        try checkCurrent()
        let context = MobileVisitContext(serverURL: try configuration.apiBaseURL().absoluteString,
            tlsPin: configuration.normalizedTLSPin, pairedClientID: credentials.clientId,
            pairedTokenDigest: Data(SHA256.hash(data: Data(credentials.clientToken.utf8))),
            archiveGeneration: profile.archiveGeneration, operatorID: operatorID, scopeID: scopeID, patientID: patientID)
        guard context.isValid, patient.id == patientID, patient.ambulatoryId == scopeID,
              patient.deletedAt == nil, patient.version > 0 else { throw MobileVisitError.invalidContext }
        return (context, patient)
    }

    private func field(_ value: String?) -> String {
        switch PatientFieldCrypto.resolveStringField(value, masterKey: masterKey) {
        case .absent: return "Non presente nella fonte acquisita"
        case .locked: return "Non disponibile: campo non decifrabile"
        case .plaintext(let text): return text.isEmpty ? "Vuoto nella fonte acquisita" : text
        }
    }
}
