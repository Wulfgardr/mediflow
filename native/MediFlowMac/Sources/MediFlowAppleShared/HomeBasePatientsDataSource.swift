import Foundation

// ADR 0071 Fase 3 (Codex-directed): the data-source SEAM. This protocol captures the
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
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBasePatientSummary]

    func fetchNetworkAmbulatories(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [NetworkAmbulatorySummary]

    func fetchPatient(
        id: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBasePatientDetail

    func updatePatient(
        patientId: String, payload: HomeBasePatientUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement

    // ADR 0071: patient CREATE has no paired-client wire peer, so it is served only by
    // the on-device local authority (SQLitePatientStore.createPatient). The HTTP client
    // conforms with a throwing stub; the local adapter does the real work.
    func createPatient(
        payload: HomeBasePatientCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource

    // limit has no default in the protocol requirement (Swift forbids it); the
    // 4-argument convenience below restores the call sites' default of 20.
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
}

// Restore the `limit: Int = 20` default the call sites rely on (the concrete client
// keeps its own default; this covers calls made through the existential).
public extension HomeBasePatientsDataSource {
    func fetchEntries(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseEntrySummary] {
        try await fetchEntries(patientId: patientId, credentials: credentials,
                               sessionCookie: sessionCookie, ambulatoryId: ambulatoryId, limit: 20)
    }

    func fetchTherapies(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseTherapySummary] {
        try await fetchTherapies(patientId: patientId, credentials: credentials,
                                 sessionCookie: sessionCookie, ambulatoryId: ambulatoryId, limit: 20)
    }

    func fetchCheckups(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseCheckupSummary] {
        try await fetchCheckups(patientId: patientId, credentials: credentials,
                                sessionCookie: sessionCookie, ambulatoryId: ambulatoryId, limit: 20)
    }

    func fetchObservations(
        patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseObservationSummary] {
        try await fetchObservations(patientId: patientId, credentials: credentials,
                                    sessionCookie: sessionCookie, ambulatoryId: ambulatoryId, limit: 20)
    }
}

// The existing HTTP client satisfies the seam as-is (its methods already match, and
// its `limit: Int = 20` defaults are unaffected by the requirement). The one addition
// is the patient-create stub: the paired wire protocol has no create peer, so over HTTP
// it fails fast with a clear message; real creation happens via the local authority.
extension HomeBasePatientsClient: HomeBasePatientsDataSource {
    public func createPatient(
        payload: HomeBasePatientCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        throw HomeBaseClientError.httpStatus(
            405, "Creazione paziente non supportata dal peer paired: richiede l'autorita locale sul dispositivo.")
    }
}
