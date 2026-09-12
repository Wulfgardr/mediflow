#if os(macOS)
// @Codex: WUL-673. Actual RepertoriStore with a deliberately cancellation-ignorant
// datasource. These are synthetic state tests, not UI or live acceptance.
import Foundation
import XCTest
@testable import MediFlowAppleShared

@MainActor
final class RepertoriWHOStoreTests: XCTestCase {
    private func connection(_ source: WHOStoreSource, cookie: String = "mediflow_session=synthetic",
                            amb: String = "synthetic-amb", client: String = "synthetic-paired",
                            token: String = "synthetic-token", server: String = "https://synthetic.invalid",
                            pin: String = "synthetic-pin", generation: UInt = 1) -> ClinicalWorkspaceConnection {
        ClinicalWorkspaceConnection(dataSource: source, credentials: HomeBasePairedCredentials(clientId: client, clientToken: token),
            sessionCookie: cookie, ambulatoryId: amb, masterKey: nil, serverURL: server, tlsPin: pin, sessionGeneration: generation)
    }
    private func result(_ code: String = "AA00") throws -> HomeBaseWHOSearchResponse {
        try HomeBaseWHODecoder.search(WHOSyntheticFixtures.data(WHOSyntheticFixtures.search(code: code)))
    }

    func testTypingEmptyFieldsAndSelectingWHORequireExplicitIntent() async {
        let source = WHOStoreSource(); let current = connection(source)
        let store = RepertoriStore(connectionProvider: { current })
        store.catalogue = .terminology
        store.query = "synthetic term"; store.scheduleSearch()
        store.query = ""; store.submitSearch()
        store.code = ""; store.submitCodeCheck()
        let calls = await source.recordedCalls()
        XCTAssertEqual(calls, [])
        XCTAssertFalse(store.isSearching)
        XCTAssertNil(store.pendingCompletion)
    }

    func testOutOfOrderResponseCannotReplaceNewResultOrClearItsSpinner() async throws {
        let source = WHOStoreSource(); let current = connection(source)
        let store = RepertoriStore(connectionProvider: { current }); store.catalogue = .terminology
        let firstStarted = expectation(description: "first search"), secondStarted = expectation(description: "second search")
        await source.observe { query in if query == "first" { firstStarted.fulfill() }; if query == "second" { secondStarted.fulfill() } }
        store.query = "first"; store.submitSearch(); let first = store.pendingCompletion
        await fulfillment(of: [firstStarted], timeout: 2)
        store.query = "second"; store.submitSearch(); let second = store.pendingCompletion
        await fulfillment(of: [secondStarted], timeout: 2)
        await source.complete("first", with: .success(try result("AA01")))
        await first?.value
        XCTAssertTrue(store.isSearching)
        XCTAssertNil(store.whoSearch)
        await source.complete("second", with: .success(try result("AA02")))
        await second?.value
        XCTAssertFalse(store.isSearching)
        XCTAssertEqual(store.whoSearch?.entries.first?.code, "AA02")
        XCTAssertNil(store.failure)
    }

    func testLateOldResponseAfterNewCompletionCannotReplaceIt() async throws {
        let source = WHOStoreSource(); let current = connection(source)
        let store = RepertoriStore(connectionProvider: { current }); store.catalogue = .terminology
        let firstStarted = expectation(description: "first"), secondStarted = expectation(description: "second")
        await source.observe { query in if query == "first" { firstStarted.fulfill() }; if query == "second" { secondStarted.fulfill() } }
        store.query = "first"; store.submitSearch(); let first = store.pendingCompletion
        await fulfillment(of: [firstStarted], timeout: 2)
        store.query = "second"; store.submitSearch(); let second = store.pendingCompletion
        await fulfillment(of: [secondStarted], timeout: 2)
        await source.complete("second", with: .success(try result("AA02"))); await second?.value
        await source.complete("first", with: .success(try result("AA01"))); await first?.value
        XCTAssertEqual(store.whoSearch?.entries.first?.code, "AA02")
        XCTAssertFalse(store.isSearching)
    }

