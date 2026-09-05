import CryptoKit
import XCTest
@testable import MediFlowAppleShared

/* @Codex */
final class PairedPatientsWorkspaceModelS6Tests: XCTestCase {
    func testServiceTransitionPropagatesStatusDateAndChildVersions() async throws {
        let patient = detail(id: "p1")
        let prescribedAt = Date(timeIntervalSince1970: 1_750_000_000)
        let source = S6MockDataSource(
            details: ["p1": patient],
            services: [
                service(id: "rx1", date: prescribedAt, status: "booked", version: 4),
            ],
            serviceItems: [
                item(id: "i1", prescriptionId: "rx1", ordinal: 1, status: "booked", version: 10),
                item(id: "i2", prescriptionId: "rx1", ordinal: 2, status: "booked", version: 11),
            ]
        )
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(selectedPatient: patient)
        await model.loadSelectedPatientServicePrescriptions()

        guard let prescription = await model.servicePrescriptions.first else {
            return XCTFail("expected loaded prescription")
        }
        await model.performServicePrescription(prescription)

        let serviceUpdate = await source.lastServiceUpdate
        XCTAssertEqual(serviceUpdate?.id, "rx1")
        XCTAssertEqual(serviceUpdate?.payload.version, 4)
        let itemUpdates = await source.itemUpdates
        XCTAssertEqual(itemUpdates.map(\.id), ["i1", "i2"])
        XCTAssertEqual(itemUpdates.map(\.payload.version), [10, 11])
        XCTAssertEqual(itemUpdates.map(\.payload.status), ["performed", "performed"])
    }

    func testServiceAndProstheticGuardsRequireOnlineAndAllowedState() async {
        let patient = detail(id: "p1")
        let model = await makeModel(source: S6MockDataSource(details: ["p1": patient]))
        let performed = service(id: "rx1", date: Date(), status: "performed", version: 1)
        let tested = prosthetic(id: "pt1", status: "tested", version: 1)

        await model.configurePairedOnlineForTests(selectedPatient: patient)
        let canCancelPerformed = await model.canCancelServicePrescription(performed)
        let canTestTested = await model.canTestProstheticPrescription(tested)
        XCTAssertFalse(canCancelPerformed)
        XCTAssertFalse(canTestTested)
        await model.clearPairing()
        let canCreateServiceOffline = await model.canCreateServicePrescription
        let canExportOffline = await model.canPrepareFHIRExport
        XCTAssertFalse(canCreateServiceOffline)
        XCTAssertFalse(canExportOffline)
    }

    /* @Codex */
    func testCreatePayloadsUseWebDefaultWireValues() async {
        let patient = detail(id: "p1")
        let source = S6MockDataSource(details: ["p1": patient])
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(selectedPatient: patient)
        await MainActor.run {
            model.newServiceName = "Prestazione sintetica"
            model.newProstheticDescription = "Ausilio sintetico"
        }

        await model.createServicePrescriptionForSelectedPatient()
        await model.createProstheticPrescriptionForSelectedPatient()

        let servicePayload = await source.lastServiceCreatePayload
        let itemPayload = await source.lastServiceItemCreatePayload
        let prostheticPayload = await source.lastProstheticCreatePayload
        XCTAssertEqual(servicePayload?.status, "prescribed")
        XCTAssertEqual(servicePayload?.category, "visit")
        XCTAssertEqual(servicePayload?.priority, "routine")
        XCTAssertEqual(servicePayload?.source, "manual")
        XCTAssertEqual(itemPayload?.status, "prescribed")
        XCTAssertEqual(itemPayload?.category, "visit")
        XCTAssertEqual(prostheticPayload?.status, "prescribed")
        XCTAssertEqual(prostheticPayload?.category, "standard")
        XCTAssertEqual(prostheticPayload?.source, "manual")
    }

