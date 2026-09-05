import Crypto
import Foundation

// ADR 0071 Fase 3 (Codex-directed): the in-process local-authority adapter. A serial
// `actor` so the synchronous SQLite reads/writes run off the MainActor. Serves
// in-process, straight from the on-device medical.db: patient list/detail (slice 2),
// patient UPDATE (slice 3), clinical list reads for all 4 sub-resources (slice 4), and
// clinical create/update for all 4 sub-resources (slice 5) - every write path uses
// sealOrPassthrough (SQLitePatientStore + SQLiteClinicalStore.AssignmentBuilder) so
// the model's pre-sealed HTTP payloads are never double-encrypted. Only login,
// ambulatories, and unscoped operations still delegate to the HTTP `fallback`. The
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
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?,
        includeDeleted: Bool
    ) async throws -> [HomeBasePatientSummary] {
        // Scoped by the patients_to_ambulatories membership when present; else all active.
        try patientStore.listPatients(
            scopeAmbulatoryId: ambulatoryId?.isEmpty == false ? ambulatoryId : nil,
            includeDeleted: includeDeleted)
    }

    /* @Codex */
    public func fetchPatient(
        id: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBasePatientDetail {
        // Preserve raw ENC parity with the HTTP data source. The workspace model owns
        // decrypt-or-lock resolution so failed decrypts cannot be collapsed to nil.
        let scope = ambulatoryId?.isEmpty == false ? ambulatoryId : nil
        guard let detail = try patientStore.loadRawPatientDetail(id: id, scopeAmbulatoryId: scope) else {
            throw HomeBaseClientError.httpStatus(404, "Not found")  // 1:1 with the HTTP 404
        }
        return detail
    }

    // MARK: Delegated to HTTP when local authority cannot serve the operation

    public func login(
        username: String?, password: String, credentials: HomeBasePairedCredentials
    ) async throws -> HomeBaseLoginResult {
        try await fallback.login(username: username, password: password, credentials: credentials)
    }

    public func changePin(
        currentPin: String, newPin: String, encryptedMasterKey: String, salt: String,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseMutationAcknowledgement {
        try await fallback.changePin(
            currentPin: currentPin,
            newPin: newPin,
            encryptedMasterKey: encryptedMasterKey,
            salt: salt,
            credentials: credentials,
            sessionCookie: sessionCookie
        )
    }

    public func logout(
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseMutationAcknowledgement {
        try await fallback.logout(credentials: credentials, sessionCookie: sessionCookie)
    }

    public func updateProfile(
        userId: String, displayName: String, ambulatoryName: String,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseMutationAcknowledgement {
        try await fallback.updateProfile(
            userId: userId,
            displayName: displayName,
            ambulatoryName: ambulatoryName,
            credentials: credentials,
            sessionCookie: sessionCookie
        )
    }

    public func fetchNetworkAmbulatories(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [NetworkAmbulatorySummary] {
        try await fallback.fetchNetworkAmbulatories(
            credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    public func createAmbulatory(
        payload: HomeBaseAmbulatoryCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseAmbulatoryMutationResponse {
        throw HomeBaseClientError.localAuthorityUnsupported("Creazione ambulatorio")
    }

    public func updateAmbulatory(
        id: String, payload: HomeBaseAmbulatoryUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseAmbulatoryMutationResponse {
        throw HomeBaseClientError.localAuthorityUnsupported("Aggiornamento ambulatorio")
    }

    public func deleteAmbulatory(
        id: String, expectedVersion: Int,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseAmbulatoryMutationResponse {
        throw HomeBaseClientError.localAuthorityUnsupported("Eliminazione ambulatorio")
    }

    public func clearAmbulatory(
        id: String, expectedVersion: Int,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseAmbulatoryMutationResponse {
        throw HomeBaseClientError.localAuthorityUnsupported("Pulizia ambulatorio")
    }

    /* @Codex */
    public func fetchPatients(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, includeDiagnoses: Bool
    ) async throws -> [HomeBasePatientSummary] {
        try patientStore.listPatients(
            scopeAmbulatoryId: ambulatoryId?.isEmpty == false ? ambulatoryId : nil,
            includeDiagnoses: includeDiagnoses)
    }

    /* @Codex */
    public func fetchScopedCheckups(
        dateFrom: Date?, dateTo: Date?, status: [String], limit: Int?,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseCheckupSummary] {
        try await fallback.fetchScopedCheckups(
            dateFrom: dateFrom, dateTo: dateTo, status: status, limit: limit,
            credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func fetchScopedEntries(
        type: String?, dateFrom: Date?, dateTo: Date?, limit: Int?,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseEntrySummary] {
        try await fallback.fetchScopedEntries(
            type: type, dateFrom: dateFrom, dateTo: dateTo, limit: limit,
            credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func searchDrugs(
        query: String, limit: Int,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseDrugSummary] {
        try await fallback.searchDrugs(
            query: query, limit: limit, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func searchExemptions(
        query: String, limit: Int,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseExemptionSummary] {
        try await fallback.searchExemptions(
            query: query, limit: limit, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func searchTerminology(
        system: String, query: String, limit: Int,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseTerminologyItem] {
        try await fallback.searchTerminology(
            system: system, query: query, limit: limit, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func resolveTerminology(
        system: String, code: String,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseTerminologyItem {
        try await fallback.resolveTerminology(
            system: system, code: code, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func fetchTerminologySystems(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseTerminologyRegistryEntry] {
        try await fallback.fetchTerminologySystems(
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

    // Local patient CREATE (ADR 0071). No paired wire peer exists, so this is the ONLY
    // real create path. The store seals the ENCRYPTED_FIELDS in-core (seal-or-passthrough,
    // so plaintext form values are sealed and any already-ENC value passes through), runs
    // the INSERT + membership upsert in one transaction, and returns the new id+version.
    // A non-empty scope is required (it becomes the patients_to_ambulatories membership so
    // the new patient is visible in the scoped list); without one we fall back to HTTP,
    // which fails fast (there is no create peer).
    public func createPatient(
        payload: HomeBasePatientCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        guard let scope = ambulatoryId, !scope.isEmpty else {
            return try await fallback.createPatient(
                payload: payload, credentials: credentials,
                sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        }
        return try mapped(try patientStore.createPatient(
            payload, scopeAmbulatoryId: scope, masterKey: masterKey))
    }

    public func softDeletePatient(
        id: String,
        version: Int,
        sealedReason: String?,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        guard ambulatoryId?.isEmpty == false else {
            return try await fallback.softDeletePatient(
                id: id, version: version, sealedReason: sealedReason,
                credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        }
        let reason = sealedReason ?? "paired-delete"
        let outcome = try patientStore.softDeletePatient(
            id: id, version: version, deletionReason: reason, masterKey: masterKey,
            scopeAmbulatoryId: ambulatoryId)
        return try mappedResource(outcome, id: id)
    }

    public func restorePatient(
        id: String,
        version: Int,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        guard ambulatoryId?.isEmpty == false else {
            return try await fallback.restorePatient(
                id: id, version: version, credentials: credentials,
                sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        }
        return try mappedResource(
            try patientStore.restorePatient(id: id, version: version, scopeAmbulatoryId: ambulatoryId),
            id: id)
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

    private func mapped(_ outcome: SQLitePatientStore.PatientCreateOutcome) throws -> HomeBaseCreatedResource {
        switch outcome {
        case .created(let id, let version):
            return HomeBaseCreatedResource(id: id, version: version)
        case .encryptionFailed:
            throw HomeBaseClientError.httpStatus(500, "Cifratura non disponibile: riaccedi con il PIN operatore.")
        }
    }

    private func mappedResource(_ outcome: SQLitePatientStore.PatientWriteOutcome, id: String) throws -> HomeBaseCreatedResource {
        switch outcome {
        case .updated(let version):
            return HomeBaseCreatedResource(id: id, version: version)
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

    public func fetchAttachments(
        patientId: String,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseAttachmentSummary] {
        try await fallback.fetchAttachments(
            patientId: patientId, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    public func fetchAttachment(
        patientId: String, attachmentId: String,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseAttachmentDetail {
        try await fallback.fetchAttachment(
            patientId: patientId, attachmentId: attachmentId, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    public func createAttachment(
        patientId: String, payload: HomeBaseAttachmentCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        try await fallback.createAttachment(
            patientId: patientId, payload: payload, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    public func computeVisitDraft(
        input: HomeBaseVisitDraftInput,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseVisitDraftResponse {
        try await fallback.computeVisitDraft(
            input: input, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    public func fetchAiRuntimeStatus(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseNetworkAiRuntimeSummary {
        try await fallback.fetchAiRuntimeStatus(
            credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
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

    /* @Codex */
    public func fetchServicePrescriptions(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseServicePrescriptionSummary] {
        try await fallback.fetchServicePrescriptions(
            patientId: patientId, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func createServicePrescription(
        payload: HomeBaseServicePrescriptionCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        try await fallback.createServicePrescription(
            payload: payload, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func updateServicePrescription(
        prescriptionId: String, payload: HomeBaseServicePrescriptionUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        try await fallback.updateServicePrescription(
            prescriptionId: prescriptionId, payload: payload, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func fetchServicePrescriptionItems(
        patientId: String?, prescriptionId: String?,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseServicePrescriptionItemSummary] {
        try await fallback.fetchServicePrescriptionItems(
            patientId: patientId, prescriptionId: prescriptionId, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func createServicePrescriptionItem(
        payload: HomeBaseServicePrescriptionItemCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        try await fallback.createServicePrescriptionItem(
            payload: payload, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func updateServicePrescriptionItem(
        itemId: String, payload: HomeBaseServicePrescriptionItemUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        try await fallback.updateServicePrescriptionItem(
            itemId: itemId, payload: payload, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func fetchServiceCatalog(
        query: String?, code: String?, limit: Int,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseServiceCatalogEntrySummary] {
        try await fallback.fetchServiceCatalog(
            query: query, code: code, limit: limit, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func fetchServiceCatalogCount(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCatalogCountResponse {
        try await fallback.fetchServiceCatalogCount(
            credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func fetchProstheticPrescriptions(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseProstheticPrescriptionSummary] {
        try await fallback.fetchProstheticPrescriptions(
            patientId: patientId, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func createProstheticPrescription(
        payload: HomeBaseProstheticPrescriptionCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        try await fallback.createProstheticPrescription(
            payload: payload, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func updateProstheticPrescription(
        prescriptionId: String, payload: HomeBaseProstheticPrescriptionUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        try await fallback.updateProstheticPrescription(
            prescriptionId: prescriptionId, payload: payload, credentials: credentials,
            sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func fetchNetworkCapabilities(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> NetworkCapabilitiesResponse {
        try await fallback.fetchNetworkCapabilities(
            credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func fetchNetworkIdentity(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> NetworkIdentitySummary {
        try await fallback.fetchNetworkIdentity(
            credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func fetchNetworkNode(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> NetworkNodeSummary {
        try await fallback.fetchNetworkNode(
            credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func fetchNetworkRevision(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> NetworkRevisionSummary {
        try await fallback.fetchNetworkRevision(
            credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func fetchFseValidatePatient(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseValidatePatientExportResponse {
        try await fallback.fetchFseValidatePatient(
            patientId: patientId, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    public func validateFseDocument(
        payload: HomeBaseFseDocumentValidationPayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseFseDocumentValidationResponse {
        try await fallback.validateFseDocument(
            payload: payload, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }
}
