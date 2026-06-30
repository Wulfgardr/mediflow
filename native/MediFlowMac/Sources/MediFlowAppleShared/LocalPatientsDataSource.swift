import Crypto
import Foundation

// ADR 0071 Fase 3 (Codex-directed, slice 2): the in-process local-authority adapter.
// A serial `actor` so the synchronous SQLite reads run off the MainActor. This first
// adapter serves the SAFE half locally - patient LIST + DETAIL straight from the
// on-device medical.db via SQLitePatientStore (the reversed-flow read path drives the
// app) - and DELEGATES everything else (login, ambulatories, all writes, all clinical
// reads) to the HTTP `fallback`. The masterKey crosses only Swift call frames inside
// the app process (no FFI / loopback / IPC), per the KeyStore rule.
//
// Deferred to a later slice (needs the double-encryption decision, Codex to confirm):
// local WRITES - the model pre-seals write payloads for HTTP, so routing them into the
// stores (which seal internally) would double-encrypt. And local CLINICAL reads need
// read methods on SQLiteClinicalStore (create/update only today).
public actor LocalPatientsDataSource: HomeBasePatientsDataSource {
    private let patientStore: SQLitePatientStore
    private let masterKey: SymmetricKey
    private let fallback: any HomeBasePatientsDataSource

    public init(databasePath: String, masterKey: SymmetricKey, fallback: any HomeBasePatientsDataSource) {
        self.patientStore = SQLitePatientStore(path: databasePath)
        self.masterKey = masterKey
        self.fallback = fallback
    }

    // MARK: Local patient reads (the reversed-flow read path)

    public func fetchPatients(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBasePatientSummary] {
        // Scoped by the denormalized ambulatory when present; otherwise all active.
        try patientStore.listPatients(scopeAmbulatoryId: ambulatoryId?.isEmpty == false ? ambulatoryId : nil)
    }

    public func fetchPatient(
        id: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBasePatientDetail {
        // loadPatientDetail decrypts the ENCRYPTED_FIELDS in-core; the model's later
        // decryptDetail is a benign no-op (already-plaintext passes through).
        guard let detail = try patientStore.loadPatientDetail(id: id, masterKey: masterKey) else {
            throw HomeBaseClientError.httpStatus(404, "Not found")  // 1:1 with the HTTP 404
        }
        return detail
    }

    // MARK: Delegated to HTTP (not yet local) — login, ambulatories, all writes, clinical reads

    public func login(username: String?, password: String) async throws -> HomeBaseLoginResult {
        try await fallback.login(username: username, password: password)
    }

    public func fetchNetworkAmbulatories(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [NetworkAmbulatorySummary] {
        try await fallback.fetchNetworkAmbulatories(
            credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    // Local patient WRITE (Fase 3 slice 3). The model pre-seals the payload for HTTP;
    // SQLitePatientStore now uses sealOrPassthrough, so authenticated ciphertext passes
    // through verbatim (no double-encryption). Needs a scope; falls back to HTTP when
    // none is given (the web resolves the default scope server-side). Outcomes map to
    // the same errors the model already handles (versionConflict / httpStatus).
    public func updatePatient(
        patientId: String, payload: HomeBasePatientUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        guard let scope = ambulatoryId, !scope.isEmpty else {
            return try await fallback.updatePatient(
                patientId: patientId, payload: payload, credentials: credentials,
                sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        }
        let outcome = try patientStore.updatePatient(
            id: patientId, scopeAmbulatoryId: scope, payload: payload, masterKey: masterKey)
        switch outcome {
        case .updated:
            return HomeBaseMutationAcknowledgement(success: true)
        case .conflict(let conflictPayload):
            throw HomeBaseClientError.versionConflict(conflictPayload)
        case .versionRequired, .noValidFields, .notFound, .boundaryRejected, .encryptionFailed:
            let wire = outcome.wireResponse
            throw HomeBaseClientError.httpStatus(wire.status, wire.error)
        }
    }

    public func fetchEntries(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String,
        ambulatoryId: String?, limit: Int
    ) async throws -> [HomeBaseEntrySummary] {
        try await fallback.fetchEntries(
            patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
            ambulatoryId: ambulatoryId, limit: limit)
    }

    public func createEntry(
        patientId: String, payload: HomeBaseEntryCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        try await fallback.createEntry(
            patientId: patientId, payload: payload, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    public func updateEntry(
        patientId: String, entryId: String, payload: HomeBaseEntryUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        try await fallback.updateEntry(
            patientId: patientId, entryId: entryId, payload: payload, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    public func fetchTherapies(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String,
        ambulatoryId: String?, limit: Int
    ) async throws -> [HomeBaseTherapySummary] {
        try await fallback.fetchTherapies(
            patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
            ambulatoryId: ambulatoryId, limit: limit)
    }

    public func createTherapy(
        patientId: String, payload: HomeBaseTherapyCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        try await fallback.createTherapy(
            patientId: patientId, payload: payload, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    public func updateTherapy(
        patientId: String, therapyId: String, payload: HomeBaseTherapyUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        try await fallback.updateTherapy(
            patientId: patientId, therapyId: therapyId, payload: payload, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    public func fetchCheckups(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String,
        ambulatoryId: String?, limit: Int
    ) async throws -> [HomeBaseCheckupSummary] {
        try await fallback.fetchCheckups(
            patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
            ambulatoryId: ambulatoryId, limit: limit)
    }

    public func createCheckup(
        patientId: String, payload: HomeBaseCheckupCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        try await fallback.createCheckup(
            patientId: patientId, payload: payload, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    public func updateCheckup(
        patientId: String, checkupId: String, payload: HomeBaseCheckupUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        try await fallback.updateCheckup(
            patientId: patientId, checkupId: checkupId, payload: payload, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    public func fetchObservations(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String,
        ambulatoryId: String?, limit: Int
    ) async throws -> [HomeBaseObservationSummary] {
        try await fallback.fetchObservations(
            patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
            ambulatoryId: ambulatoryId, limit: limit)
    }

    public func createObservation(
        patientId: String, payload: HomeBaseObservationCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        try await fallback.createObservation(
            patientId: patientId, payload: payload, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    public func updateObservation(
        patientId: String, observationId: String, payload: HomeBaseObservationUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        try await fallback.updateObservation(
            patientId: patientId, observationId: observationId, payload: payload, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }
}
