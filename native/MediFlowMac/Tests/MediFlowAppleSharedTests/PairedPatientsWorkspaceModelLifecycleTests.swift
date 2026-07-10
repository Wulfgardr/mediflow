import CryptoKit
import XCTest
@testable import MediFlowAppleShared

/* @Codex */
final class PairedPatientsWorkspaceModelLifecycleTests: XCTestCase {
    private let masterKey = SymmetricKey(data: Data(repeating: 7, count: 32))

    func testPatientArchiveUsesMinimalUpdatePayload() async throws {
        let active = detail(id: "p1", archived: false, version: 4)
        let source = LifecycleMockDataSource(details: ["p1": active])
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(selectedPatient: active)

        let canArchive = await model.canArchivePatient
        XCTAssertTrue(canArchive)
        await model.setSelectedPatientArchived(true)

        let update = await source.lastUpdate
        XCTAssertEqual(update?.patientId, "p1")
        XCTAssertEqual(update?.payload.version, 4)
        XCTAssertEqual(update?.payload.isArchived, true)
        let isArchived = await model.selectedPatient?.isArchived
        XCTAssertEqual(isArchived, true)
    }

    func testPatientUnarchiveGuardRequiresArchivedActivePatient() async {
        let archived = detail(id: "p1", archived: true, version: 2)
        let active = detail(id: "p2", archived: false, version: 2)
        let deleted = detail(id: "p3", archived: true, version: 2, deleted: true)

        let model = await makeModel(source: LifecycleMockDataSource(details: [:]))
        await model.configurePairedOnlineForTests(selectedPatient: archived)
        let canUnarchiveArchived = await model.canUnarchivePatient
        XCTAssertTrue(canUnarchiveArchived)

        await model.configurePairedOnlineForTests(selectedPatient: active)
        let canUnarchiveActive = await model.canUnarchivePatient
        XCTAssertFalse(canUnarchiveActive)

        await model.configurePairedOnlineForTests(selectedPatient: deleted)
        let canUnarchiveDeleted = await model.canUnarchivePatient
        XCTAssertFalse(canUnarchiveDeleted)
    }

    func testSoftDeleteWithReasonRequiresUnlockedFieldCrypto() async throws {
        let active = detail(id: "p1", archived: false, version: 3)
        let source = LifecycleMockDataSource(details: ["p1": active])
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(selectedPatient: active)

        await model.softDeleteSelectedPatient(reason: "doppione")

        let softDeleteCalls = await source.softDeleteCalls
        let errorMessage = await model.errorMessage
        XCTAssertEqual(softDeleteCalls, 0)
        XCTAssertEqual(
            errorMessage,
            "Cifratura non disponibile: riaccedi con il PIN operatore oppure lascia vuota la motivazione."
        )
    }

    func testSoftDeleteSealsReasonAndReloadsTrash() async throws {
        let active = detail(id: "p1", archived: false, version: 3)
        let source = LifecycleMockDataSource(details: ["p1": active])
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: active)

        await model.softDeleteSelectedPatient(reason: "doppione")