    func testFHIRExportValidationBranches() async throws {
        let patient = detail(id: "p1")
        let errorModel = await makeModel(source: S6MockDataSource(details: ["p1": patient], validation: Self.validation(errors: 2)))
        await errorModel.configurePairedOnlineForTests(selectedPatient: patient)
        await errorModel.prepareFHIRExport()
        let errorURL = await errorModel.patientFHIRExportURL
        let errorStatus = await errorModel.statusMessage
        XCTAssertNil(errorURL)
        XCTAssertEqual(errorStatus, "Export FHIR bloccato: 2 errori FSE da correggere.")

        let warningModel = await makeModel(source: S6MockDataSource(details: ["p1": patient], validation: Self.validation(warnings: 3)))
        await warningModel.configurePairedOnlineForTests(selectedPatient: patient)
        await warningModel.prepareFHIRExport()
        let pendingWarning = await warningModel.pendingFHIRWarningValidation
        let warningURLBeforeConfirm = await warningModel.patientFHIRExportURL
        XCTAssertNotNil(pendingWarning)
        XCTAssertNil(warningURLBeforeConfirm)
        await warningModel.prepareFHIRExport(confirmWarnings: true)
        let warningURLAfterConfirm = await warningModel.patientFHIRExportURL
        XCTAssertNotNil(warningURLAfterConfirm)

        let cleanModel = await makeModel(source: S6MockDataSource(details: ["p1": patient], validation: Self.validation()))
        await cleanModel.configurePairedOnlineForTests(selectedPatient: patient)
        await cleanModel.prepareFHIRExport()
        let exportURL = await cleanModel.patientFHIRExportURL
        let url = try XCTUnwrap(exportURL)
        XCTAssertEqual(url.lastPathComponent, "patient-rossi-mario-fhir.json")
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
    }

    func testRevisionGuardSeedsThenRefreshesOnFingerprintChange() async {
        let patient = detail(id: "p1")
        let source = S6MockDataSource(
            details: ["p1": patient],
            revisions: [
                NetworkRevisionSummary(revision: "1", sourceFingerprint: "src-a", fingerprint: "a"),
                NetworkRevisionSummary(revision: "2", sourceFingerprint: "src-b", fingerprint: "b"),
            ]
        )
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(selectedPatient: patient)

        await model.checkNetworkRevisionOnForeground()
        let countAfterSeed = await source.fetchPatientCount
        XCTAssertEqual(countAfterSeed, 0)
        await model.checkNetworkRevisionOnForeground()
        let countAfterChange = await source.fetchPatientCount
        let status = await model.statusMessage
        XCTAssertEqual(countAfterChange, 1)
        XCTAssertEqual(status, "Home-base aggiornato, dati ricaricati.")
    }

    @MainActor
    private func makeModel(source: S6MockDataSource) -> PairedPatientsWorkspaceModel {
        let suiteName = "PairedPatientsWorkspaceModelS6Tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        let pairedStore = HomeBasePairedStore(
            userDefaults: defaults,
            keychainReader: { _, _ in .success(nil) },
            keychainWriter: { _, _, _ in .success(()) },
            keychainDeleter: { _, _ in .success(()) }
        )
        let cacheDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PairedPatientsWorkspaceModelS6Tests-\(UUID().uuidString)", isDirectory: true)
        let cacheStore = HomeBasePatientCacheStore(
            cacheDirectory: cacheDirectory,
            keyProvider: { SymmetricKey(data: Data(repeating: 9, count: 32)) }
        )
        return PairedPatientsWorkspaceModel(
            pairedStore: pairedStore,
            cacheStore: cacheStore,
            dataSourceFactory: { _ in source }
        )
    }
}

