import Foundation

/* @Codex */
public enum HomeBaseClinicalListLimit {
    public static let boundaryMaximum = 100

    public static func clamped(_ limit: Int) -> Int {
        max(1, min(limit, boundaryMaximum))
    }
}

// ADR 0071 Fase 3 (Codex-directed): the data-source seam. This protocol captures the
// exact async surface PairedPatientsWorkspaceModel uses today, so the model can depend
// on `any HomeBasePatientsDataSource` instead of the concrete HTTP actor. This first
// slice is a ZERO-behavior-change refactor: HomeBasePatientsClient conforms as-is and
// makeClient() keeps returning it. It unblocks swapping in an in-process SQLite-backed
// adapter (SQLitePatientStore + SQLiteClinicalStore) behind the same surface later,
// without touching the 1831-LOC model's call sites.
//
// Sendable (not an `actor` protocol) so both the HTTP actor and a future serial-actor
// local adapter can conform and cross actor boundaries as an existential.
public protocol HomeBasePatientsDataSource: Sendable {
    func login(username: String?, password: String) async throws -> HomeBaseLoginResult

    func fetchPatients(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, includeDeleted: Bool
    ) async throws -> [HomeBasePatientSummary]

    func fetchNetworkAmbulatories(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [NetworkAmbulatorySummary]

    /* @Codex */
    func searchDrugs(
        query: String, limit: Int,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseDrugSummary]

    /* @Codex */
    func searchExemptions(
        query: String, limit: Int,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseExemptionSummary]

    /* @Codex */
    func searchTerminology(
        system: String, query: String, limit: Int,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseTerminologyItem]

    /* @Codex */
    func resolveTerminology(
        system: String, code: String,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseTerminologyItem

    /* @Codex */
    func fetchTerminologySystems(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseTerminologyRegistryEntry]

    func fetchPatient(
        id: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBasePatientDetail

    func updatePatient(
        patientId: String, payload: HomeBasePatientUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement

    // ADR 0071 update: patient CREATE now has a paired-client wire peer behind
    // network.replica.write-patient-lifecycle. The local authority remains the
    // in-process path when a scoped SQLite adapter is active.
    func createPatient(
        payload: HomeBasePatientCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource

    func softDeletePatient(
        id: String, version: Int, sealedReason: String?,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource

    func restorePatient(
        id: String, version: Int,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource

    // limit has no default in the protocol requirement (Swift forbids it); the
    // 4-argument convenience below restores the call sites' boundary maximum.
    func fetchEntries(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String,
        ambulatoryId: String?, limit: Int
    ) async throws -> [HomeBaseEntrySummary]

    func createEntry(
        patientId: String, payload: HomeBaseEntryCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource

    func updateEntry(
        patientId: String, entryId: String, payload: HomeBaseEntryUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement

    func fetchTherapies(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String,
        ambulatoryId: String?, limit: Int
    ) async throws -> [HomeBaseTherapySummary]

    func createTherapy(
        patientId: String, payload: HomeBaseTherapyCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource

    func updateTherapy(
        patientId: String, therapyId: String, payload: HomeBaseTherapyUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement

    func fetchCheckups(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String,
        ambulatoryId: String?, limit: Int
    ) async throws -> [HomeBaseCheckupSummary]

    func createCheckup(
        patientId: String, payload: HomeBaseCheckupCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource

    func updateCheckup(
        patientId: String, checkupId: String, payload: HomeBaseCheckupUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement

    func fetchObservations(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String,
        ambulatoryId: String?, limit: Int
    ) async throws -> [HomeBaseObservationSummary]

    func createObservation(
        patientId: String, payload: HomeBaseObservationCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource

    func updateObservation(
        patientId: String, observationId: String, payload: HomeBaseObservationUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement

    /* @Codex */
    func fetchServicePrescriptions(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseServicePrescriptionSummary]

    /* @Codex */
    func createServicePrescription(
        payload: HomeBaseServicePrescriptionCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource

    /* @Codex */
    func updateServicePrescription(
        prescriptionId: String, payload: HomeBaseServicePrescriptionUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement

    /* @Codex */
    func fetchServicePrescriptionItems(
        patientId: String?, prescriptionId: String?,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseServicePrescriptionItemSummary]

    /* @Codex */
    func createServicePrescriptionItem(
        payload: HomeBaseServicePrescriptionItemCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource

    /* @Codex */
    func updateServicePrescriptionItem(
        itemId: String, payload: HomeBaseServicePrescriptionItemUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement

    /* @Codex */
    func fetchServiceCatalog(
        query: String?, code: String?, limit: Int,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseServiceCatalogEntrySummary]

    /* @Codex */
    func fetchServiceCatalogCount(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCatalogCountResponse

    /* @Codex */
    func fetchProstheticPrescriptions(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseProstheticPrescriptionSummary]

    /* @Codex */
    func createProstheticPrescription(
        payload: HomeBaseProstheticPrescriptionCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource

    /* @Codex */
    func updateProstheticPrescription(
        prescriptionId: String, payload: HomeBaseProstheticPrescriptionUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement

    /* @Codex */
    func fetchNetworkCapabilities(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> NetworkCapabilitiesResponse

    /* @Codex */
    func fetchNetworkIdentity(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> NetworkIdentitySummary

    /* @Codex */
    func fetchNetworkNode(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> NetworkNodeSummary

    /* @Codex */
    func fetchNetworkRevision(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> NetworkRevisionSummary

    /* @Codex */
    func fetchFseValidatePatient(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseValidatePatientExportResponse

    /* @Codex */
    func validateFseDocument(
        payload: HomeBaseFseDocumentValidationPayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseFseDocumentValidationResponse
}

// Restore the clinical-list boundary default the call sites rely on (the concrete
// client keeps its own default; this covers calls made through the existential).
public extension HomeBasePatientsDataSource {
    func fetchPatients(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBasePatientSummary] {
        try await fetchPatients(
            credentials: credentials, sessionCookie: sessionCookie,
            ambulatoryId: ambulatoryId, includeDeleted: false)
    }

    func fetchEntries(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseEntrySummary] {
        try await fetchEntries(patientId: patientId, credentials: credentials,
                               sessionCookie: sessionCookie, ambulatoryId: ambulatoryId,
                               limit: HomeBaseClinicalListLimit.boundaryMaximum)
    }

    func fetchTherapies(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseTherapySummary] {
        try await fetchTherapies(patientId: patientId, credentials: credentials,
                                 sessionCookie: sessionCookie, ambulatoryId: ambulatoryId,
                                 limit: HomeBaseClinicalListLimit.boundaryMaximum)
    }

    func fetchCheckups(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseCheckupSummary] {
        try await fetchCheckups(patientId: patientId, credentials: credentials,
                                sessionCookie: sessionCookie, ambulatoryId: ambulatoryId,
                                limit: HomeBaseClinicalListLimit.boundaryMaximum)
    }

    func fetchObservations(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseObservationSummary] {
        try await fetchObservations(patientId: patientId, credentials: credentials,
                                    sessionCookie: sessionCookie, ambulatoryId: ambulatoryId,
                                    limit: HomeBaseClinicalListLimit.boundaryMaximum)
    }

    /* @Codex */
    func searchDrugs(
        query: String,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseDrugSummary] {
        try await searchDrugs(
            query: query, limit: HomeBaseCatalogSearchLimit.defaultMaximum,
            credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    func searchExemptions(
        query: String,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseExemptionSummary] {
        try await searchExemptions(
            query: query, limit: HomeBaseCatalogSearchLimit.defaultMaximum,
            credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    func searchTerminology(
        system: String,
        query: String,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseTerminologyItem] {
        try await searchTerminology(
            system: system, query: query, limit: HomeBaseCatalogSearchLimit.defaultMaximum,
            credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    func fetchServiceCatalog(
        query: String? = nil,
        code: String? = nil,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseServiceCatalogEntrySummary] {
        try await fetchServiceCatalog(
            query: query, code: code, limit: HomeBaseCatalogSearchLimit.defaultMaximum,
            credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }

    /* @Codex */
    func fetchServiceCatalog(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseServiceCatalogEntrySummary] {
        try await fetchServiceCatalog(
            query: nil, code: nil, limit: HomeBaseCatalogSearchLimit.defaultMaximum,
            credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
    }
}

// The existing HTTP client satisfies the seam as-is; its methods match the protocol
// and its clinical-list defaults match the boundary maximum.
extension HomeBasePatientsClient: HomeBasePatientsDataSource {}