        let delete = await source.lastSoftDelete
        XCTAssertEqual(delete?.id, "p1")
        XCTAssertEqual(delete?.version, 3)
        XCTAssertTrue(delete?.sealedReason?.hasPrefix(CryptoService.encPrefix) == true)
        let selectedPatient = await model.selectedPatient
        XCTAssertNil(selectedPatient)
        let patients = await model.patients
        XCTAssertEqual(patients.filter { $0.deletedAt != nil }.map(\.id), ["p1"])
        XCTAssertEqual(patients.first?.deletionReason, "doppione")
    }

    func testCreatePatientSealsSensitiveFieldsBeforeLeavingTheModel() async throws {
        // Regressione review Wave 2b: il boundary rifiuta con 400 i campi sensibili
        // non ENC:, quindi il model deve sigillarli prima di costruire il payload.
        let source = LifecycleMockDataSource(details: [:])
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey)
        await MainActor.run {
            model.startCreatingPatient()
            model.newPatientFirstName = "Ada"
            model.newPatientLastName = "Lovelace"
            model.newPatientTaxCode = "LVLDAA85A41F205X"
            model.newPatientAddress = "Via Roma 1"
            model.newPatientPhone = "+39 02 555 0100"
            model.newPatientCaregiver = "Caregiver Test"
        }

        await model.createPatient()

        let capturedCreate = await source.lastCreate
        let payload = try XCTUnwrap(capturedCreate)
        XCTAssertEqual(payload.firstName, "Ada")
        for (field, plaintext) in [
            (payload.address, "Via Roma 1"),
            (payload.phone, "+39 02 555 0100"),
            (payload.caregiver, "Caregiver Test"),
        ] {
            let sealed = try XCTUnwrap(field)
            XCTAssertTrue(sealed.hasPrefix(CryptoService.encPrefix), "sensitive create field must be sealed")
            let decryptedJSON = try XCTUnwrap(CryptoService.decryptField(sealed, masterKey: masterKey))
            XCTAssertEqual(CryptoService.jsonDecodeString(decryptedJSON), plaintext)
        }
    }

    func testRestoreUsesTombstoneVersionAndReloadsTrash() async throws {
        let deleted = summary(id: "p1", archived: false, version: 5, deleted: true, reason: "web-delete")
        let source = LifecycleMockDataSource(summaries: [deleted])
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(patients: [deleted])

        let canRestore = await model.canRestorePatient(deleted)
        XCTAssertTrue(canRestore)
        await model.restorePatient(deleted)

        let restore = await source.lastRestore
        XCTAssertEqual(restore?.id, "p1")
        XCTAssertEqual(restore?.version, 5)
        let patients = await model.patients
        XCTAssertTrue(patients.filter { $0.deletedAt != nil }.isEmpty)
    }

    @MainActor
    private func makeModel(source: LifecycleMockDataSource) -> PairedPatientsWorkspaceModel {
        let suiteName = "PairedPatientsWorkspaceModelLifecycleTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        let pairedStore = HomeBasePairedStore(
            userDefaults: defaults,
            keychainReader: { _, _ in .success(nil) },
            keychainWriter: { _, _, _ in .success(()) },
            keychainDeleter: { _, _ in .success(()) }
        )
        let cacheDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PairedPatientsWorkspaceModelLifecycleTests-\(UUID().uuidString)", isDirectory: true)
        let cacheStore = HomeBasePatientCacheStore(
            cacheDirectory: cacheDirectory,
            keyProvider: { SymmetricKey(data: Data(repeating: 8, count: 32)) }
        )
        return PairedPatientsWorkspaceModel(
            pairedStore: pairedStore,
            cacheStore: cacheStore,
            dataSourceFactory: { _ in source }
        )
    }

    private func summary(
        id: String,
        archived: Bool,
        version: Int,
        deleted: Bool = false,
        reason: String? = nil
    ) -> HomeBasePatientSummary {
        HomeBasePatientSummary(
            id: id,
            firstName: "Mario",
            lastName: "Rossi",
            birthDate: nil,
            taxCode: "RSSMRA80A01H501U",
            isAdi: false,
            isArchived: archived,
            version: version,
            updatedAt: Date(timeIntervalSince1970: 1_750_000_000),
            deletedAt: deleted ? Date(timeIntervalSince1970: 1_750_000_100) : nil,
            deletionReason: reason
        )
    }

    private func detail(
        id: String,
        archived: Bool,
        version: Int,
        deleted: Bool = false
    ) -> HomeBasePatientDetail {
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
            isArchived: archived,
            version: version,
            ambulatoryId: "AMB-1",
            createdAt: nil,
            updatedAt: Date(timeIntervalSince1970: 1_750_000_000),
            deletedAt: deleted ? Date(timeIntervalSince1970: 1_750_000_100) : nil,
            deletionReason: deleted ? "web-delete" : nil
        )
    }
}