actor S6MockDataSource: HomeBasePatientsDataSource {
    struct ServiceUpdate {
        let id: String
        let payload: HomeBaseServicePrescriptionUpdatePayload
    }

    struct ItemUpdate {
        let id: String
        let payload: HomeBaseServicePrescriptionItemUpdatePayload
    }

    private let details: [String: HomeBasePatientDetail]
    private var services: [HomeBaseServicePrescriptionSummary]
    private var serviceItems: [HomeBaseServicePrescriptionItemSummary]
    private let prosthetics: [HomeBaseProstheticPrescriptionSummary]
    private let validationResponse: HomeBaseValidatePatientExportResponse
    private var revisions: [NetworkRevisionSummary]
    private let scopedCheckups: [HomeBaseCheckupSummary]
    private let scopedEntries: [HomeBaseEntrySummary]
    private let capabilities: [NetworkCapability]
    private let shouldFail: Bool
    private let ambulatories: [NetworkAmbulatorySummary]
    private let ambulatoryMutationError: HomeBaseClientError?
    private let profileError: HomeBaseClientError?
    private let aiRuntime: HomeBaseNetworkAiRuntimeSummary?
    private(set) var lastServiceUpdate: ServiceUpdate?
    private(set) var itemUpdates: [ItemUpdate] = []
    /* @Codex */
    private(set) var lastServiceCreatePayload: HomeBaseServicePrescriptionCreatePayload?
    /* @Codex */
    private(set) var lastServiceItemCreatePayload: HomeBaseServicePrescriptionItemCreatePayload?
    /* @Codex */
    private(set) var lastProstheticCreatePayload: HomeBaseProstheticPrescriptionCreatePayload?
    private(set) var fetchPatientCount = 0
    private(set) var fetchAmbulatoriesCount = 0
    private(set) var createAmbulatoryCount = 0
    private(set) var fetchAiRuntimeStatusCount = 0

    init(
        details: [String: HomeBasePatientDetail],
        services: [HomeBaseServicePrescriptionSummary] = [],
        serviceItems: [HomeBaseServicePrescriptionItemSummary] = [],
        prosthetics: [HomeBaseProstheticPrescriptionSummary] = [],
        validation: HomeBaseValidatePatientExportResponse = PairedPatientsWorkspaceModelS6Tests.validation(),
        revisions: [NetworkRevisionSummary] = [],
        scopedCheckups: [HomeBaseCheckupSummary] = [],
        scopedEntries: [HomeBaseEntrySummary] = [],
        capabilities: [NetworkCapability] = [],
        shouldFail: Bool = false,
        ambulatories: [NetworkAmbulatorySummary] = [],
        ambulatoryMutationError: HomeBaseClientError? = nil,
        profileError: HomeBaseClientError? = nil,
        aiRuntime: HomeBaseNetworkAiRuntimeSummary? = nil
    ) {
        self.details = details
        self.services = services
        self.serviceItems = serviceItems
        self.prosthetics = prosthetics
        self.validationResponse = validation
        self.revisions = revisions
        self.scopedCheckups = scopedCheckups
        self.scopedEntries = scopedEntries
        self.capabilities = capabilities
        self.shouldFail = shouldFail
        self.ambulatories = ambulatories
        self.ambulatoryMutationError = ambulatoryMutationError
        self.profileError = profileError
        self.aiRuntime = aiRuntime
    }

    func login(username: String?, password: String, credentials: HomeBasePairedCredentials) async throws -> HomeBaseLoginResult {
        HomeBaseLoginResult(sessionCookie: "sid=test", encryptedMasterKey: nil, salt: nil)
    }

    func changePin(
        currentPin: String, newPin: String, encryptedMasterKey: String, salt: String,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseMutationAcknowledgement {
        return HomeBaseMutationAcknowledgement(success: true)
    }

    func logout(
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func updateProfile(
        userId: String, displayName: String, ambulatoryName: String,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseMutationAcknowledgement {
        if let profileError { throw profileError }
        return HomeBaseMutationAcknowledgement(success: true)
    }

    func createAmbulatory(
        payload: HomeBaseAmbulatoryCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseAmbulatoryMutationResponse {
        if let ambulatoryMutationError { throw ambulatoryMutationError }
        createAmbulatoryCount += 1
        return HomeBaseAmbulatoryMutationResponse(success: true, id: payload.id ?? "amb", version: 1)
    }

    func updateAmbulatory(
        id: String, payload: HomeBaseAmbulatoryUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseAmbulatoryMutationResponse {
        if let ambulatoryMutationError { throw ambulatoryMutationError }
        return HomeBaseAmbulatoryMutationResponse(success: true, version: payload.expectedVersion + 1)
    }

    func deleteAmbulatory(
        id: String, expectedVersion: Int,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseAmbulatoryMutationResponse {
        if let ambulatoryMutationError { throw ambulatoryMutationError }
        return HomeBaseAmbulatoryMutationResponse(success: true)
    }

    func clearAmbulatory(
        id: String, expectedVersion: Int,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseAmbulatoryMutationResponse {
        if let ambulatoryMutationError { throw ambulatoryMutationError }
        return HomeBaseAmbulatoryMutationResponse(success: true, version: expectedVersion + 1)
    }

    func fetchPatients(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        includeDeleted: Bool
    ) async throws -> [HomeBasePatientSummary] {
        if shouldFail { throw HomeBaseClientError.contract }
        return details.values.map { detail in
            HomeBasePatientSummary(
                id: detail.id,
                firstName: detail.firstName,
                lastName: detail.lastName,
                birthDate: detail.birthDate,
                taxCode: detail.taxCode,
                isAdi: detail.isAdi,
                isArchived: detail.isArchived,
                version: detail.version,
                updatedAt: detail.updatedAt,
                deletedAt: detail.deletedAt,
                deletionReason: detail.deletionReason,
                diagnoses: detail.diagnoses
            )
        }
    }

    func fetchPatients(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        includeDiagnoses: Bool
    ) async throws -> [HomeBasePatientSummary] {
        try await fetchPatients(
            credentials: credentials, sessionCookie: sessionCookie,
            ambulatoryId: ambulatoryId, includeDeleted: false)
    }

    func fetchNetworkAmbulatories(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [NetworkAmbulatorySummary] {
        fetchAmbulatoriesCount += 1
        return ambulatories
    }

    func searchDrugs(
        query: String,
        limit: Int,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseDrugSummary] {
        []
    }

    func searchExemptions(
        query: String,
        limit: Int,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseExemptionSummary] {
        []
    }

    func searchTerminology(
        system: String,
        query: String,
        limit: Int,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseTerminologyItem] {
        []
    }

    func resolveTerminology(
        system: String,
        code: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseTerminologyItem {
        throw HomeBaseClientError.httpStatus(404, "Not found")
    }

    func fetchTerminologySystems(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseTerminologyRegistryEntry] {
        []
    }

    func fetchPatient(
        id: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBasePatientDetail {
        fetchPatientCount += 1
        guard let detail = details[id] else { throw HomeBaseClientError.httpStatus(404, "Not found") }
        return detail
    }

    func updatePatient(
        patientId: String,
        payload: HomeBasePatientUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func createPatient(
        payload: HomeBasePatientCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "created", version: 1)
    }

    func softDeletePatient(
        id: String,
        version: Int,
        sealedReason: String?,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: id, version: version + 1)
    }

    func restorePatient(
        id: String,
        version: Int,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: id, version: version + 1)
    }

    func fetchEntries(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        limit: Int
    ) async throws -> [HomeBaseEntrySummary] {
        []
    }

    func createEntry(
        patientId: String,
        payload: HomeBaseEntryCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: payload.id, version: 1)
    }

    func updateEntry(
        patientId: String,
        entryId: String,
        payload: HomeBaseEntryUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchAttachments(
        patientId: String,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> [HomeBaseAttachmentSummary] {
        []
    }

    func fetchAttachment(
        patientId: String, attachmentId: String,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseAttachmentDetail {
        throw HomeBaseClientError.httpStatus(404, "Not found")
    }

    func createAttachment(
        patientId: String, payload: HomeBaseAttachmentCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "attachment", version: nil)
    }

    func computeVisitDraft(
        input: HomeBaseVisitDraftInput,
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseVisitDraftResponse {
        throw HomeBaseClientError.contract
    }

    func fetchAiRuntimeStatus(
        credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseNetworkAiRuntimeSummary {
        fetchAiRuntimeStatusCount += 1
        guard let aiRuntime else { throw HomeBaseClientError.contract }
        return aiRuntime
    }

    func fetchTherapies(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        limit: Int
    ) async throws -> [HomeBaseTherapySummary] {
        []
    }

    func createTherapy(
        patientId: String,
        payload: HomeBaseTherapyCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "therapy", version: 1)
    }

    func updateTherapy(
        patientId: String,
        therapyId: String,
        payload: HomeBaseTherapyUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchCheckups(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        limit: Int
    ) async throws -> [HomeBaseCheckupSummary] {
        []
    }

    func fetchScopedCheckups(dateFrom: Date?, dateTo: Date?, status: [String], limit: Int?, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseCheckupSummary] { if shouldFail { throw HomeBaseClientError.contract }; return scopedCheckups }
    func fetchScopedEntries(type: String?, dateFrom: Date?, dateTo: Date?, limit: Int?, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseEntrySummary] { if shouldFail { throw HomeBaseClientError.contract }; return scopedEntries }

    func createCheckup(
        patientId: String,
        payload: HomeBaseCheckupCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "checkup", version: 1)
    }

    func updateCheckup(
        patientId: String,
        checkupId: String,
        payload: HomeBaseCheckupUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchObservations(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        limit: Int
    ) async throws -> [HomeBaseObservationSummary] {
        []
    }

    func createObservation(
        patientId: String,
        payload: HomeBaseObservationCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "observation", version: 1)
    }

    func updateObservation(
        patientId: String,
        observationId: String,
        payload: HomeBaseObservationUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchServicePrescriptions(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseServicePrescriptionSummary] {
        services
    }

    func createServicePrescription(
        payload: HomeBaseServicePrescriptionCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        lastServiceCreatePayload = payload
        return HomeBaseCreatedResource(id: "service", version: 1)
    }

    func updateServicePrescription(
        prescriptionId: String,
        payload: HomeBaseServicePrescriptionUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        lastServiceUpdate = ServiceUpdate(id: prescriptionId, payload: payload)
        return HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchServicePrescriptionItems(
        patientId: String?,
        prescriptionId: String?,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseServicePrescriptionItemSummary] {
        serviceItems.filter { patientId == nil || $0.patientId == patientId }
    }

    func createServicePrescriptionItem(
        payload: HomeBaseServicePrescriptionItemCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        lastServiceItemCreatePayload = payload
        return HomeBaseCreatedResource(id: "service-item", version: 1)
    }

    func updateServicePrescriptionItem(
        itemId: String,
        payload: HomeBaseServicePrescriptionItemUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        itemUpdates.append(ItemUpdate(id: itemId, payload: payload))
        return HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchServiceCatalog(
        query: String?,
        code: String?,
        limit: Int,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseServiceCatalogEntrySummary] {
        []
    }

    func fetchServiceCatalogCount(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCatalogCountResponse {
        HomeBaseCatalogCountResponse(count: 0)
    }

    func fetchProstheticPrescriptions(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseProstheticPrescriptionSummary] {
        prosthetics
    }

    func createProstheticPrescription(
        payload: HomeBaseProstheticPrescriptionCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        lastProstheticCreatePayload = payload
        return HomeBaseCreatedResource(id: "prosthetic", version: 1)
    }

    func updateProstheticPrescription(
        prescriptionId: String,
        payload: HomeBaseProstheticPrescriptionUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchNetworkCapabilities(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> NetworkCapabilitiesResponse {
        if shouldFail { throw HomeBaseClientError.contract }
        return NetworkCapabilitiesResponse(nodeId: "node", operatingMode: "network-home-base", protocolVersion: "1", capabilities: capabilities)
    }

    func fetchNetworkIdentity(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> NetworkIdentitySummary {
        throw HomeBaseClientError.contract
    }

    func fetchNetworkNode(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> NetworkNodeSummary {
        NetworkNodeSummary(
            nodeId: "node",
            displayName: "Mac",
            role: "home-base-candidate",
            operatingMode: "network-home-base",
            protocolVersion: "1",
            transport: NetworkNodeSummary.Transport(apiBasePath: "/api/v1", tlsRequired: true, localTlsPort: 3443)
        )
    }

    func fetchNetworkRevision(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> NetworkRevisionSummary {
        revisions.isEmpty
            ? NetworkRevisionSummary(revision: "1", sourceFingerprint: "src", fingerprint: "stable")
            : revisions.removeFirst()
    }

    func fetchFseValidatePatient(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseValidatePatientExportResponse {
        validationResponse
    }

    func validateFseDocument(
        payload: HomeBaseFseDocumentValidationPayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseFseDocumentValidationResponse {
        HomeBaseFseDocumentValidationResponse(ok: true, profile: "test", errors: [], warnings: [])
    }
}

private func detail(id: String) -> HomeBasePatientDetail {
    HomeBasePatientDetail(
        id: id,
        firstName: "Mario",
        lastName: "Rossi",
        birthDate: nil,
        taxCode: "RSSMRA80A01H501U",
        address: nil,
        phone: nil,
        caregiver: nil,
        exemptions: nil,
        diagnoses: nil,
        monitoringProfile: nil,
        statusReason: nil,
        notes: nil,
        aiSummary: nil,
        documentInsights: nil,
        isAdi: false,
        isArchived: false,
        version: 1,
        ambulatoryId: "AMB-1",
        createdAt: nil,
        updatedAt: Date(timeIntervalSince1970: 1_750_000_000),
        deletedAt: nil,
        deletionReason: nil
    )
}

private func service(id: String, date: Date, status: String, version: Int) -> HomeBaseServicePrescriptionSummary {
    HomeBaseServicePrescriptionSummary(
        id: id,
        patientId: "p1",
        prescribedAt: date,
        status: status,
        category: "visit",
        priority: nil,
        codeSystem: nil,
        serviceCode: nil,
        serviceName: "Visita cardiologica",
        clinicalQuestion: nil,
        provider: nil,
        scheduledAt: nil,
        performedAt: nil,
        reportReceivedAt: nil,
        outcomeNote: nil,
        requestReference: nil,
        source: "manual",
        documentRefs: nil,
        notes: nil,
        version: version,
        createdAt: nil,
        updatedAt: nil
    )
}

private func item(id: String, prescriptionId: String, ordinal: Int, status: String, version: Int) -> HomeBaseServicePrescriptionItemSummary {
    HomeBaseServicePrescriptionItemSummary(
        id: id,
        patientId: "p1",
        prescriptionId: prescriptionId,
        ordinal: ordinal,
        status: status,
        category: nil,
        codeSystem: nil,
        serviceCode: nil,
        serviceName: "Voce",
        catalogEntryId: nil,
        catalogDisplayName: nil,
        matchStatus: "manual",
        confidence: nil,
        evidence: nil,
        notes: nil,
        scheduledAt: nil,
        performedAt: nil,
        reportReceivedAt: nil,
        outcomeNote: nil,
        version: version,
        createdAt: nil,
        updatedAt: nil
    )
}

private func prosthetic(id: String, status: String, version: Int) -> HomeBaseProstheticPrescriptionSummary {
    HomeBaseProstheticPrescriptionSummary(
        id: id,
        patientId: "p1",
        prescribedAt: Date(timeIntervalSince1970: 1_750_000_000),
        status: status,
        category: "standard",
        isoCode: nil,
        description: "Ausilio",
        measures: nil,
        clinicalReason: nil,
        regionalPrescriptionId: nil,
        supplier: nil,
        collaudoAt: nil,
        collaudoOutcome: nil,
        source: "manual",
        documentRefs: nil,
        notes: nil,
        version: version,
        createdAt: nil,
        updatedAt: nil
    )
}

private extension PairedPatientsWorkspaceModelS6Tests {
    static func validation(errors: Int = 0, warnings: Int = 0) -> HomeBaseValidatePatientExportResponse {
        HomeBaseValidatePatientExportResponse(
            patientId: "p1",
            hasErrors: errors > 0,
            hasWarnings: warnings > 0,
            therapyMedication: HomeBaseFseValidationSummary(
                total: 1,
                ok: errors == 0 && warnings == 0 ? 1 : 0,
                withErrors: errors > 0 ? 1 : 0,
                withWarnings: warnings > 0 ? 1 : 0,
                errorCount: errors,
                warningCount: warnings,
                items: []
            ),
            observationVitals: HomeBaseFseValidationSummary(
                total: 0,
                ok: 0,
                withErrors: 0,
                withWarnings: 0,
                errorCount: 0,
                warningCount: 0,
                items: []
            )
        )
    }
}