    func testCancelCloseCatalogueAndQueryChangesRejectLateResponsesAndErrors() async throws {
        for action in ["cancel", "close", "catalogue", "query"] {
            let source = WHOStoreSource(); let current = connection(source)
            let store = RepertoriStore(connectionProvider: { current }); store.catalogue = .terminology
            let started = expectation(description: action)
            await source.observe { _ in started.fulfill() }
            store.query = "synthetic"; store.submitSearch(); let task = store.pendingCompletion
            await fulfillment(of: [started], timeout: 2)
            switch action {
            case "cancel": store.cancel()
            case "close": store.close()
            case "catalogue": store.catalogue = .drugs
            default: store.query = "replacement"
            }
            await source.complete("synthetic", with: action == "query" ? .failure(HomeBaseWHOError.unavailable) : .success(try result()))
            await task?.value
            XCTAssertNil(store.whoSearch); XCTAssertNil(store.failure); XCTAssertFalse(store.isSearching)
            XCTAssertEqual(store.wasCancelled, action == "cancel")
        }
    }

    func testConnectionIdentityFenceRejectsDeliveryBeforeViewOnChangeRuns() async throws {
        for field in ["session", "ambulatory", "client", "token", "server", "pin", "generation", "disconnect"] {
            let source = WHOStoreSource(); var current: ClinicalWorkspaceConnection? = connection(source)
            let store = RepertoriStore(connectionProvider: { current }); store.catalogue = .terminology
            let started = expectation(description: field)
            await source.observe { _ in started.fulfill() }
            store.query = "synthetic"; store.submitSearch(); let task = store.pendingCompletion
            await fulfillment(of: [started], timeout: 2)
            switch field {
            case "session": current = connection(source, cookie: "mediflow_session=new-synthetic")
            case "ambulatory": current = connection(source, amb: "synthetic-amb-b")
            case "client": current = connection(source, client: "synthetic-new-client")
            case "token": current = connection(source, token: "synthetic-new-token")
            case "server": current = connection(source, server: "https://new-synthetic.invalid")
            case "pin": current = connection(source, pin: "synthetic-new-pin")
            case "generation": current = connection(source, generation: 2)
            default: current = nil
            }
            await source.complete("synthetic", with: .success(try result())); await task?.value
            XCTAssertNil(store.whoSearch); XCTAssertNil(store.failure)
            store.connectionChanged()
            XCTAssertFalse(store.isSearching)
        }
    }

    func testExplicitCheckReadinessAndRetryUseCorrectMethodsAndClearPreviousState() async throws {
        let source = WHOStoreSource(); let current = connection(source)
        let store = RepertoriStore(connectionProvider: { current }); store.catalogue = .terminology
        store.code = "AA00&XA001"; store.submitCodeCheck(); await store.pendingCompletion?.value
        XCTAssertEqual(store.whoCheck?.code, "AA00&XA001")
        XCTAssertEqual(store.whoCheck?.status, .found)
        store.inspectService(); await store.pendingCompletion?.value
        XCTAssertNil(store.whoCheck)
        XCTAssertEqual(store.whoReadiness?.status, .configured)
        store.retry(); await store.pendingCompletion?.value
        let calls = await source.recordedCalls()
        XCTAssertEqual(calls, ["check:AA00&XA001", "readiness", "readiness"])
    }

    func testUnsupportedErrorDoesNotFallbackAndRetryIsExplicit() async {
        let source = WHOStoreSource(); await source.setUnsupported()
        let current = connection(source); let store = RepertoriStore(connectionProvider: { current })
        store.catalogue = .terminology; store.query = "synthetic"; store.submitSearch()
        await store.pendingCompletion?.value
        XCTAssertEqual(store.failure, HomeBaseWHOError.unsupported.localizedDescription)
        XCTAssertNil(store.whoSearch)
        var calls = await source.recordedCalls(); XCTAssertEqual(calls, ["search:synthetic"])
        store.retry(); await store.pendingCompletion?.value
        calls = await source.recordedCalls(); XCTAssertEqual(calls, ["search:synthetic", "search:synthetic"])
    }

