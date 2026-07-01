import Crypto
import Foundation

// ADR 0071 Fase 3 (Codex-directed): the in-process local-authority adapter. A serial
// `actor` so the synchronous SQLite reads/writes run off the MainActor. Serves
// in-process, straight from the on-device medical.db: patient list/detail (slice 2),
// patient UPDATE (slice 3), clinical list reads for all 4 sub-resources (slice 4), and
// clinical create/update for all 4 sub-resources (slice 5) - every write path uses
// sealOrPassthrough (SQLitePatientStore + SQLiteClinicalStore.AssignmentBuilder) so
// the model's pre-sealed HTTP payloads are never double-encrypted. Only login,
// ambulatories, and patient create/soft-delete (NOT exposed on the paired-client wire
// protocol at all - no web peer to wire) still DELEGATE to the HTTP `fallback`. The
// masterKey crosses only Swift call frames inside the app process (no FFI / loopback /
// IPC), per the KeyStore rule. Every local write/read needs a non-empty ambulatoryId
// scope (joined against the patients_to_ambulatories membership); without one, the
// call falls back to HTTP (matching the web, which resolves the default scope
// server-side - a capability the local store does not have).
public actor LocalPatientsDataSource: HomeBasePatientsDataSource {
    private let patientStore: SQLitePatientStore
    private let clinicalStore: SQLiteClinicalStore
    private let masterKey: SymmetricKey
    private let fallback: any HomeBasePatientsDataSource

    public init(databasePath: String, masterKey: SymmetricKey, fallback: any HomeBasePatientsDataSource) {
        self.patientStore = SQLitePatientStore(path: databasePath)
        self.clinicalStore = SQLiteClinicalStore(path: databasePath)
        self.masterKey = masterKey
        self.fallback = fallback
    }

    // MARK: Local patient reads (the reversed-flow read path)

    public func fetchPatients(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBasePatientSummary] {
        // Scoped by the patients_to_ambulatories membership when present; else all active.
        try patientStore.listPatients(scopeAmbulatoryId: ambulatoryId?.isEmpty == false ? ambulatoryId : nil)
    }

    public func fetchPatient(
        id: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBasePatientDetail {
        // loadPatientDetail decrypts the ENCRYPTED_FIELDS in-core; the model's later
        // decryptDetail is a benign no-op (already-plaintext passes through). Scoped by
        // the membership when present (1:1 with getNetworkScopedPatient's 404).
        let scope = ambulatoryId?.isEmpty == false ? ambulatoryId : nil
        guard let detail = try patientStore.loadPatientDetail(id: id, scopeAmbulatoryId: scope, masterKey: masterKey) else {
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
        return try mapped(try patientStore.updatePatient(
            id: patientId, scopeAmbulatoryId: scope, payload: payload, masterKey: masterKey))
    }

    // MARK: Outcome -> wire-error mapping (shared by every local write below)

    private func mapped(_ outcome: SQLitePatientStore.PatientWriteOutcome) throws -> HomeBaseMutationAcknowledgement {
        switch outcome {
        case .updated:
            return HomeBaseMutationAcknowledgement(success: true)
        case .conflict(let payload):
            throw HomeBaseClientError.versionConflict(payload)
        case .versionRequired, .noValidFields, .notFound, .boundaryRejected, .encryptionFailed:
            let wire = outcome.wireResponse
            throw HomeBaseClientError.httpStatus(wire.status, wire.error)
        }
    }

    private func mapped(_ outcome: SQLiteClinicalStore.ClinicalWriteOutcome) throws -> HomeBaseMutationAcknowledgement {
        switch outcome {
        case .updated:
            return HomeBaseMutationAcknowledgement(success: true)
        case .conflict(let payload):
            throw HomeBaseClientError.versionConflict(payload)
        case .versionRequired, .noValidFields, .notFound, .boundaryRejected, .encryptionFailed:
            let wire = outcome.wireResponse
            throw HomeBaseClientError.httpStatus(wire.status, wire.error)
        }
    }

    /// `.idempotent` reports the same success shape as `.created` (the web's 200
    /// idempotent body also carries {id, version}); only the HTTP status differs, and
    /// the protocol's HomeBaseCreatedResource has no field for it.
    private func mapped(_ outcome: SQLiteClinicalStore.ClinicalCreateOutcome) throws -> HomeBaseCreatedResource {
        switch outcome {
        case .created(let id, let version), .idempotent(let id, let version):
            return HomeBaseCreatedResource(id: id, version: version)
        case .idConflict, .boundaryRejected, .notFound, .encryptionFailed:
            let wire = outcome.wireResponse
            throw HomeBaseClientError.httpStatus(wire.status, wire.error)
        }
    }

    // Local clinical reads (Fase 3 slice 4). Needs a scope to join against the
    // patients_to_ambulatories membership; falls back to HTTP when none is given.
    public func fetchEntries(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String,
        ambulatoryId: String?, limit: Int
    ) async throws -> [HomeBaseEntrySummary] {
        guard let scope = ambulatoryId, !scope.isEmpty else {
            return try await fallback.fetchEntries(
                patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: ambulatoryId, limit: limit)
        }
        return try clinicalStore.listEntries(
            patientId: patientId, scopeAmbulatoryId: scope, masterKey: masterKey, limit: limit)
    }

    public func createEntry(
        patientId: String, payload: HomeBaseEntryCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        guard let scope = ambulatoryId, !scope.isEmpty else {
            return try await fallback.createEntry(
                patientId: patientId, payload: payload, credentials: credentials,
                sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        }
        return try mapped(try clinicalStore.createEntry(
            payload, patientId: patientId, scopeAmbulatoryId: scope, masterKey: masterKey))
    }

    public func updateEntry(
        patientId: String, entryId: String, payload: HomeBaseEntryUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        guard let scope = ambulatoryId, !scope.isEmpty else {
            return try await fallback.updateEntry(
                patientId: patientId, entryId: entryId, payload: payload, credentials: credentials,
                sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        }
        return try mapped(try clinicalStore.updateEntry(
            id: entryId, patientId: patientId, scopeAmbulatoryId: scope, payload: payload, masterKey: masterKey))
    }

    public func fetchTherapies(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String,
        ambulatoryId: String?, limit: Int
    ) async throws -> [HomeBaseTherapySummary] {
        guard let scope = ambulatoryId, !scope.isEmpty else {
            return try await fallback.fetchTherapies(
                patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: ambulatoryId, limit: limit)
        }
        return try clinicalStore.listTherapies(
            patientId: patientId, scopeAmbulatoryId: scope, masterKey: masterKey, limit: limit)
    }

    public func createTherapy(
        patientId: String, payload: HomeBaseTherapyCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        guard let scope = ambulatoryId, !scope.isEmpty else {
            return try await fallback.createTherapy(
                patientId: patientId, payload: payload, credentials: credentials,
                sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        }
        return try mapped(try clinicalStore.createTherapy(
            payload, patientId: patientId, scopeAmbulatoryId: scope, masterKey: masterKey))
    }

    public func updateTherapy(
        patientId: String, therapyId: String, payload: HomeBaseTherapyUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        guard let scope = ambulatoryId, !scope.isEmpty else {
            return try await fallback.updateTherapy(
                patientId: patientId, therapyId: therapyId, payload: payload, credentials: credentials,
                sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        }
        return try mapped(try clinicalStore.updateTherapy(
            id: therapyId, patientId: patientId, scopeAmbulatoryId: scope, payload: payload, masterKey: masterKey))
    }

    public func fetchCheckups(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String,
        ambulatoryId: String?, limit: Int
    ) async throws -> [HomeBaseCheckupSummary] {
        guard let scope = ambulatoryId, !scope.isEmpty else {
            return try await fallback.fetchCheckups(
                patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: ambulatoryId, limit: limit)
        }
        return try clinicalStore.listCheckups(
            patientId: patientId, scopeAmbulatoryId: scope, masterKey: masterKey, limit: limit)
    }

    public func createCheckup(
        patientId: String, payload: HomeBaseCheckupCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        guard let scope = ambulatoryId, !scope.isEmpty else {
            return try await fallback.createCheckup(
                patientId: patientId, payload: payload, credentials: credentials,
                sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        }
        return try mapped(try clinicalStore.createCheckup(
            payload, patientId: patientId, scopeAmbulatoryId: scope, masterKey: masterKey))
    }

    public func updateCheckup(
        patientId: String, checkupId: String, payload: HomeBaseCheckupUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        guard let scope = ambulatoryId, !scope.isEmpty else {
            return try await fallback.updateCheckup(
                patientId: patientId, checkupId: checkupId, payload: payload, credentials: credentials,
                sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        }
        return try mapped(try clinicalStore.updateCheckup(
            id: checkupId, patientId: patientId, scopeAmbulatoryId: scope, payload: payload, masterKey: masterKey))
    }

    public func fetchObservations(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String,
        ambulatoryId: String?, limit: Int
    ) async throws -> [HomeBaseObservationSummary] {
        guard let scope = ambulatoryId, !scope.isEmpty else {
            return try await fallback.fetchObservations(
                patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: ambulatoryId, limit: limit)
        }
        return try clinicalStore.listObservations(
            patientId: patientId, scopeAmbulatoryId: scope, masterKey: masterKey, limit: limit)
    }

    public func createObservation(
        patientId: String, payload: HomeBaseObservationCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        guard let scope = ambulatoryId, !scope.isEmpty else {
            return try await fallback.createObservation(
                patientId: patientId, payload: payload, credentials: credentials,
                sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        }
        return try mapped(try clinicalStore.createObservation(
            payload, patientId: patientId, scopeAmbulatoryId: scope, masterKey: masterKey))
    }

    public func updateObservation(
        patientId: String, observationId: String, payload: HomeBaseObservationUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        guard let scope = ambulatoryId, !scope.isEmpty else {
            return try await fallback.updateObservation(
                patientId: patientId, observationId: observationId, payload: payload, credentials: credentials,
                sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        }
        return try mapped(try clinicalStore.updateObservation(
            id: observationId, patientId: patientId, scopeAmbulatoryId: scope, payload: payload, masterKey: masterKey))
    }
}