private actor LifecycleMockDataSource: HomeBasePatientsDataSource {
    struct UpdateCall {
        let patientId: String
        let payload: HomeBasePatientUpdatePayload
    }

    struct DeleteCall {
        let id: String
        let version: Int
        let sealedReason: String?
    }

    struct RestoreCall {
        let id: String
        let version: Int
    }

    private var summaries: [HomeBasePatientSummary]
    private var details: [String: HomeBasePatientDetail]
    private(set) var lastUpdate: UpdateCall?
    private(set) var lastCreate: HomeBasePatientCreatePayload?
    private(set) var lastSoftDelete: DeleteCall?
    private(set) var lastRestore: RestoreCall?
    private(set) var softDeleteCalls = 0

    init(summaries: [HomeBasePatientSummary] = [], details: [String: HomeBasePatientDetail] = [:]) {
        self.summaries = summaries
        self.details = details
        if summaries.isEmpty {
            self.summaries = details.values.map {
                HomeBasePatientSummary(
                    id: $0.id,
                    firstName: $0.firstName,
                    lastName: $0.lastName,
                    birthDate: $0.birthDate,
                    taxCode: $0.taxCode,
                    isAdi: $0.isAdi,
                    isArchived: $0.isArchived,
                    version: $0.version,
                    updatedAt: $0.updatedAt,
                    deletedAt: $0.deletedAt,
                    deletionReason: $0.deletionReason
                )
            }
        }
    }

    func login(username: String?, password: String) async throws -> HomeBaseLoginResult {
        HomeBaseLoginResult(sessionCookie: "sid=test", encryptedMasterKey: nil, salt: nil)
    }

    func fetchPatients(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        includeDeleted: Bool
    ) async throws -> [HomeBasePatientSummary] {
        includeDeleted ? summaries : summaries.filter { $0.deletedAt == nil }
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
        []
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
        lastUpdate = UpdateCall(patientId: patientId, payload: payload)
        guard let current = details[patientId] else { throw HomeBaseClientError.httpStatus(404, "Not found") }
        let updated = HomeBasePatientDetail(
            id: current.id,
            firstName: current.firstName,
            lastName: current.lastName,
            birthDate: current.birthDate,
            taxCode: current.taxCode,
            address: current.address,
            phone: current.phone,
            caregiver: current.caregiver,
            exemptions: current.exemptions,
            diagnoses: current.diagnoses,
            monitoringProfile: current.monitoringProfile,
            statusReason: current.statusReason,
            notes: current.notes,
            aiSummary: current.aiSummary,
            documentInsights: current.documentInsights,
            isAdi: payload.isAdi ?? current.isAdi,
            isArchived: payload.isArchived ?? current.isArchived,
            version: current.version + 1,
            ambulatoryId: current.ambulatoryId,
            createdAt: current.createdAt,
            updatedAt: Date(timeIntervalSince1970: 1_750_000_200),
            deletedAt: current.deletedAt,
            deletionReason: current.deletionReason
        )
        details[patientId] = updated
        summaries = summaries.map { summary in
            summary.id == patientId
                ? HomeBasePatientSummary(
                    id: updated.id,
                    firstName: updated.firstName,
                    lastName: updated.lastName,
                    birthDate: updated.birthDate,
                    taxCode: updated.taxCode,
                    isAdi: updated.isAdi,
                    isArchived: updated.isArchived,
                    version: updated.version,
                    updatedAt: updated.updatedAt,
                    deletedAt: updated.deletedAt,
                    deletionReason: updated.deletionReason
                )
                : summary
        }
        return HomeBaseMutationAcknowledgement(success: true)
    }

    func createPatient(
        payload: HomeBasePatientCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        lastCreate = payload
        return HomeBaseCreatedResource(id: "created", version: 1)
    }

    func softDeletePatient(
        id: String,
        version: Int,
        sealedReason: String?,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        softDeleteCalls += 1
        lastSoftDelete = DeleteCall(id: id, version: version, sealedReason: sealedReason)
        let deletedAt = Date(timeIntervalSince1970: 1_750_000_300)
        summaries = summaries.map { summary in
            summary.id == id
                ? HomeBasePatientSummary(
                    id: summary.id,
                    firstName: summary.firstName,
                    lastName: summary.lastName,
                    birthDate: summary.birthDate,
                    taxCode: summary.taxCode,
                    isAdi: summary.isAdi,
                    isArchived: summary.isArchived,
                    version: summary.version + 1,
                    updatedAt: deletedAt,
                    deletedAt: deletedAt,
                    deletionReason: sealedReason
                )
                : summary
        }
        return HomeBaseCreatedResource(id: id, version: version + 1)
    }

    func restorePatient(
        id: String,
        version: Int,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        lastRestore = RestoreCall(id: id, version: version)
        summaries = summaries.map { summary in
            summary.id == id
                ? HomeBasePatientSummary(
                    id: summary.id,
                    firstName: summary.firstName,
                    lastName: summary.lastName,
                    birthDate: summary.birthDate,
                    taxCode: summary.taxCode,
                    isAdi: summary.isAdi,
                    isArchived: summary.isArchived,
                    version: summary.version + 1,
                    updatedAt: Date(timeIntervalSince1970: 1_750_000_400),
                    deletedAt: nil,
                    deletionReason: nil
                )
                : summary
        }
        return HomeBaseCreatedResource(id: id, version: version + 1)
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

    func fetchScopedCheckups(dateFrom: Date?, dateTo: Date?, status: [String], limit: Int?, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseCheckupSummary] { [] }
    func fetchScopedEntries(type: String?, dateFrom: Date?, dateTo: Date?, limit: Int?, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseEntrySummary] { [] }

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
        []
    }

    func createServicePrescription(
        payload: HomeBaseServicePrescriptionCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "service", version: 1)
    }

    func updateServicePrescription(
        prescriptionId: String,
        payload: HomeBaseServicePrescriptionUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchServicePrescriptionItems(
        patientId: String?,
        prescriptionId: String?,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseServicePrescriptionItemSummary] {
        []
    }

    func createServicePrescriptionItem(
        payload: HomeBaseServicePrescriptionItemCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "service-item", version: 1)
    }

    func updateServicePrescriptionItem(
        itemId: String,
        payload: HomeBaseServicePrescriptionItemUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
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
        []
    }

    func createProstheticPrescription(
        payload: HomeBaseProstheticPrescriptionCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "prosthetic", version: 1)
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
        NetworkCapabilitiesResponse(nodeId: "node", operatingMode: "network-home-base", protocolVersion: "1", capabilities: [])
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
        NetworkRevisionSummary(revision: "1", sourceFingerprint: "src", fingerprint: "stable")
    }

    func fetchFseValidatePatient(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseValidatePatientExportResponse {
        let empty = HomeBaseFseValidationSummary(total: 0, ok: 0, withErrors: 0, withWarnings: 0, errorCount: 0, warningCount: 0, items: [])
        return HomeBaseValidatePatientExportResponse(
            patientId: patientId,
            hasErrors: false,
            hasWarnings: false,
            therapyMedication: empty,
            observationVitals: empty
        )
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