    func testDrugsAndExemptionsContinueUsingTheirOwnDatasourceMethods() async {
        let source = WHOStoreSource(); let current = connection(source)
        let store = RepertoriStore(connectionProvider: { current }); store.query = "synthetic"
        store.submitSearch(); await store.pendingCompletion?.value
        XCTAssertTrue(store.hasSearched); XCTAssertTrue(store.drugs.isEmpty)
        store.catalogue = .exemptions; store.submitSearch(); await store.pendingCompletion?.value
        XCTAssertTrue(store.exemptions.isEmpty)
        let calls = await source.recordedCalls(); XCTAssertEqual(calls, ["drugs:synthetic", "exemptions:synthetic"])
        XCTAssertNil(store.whoSearch)
    }
}

private actor WHOStoreSource: HomeBasePatientsDataSource {
    private var calls: [String] = []
    private var observer: (@Sendable (String) -> Void)?
    private var continuations: [String: CheckedContinuation<HomeBaseWHOSearchResponse, Error>] = [:]
    private var unsupported = false
    func recordedCalls() -> [String] { calls }
    func observe(_ action: @escaping @Sendable (String) -> Void) { observer = action }
    func setUnsupported() { unsupported = true }
    func complete(_ query: String, with result: Result<HomeBaseWHOSearchResponse, Error>) {
        continuations.removeValue(forKey: query)?.resume(with: result)
    }
    func searchWHO(query: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseWHOSearchResponse {
        calls.append("search:" + query)
        if unsupported { throw HomeBaseWHOError.unsupported }
        // Intentionally does not observe task cancellation: the store must fence delivery.
        return try await withCheckedThrowingContinuation { continuation in
            continuations[query] = continuation
            observer?(query)
        }
    }
    func checkWHOCode(code: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseWHOCodeCheckResponse {
        calls.append("check:" + code)
        return try HomeBaseWHODecoder.checkCode(WHOSyntheticFixtures.data(WHOSyntheticFixtures.check(code: code)), requestedCode: code)
    }
    func readWHOReadiness(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseWHOReadiness {
        calls.append("readiness")
        return try HomeBaseWHODecoder.readiness(WHOSyntheticFixtures.data(WHOSyntheticFixtures.readiness()))
    }
    func searchDrugs(query: String, limit: Int, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseDrugSummary] { calls.append("drugs:" + query); return [] }
    func searchExemptions(query: String, limit: Int, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseExemptionSummary] { calls.append("exemptions:" + query); return [] }

    // Inert implementations solely satisfy the unchanged full datasource protocol.
    func login( username: String?, password: String, credentials: HomeBasePairedCredentials ) async throws -> HomeBaseLoginResult { throw HomeBaseWHOError.unsupported }
    func changePin( currentPin: String, newPin: String, encryptedMasterKey: String, salt: String, credentials: HomeBasePairedCredentials, sessionCookie: String ) async throws -> HomeBaseMutationAcknowledgement { throw HomeBaseWHOError.unsupported }
    func logout( credentials: HomeBasePairedCredentials, sessionCookie: String ) async throws -> HomeBaseMutationAcknowledgement { throw HomeBaseWHOError.unsupported }
    func updateProfile( userId: String, displayName: String, ambulatoryName: String, credentials: HomeBasePairedCredentials, sessionCookie: String ) async throws -> HomeBaseMutationAcknowledgement { throw HomeBaseWHOError.unsupported }
    func fetchPatients( credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, includeDeleted: Bool ) async throws -> [HomeBasePatientSummary] { throw HomeBaseWHOError.unsupported }
    func fetchPatients( credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, includeDiagnoses: Bool ) async throws -> [HomeBasePatientSummary] { throw HomeBaseWHOError.unsupported }
    func fetchNetworkAmbulatories( credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> [NetworkAmbulatorySummary] { throw HomeBaseWHOError.unsupported }
    func createAmbulatory( payload: HomeBaseAmbulatoryCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String ) async throws -> HomeBaseAmbulatoryMutationResponse { throw HomeBaseWHOError.unsupported }
    func updateAmbulatory( id: String, payload: HomeBaseAmbulatoryUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String ) async throws -> HomeBaseAmbulatoryMutationResponse { throw HomeBaseWHOError.unsupported }
    func deleteAmbulatory( id: String, expectedVersion: Int, credentials: HomeBasePairedCredentials, sessionCookie: String ) async throws -> HomeBaseAmbulatoryMutationResponse { throw HomeBaseWHOError.unsupported }
    func clearAmbulatory( id: String, expectedVersion: Int, credentials: HomeBasePairedCredentials, sessionCookie: String ) async throws -> HomeBaseAmbulatoryMutationResponse { throw HomeBaseWHOError.unsupported }
    func searchTerminology( system: String, query: String, limit: Int, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> [HomeBaseTerminologyItem] { throw HomeBaseWHOError.unsupported }
    func resolveTerminology( system: String, code: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseTerminologyItem { throw HomeBaseWHOError.unsupported }
    func fetchTerminologySystems( credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> [HomeBaseTerminologyRegistryEntry] { throw HomeBaseWHOError.unsupported }
    func fetchPatient( id: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBasePatientDetail { throw HomeBaseWHOError.unsupported }
    func updatePatient( patientId: String, payload: HomeBasePatientUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseMutationAcknowledgement { throw HomeBaseWHOError.unsupported }
    func createPatient( payload: HomeBasePatientCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseCreatedResource { throw HomeBaseWHOError.unsupported }
    func softDeletePatient( id: String, version: Int, sealedReason: String?, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseCreatedResource { throw HomeBaseWHOError.unsupported }
    func restorePatient( id: String, version: Int, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseCreatedResource { throw HomeBaseWHOError.unsupported }
    func fetchEntries( patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, limit: Int ) async throws -> [HomeBaseEntrySummary] { throw HomeBaseWHOError.unsupported }
    func createEntry( patientId: String, payload: HomeBaseEntryCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseCreatedResource { throw HomeBaseWHOError.unsupported }
    func updateEntry( patientId: String, entryId: String, payload: HomeBaseEntryUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseMutationAcknowledgement { throw HomeBaseWHOError.unsupported }
    func fetchAttachments( patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> [HomeBaseAttachmentSummary] { throw HomeBaseWHOError.unsupported }
    func fetchAttachment( patientId: String, attachmentId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseAttachmentDetail { throw HomeBaseWHOError.unsupported }
    func createAttachment( patientId: String, payload: HomeBaseAttachmentCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseCreatedResource { throw HomeBaseWHOError.unsupported }
    func computeVisitDraft( input: HomeBaseVisitDraftInput, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseVisitDraftResponse { throw HomeBaseWHOError.unsupported }
    func fetchAiRuntimeStatus( credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseNetworkAiRuntimeSummary { throw HomeBaseWHOError.unsupported }
    func fetchTherapies( patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, limit: Int ) async throws -> [HomeBaseTherapySummary] { throw HomeBaseWHOError.unsupported }
    func createTherapy( patientId: String, payload: HomeBaseTherapyCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseCreatedResource { throw HomeBaseWHOError.unsupported }
    func updateTherapy( patientId: String, therapyId: String, payload: HomeBaseTherapyUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseMutationAcknowledgement { throw HomeBaseWHOError.unsupported }
    func fetchCheckups( patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, limit: Int ) async throws -> [HomeBaseCheckupSummary] { throw HomeBaseWHOError.unsupported }
    func fetchScopedCheckups( dateFrom: Date?, dateTo: Date?, status: [String], limit: Int?, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> [HomeBaseCheckupSummary] { throw HomeBaseWHOError.unsupported }
    func fetchScopedEntries( type: String?, dateFrom: Date?, dateTo: Date?, limit: Int?, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> [HomeBaseEntrySummary] { throw HomeBaseWHOError.unsupported }
    func createCheckup( patientId: String, payload: HomeBaseCheckupCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseCreatedResource { throw HomeBaseWHOError.unsupported }
    func updateCheckup( patientId: String, checkupId: String, payload: HomeBaseCheckupUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseMutationAcknowledgement { throw HomeBaseWHOError.unsupported }
    func fetchObservations( patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, limit: Int ) async throws -> [HomeBaseObservationSummary] { throw HomeBaseWHOError.unsupported }
    func createObservation( patientId: String, payload: HomeBaseObservationCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseCreatedResource { throw HomeBaseWHOError.unsupported }
    func updateObservation( patientId: String, observationId: String, payload: HomeBaseObservationUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseMutationAcknowledgement { throw HomeBaseWHOError.unsupported }
    func fetchServicePrescriptions( patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> [HomeBaseServicePrescriptionSummary] { throw HomeBaseWHOError.unsupported }
    func createServicePrescription( payload: HomeBaseServicePrescriptionCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseCreatedResource { throw HomeBaseWHOError.unsupported }
    func updateServicePrescription( prescriptionId: String, payload: HomeBaseServicePrescriptionUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseMutationAcknowledgement { throw HomeBaseWHOError.unsupported }
    func fetchServicePrescriptionItems( patientId: String?, prescriptionId: String?, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> [HomeBaseServicePrescriptionItemSummary] { throw HomeBaseWHOError.unsupported }
    func createServicePrescriptionItem( payload: HomeBaseServicePrescriptionItemCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseCreatedResource { throw HomeBaseWHOError.unsupported }
    func updateServicePrescriptionItem( itemId: String, payload: HomeBaseServicePrescriptionItemUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseMutationAcknowledgement { throw HomeBaseWHOError.unsupported }
    func fetchServiceCatalog( query: String?, code: String?, limit: Int, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> [HomeBaseServiceCatalogEntrySummary] { throw HomeBaseWHOError.unsupported }
    func fetchServiceCatalogCount( credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseCatalogCountResponse { throw HomeBaseWHOError.unsupported }
    func fetchProstheticPrescriptions( patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> [HomeBaseProstheticPrescriptionSummary] { throw HomeBaseWHOError.unsupported }
    func createProstheticPrescription( payload: HomeBaseProstheticPrescriptionCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseCreatedResource { throw HomeBaseWHOError.unsupported }
    func updateProstheticPrescription( prescriptionId: String, payload: HomeBaseProstheticPrescriptionUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseMutationAcknowledgement { throw HomeBaseWHOError.unsupported }
    func fetchNetworkCapabilities( credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> NetworkCapabilitiesResponse { throw HomeBaseWHOError.unsupported }
    func fetchNetworkIdentity( credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> NetworkIdentitySummary { throw HomeBaseWHOError.unsupported }
    func fetchNetworkNode( credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> NetworkNodeSummary { throw HomeBaseWHOError.unsupported }
    func fetchNetworkRevision( credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> NetworkRevisionSummary { throw HomeBaseWHOError.unsupported }
    func fetchFseValidatePatient( patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseValidatePatientExportResponse { throw HomeBaseWHOError.unsupported }
    func validateFseDocument( payload: HomeBaseFseDocumentValidationPayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String? ) async throws -> HomeBaseFseDocumentValidationResponse { throw HomeBaseWHOError.unsupported }
}
#endif
