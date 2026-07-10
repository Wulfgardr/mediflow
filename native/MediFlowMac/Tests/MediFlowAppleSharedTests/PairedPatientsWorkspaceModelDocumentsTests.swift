import CryptoKit
import XCTest
@testable import MediFlowAppleShared

/* @Codex */
// S6 (Wave 5, ADR 0076): model-level coverage for the documents domain: list +
// on-demand detail load, upload with the ENC seal (payload-reale check per the
// spec trappole), follow-up projection dedup + prefill, and capability gating.
final class PairedPatientsWorkspaceModelDocumentsTests: XCTestCase {
    private let masterKey = SymmetricKey(data: Data(repeating: 3, count: 32))

    func testLoadSelectedPatientAttachmentsDecryptsListAndReportsEmptyState() async {
        let patient = detail(id: "p1")
        let emptySource = DocumentsMockDataSource(details: ["p1": patient])
        let emptyModel = await makeModel(source: emptySource)
        await emptyModel.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)
        await emptyModel.loadSelectedPatientAttachments()
        let emptyStatus = await emptyModel.statusMessage
        XCTAssertEqual(emptyStatus, "Nessun documento caricato per questo paziente.")

        let sealedName = sealedField("referto.pdf")
        let source = DocumentsMockDataSource(
            details: ["p1": patient],
            attachments: [
                attachmentSummary(id: "a1", name: sealedName, ocrState: .pending, ocrReason: .pairedUpload),
            ]
        )
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)

        await model.loadSelectedPatientAttachments()

        let attachments = await model.attachments
        XCTAssertEqual(attachments.count, 1)
        XCTAssertEqual(attachments.first?.name, "referto.pdf")
        XCTAssertEqual(attachments.first?.ocrQueueState, .pending)
        XCTAssertEqual(attachments.first?.ocrQueueReason, .pairedUpload)
    }

    func testOpenAttachmentDetailFetchesAndDecryptsDataOnDemand() async {
        let patient = detail(id: "p1")
        let dataURL = "data:application/pdf;base64,\(Data("PDF-BYTES".utf8).base64EncodedString())"
        let source = DocumentsMockDataSource(
            details: ["p1": patient],
            attachments: [attachmentSummary(id: "a1", name: sealedField("referto.pdf"))],
            attachmentDetail: attachmentDetail(id: "a1", name: sealedField("referto.pdf"), data: sealedField(dataURL))
        )
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)
        await model.loadSelectedPatientAttachments()

        let summary = await model.attachments.first
        let unwrapped = try? XCTUnwrap(summary)
        guard let summary = unwrapped else { return XCTFail("expected loaded attachment summary") }
        await model.openAttachmentDetail(summary)

        let detail = await model.selectedAttachmentDetail
        XCTAssertEqual(detail?.name, "referto.pdf")
        XCTAssertEqual(detail?.data, dataURL)
        let fetchCount = await source.fetchAttachmentCount
        XCTAssertEqual(fetchCount, 1)
    }

    func testInFlightAttachmentDetailDoesNotPublishAfterPatientChanges() async {
        let firstPatient = detail(id: "p1")
        let secondPatient = detail(id: "p2")
        let summary = attachmentSummary(id: "a1", name: sealedField("referto.pdf"))
        let source = DocumentsMockDataSource(
            details: ["p1": firstPatient, "p2": secondPatient],
            attachments: [summary],
            attachmentDetail: attachmentDetail(id: "a1", name: sealedField("referto.pdf"), data: sealedField("data:text/plain;base64,QQ==")),
            fetchAttachmentDelayNanoseconds: 50_000_000
        )
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: firstPatient)

        let loading = Task { await model.openAttachmentDetail(summary) }
        for _ in 0..<100 {
            if await source.fetchAttachmentCount > 0 { break }
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        let startedCalls = await source.fetchAttachmentCount
        XCTAssertEqual(startedCalls, 1)

        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: secondPatient)
        await loading.value

        let detail = await model.selectedAttachmentDetail
        XCTAssertNil(detail)
    }

    func testUploadAttachmentSealsPayloadAndExcludesServerControlledFields() async throws {
        let patient = detail(id: "p1")
        let source = DocumentsMockDataSource(details: ["p1": patient])
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)

        let rawBytes = Data("hello referto".utf8)
        await model.uploadAttachmentForSelectedPatient(patientId: patient.id, fileName: "referto.pdf", mimeType: "application/pdf", rawData: rawBytes)

        let payload = await source.lastCreatePayload
        let unwrapped = try XCTUnwrap(payload)
        // Payload-reale (spec trappole): the wire object created by the client
        // must carry ONLY the projection fields, all three sealed ENC.
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(unwrapped)) as? [String: Any]
        let keys = Set(try XCTUnwrap(encoded).keys)
        XCTAssertEqual(keys, ["name", "path", "data", "type", "size"])
        XCTAssertTrue(unwrapped.name.hasPrefix(CryptoService.encPrefix))
        XCTAssertTrue(unwrapped.path.hasPrefix(CryptoService.encPrefix))
        XCTAssertTrue(unwrapped.data.hasPrefix(CryptoService.encPrefix))
        XCTAssertEqual(unwrapped.type, "application/pdf")
        XCTAssertEqual(unwrapped.size, rawBytes.count)

        // Decrypting `data` back must recover the exact web-shaped data URL.
        let decryptedJSON = try XCTUnwrap(CryptoService.decryptField(unwrapped.data, masterKey: masterKey))
        let decryptedDataURL = CryptoService.jsonDecodeString(decryptedJSON)
        XCTAssertEqual(decryptedDataURL, HomeBaseAttachmentDataURL.encode(mimeType: "application/pdf", bytes: rawBytes))

        let createCount = await source.createAttachmentCalls
        XCTAssertEqual(createCount, 1)
        let createdPatientId = await source.lastCreatePatientId
        XCTAssertEqual(createdPatientId, patient.id)
        let status = await model.statusMessage
        XCTAssertEqual(status, "Documento caricato: in coda per elaborazione sull'home-base.")
    }

    func testUploadAttachmentRefusesOversizedFileAndNeverCallsCreate() async {
        let patient = detail(id: "p1")
        let source = DocumentsMockDataSource(details: ["p1": patient])
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)

        // Comfortably above HomeBaseAttachmentWirePrecheck.maxRecommendedRawBytes()
        // at the 25 MB default (~17.8 MB), without allocating a 25 MB fixture.
        let oversizedRawByteCount = 20 * 1024 * 1024
        let rawBytes = Data(count: oversizedRawByteCount)

        await model.uploadAttachmentForSelectedPatient(patientId: patient.id, fileName: "scan.pdf", mimeType: "application/pdf", rawData: rawBytes)

        let createCount = await source.createAttachmentCalls
        XCTAssertEqual(createCount, 0)
        let error = await model.errorMessage
        XCTAssertEqual(
            error,
            HomeBaseAttachmentWirePrecheck.check(rawByteCount: oversizedRawByteCount).message
        )
    }

    func testUploadAttachmentRejectsCapturedPatientAfterSelectionChanges() async {
        let firstPatient = detail(id: "p1")
        let secondPatient = detail(id: "p2")
        let source = DocumentsMockDataSource(details: ["p1": firstPatient, "p2": secondPatient])
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: firstPatient)

        let capturedPatientId = firstPatient.id
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: secondPatient)
        await model.uploadAttachmentForSelectedPatient(
            patientId: capturedPatientId,
            fileName: "referto.pdf",
            mimeType: "application/pdf",
            rawData: Data("documento".utf8)
        )

        let createCalls = await source.createAttachmentCalls
        let errorMessage = await model.errorMessage
        XCTAssertEqual(createCalls, 0)
        XCTAssertEqual(errorMessage, "Il paziente selezionato e cambiato: scegli di nuovo il documento.")
    }

    func testFollowupSuggestionsDedupAgainstExistingCheckupsAndPrefillSetsFormFields() async {
        let patient = detailWithInsights(id: "p1")
        let source = DocumentsMockDataSource(
            details: ["p1": patient],
            checkups: [checkup(id: "c1", title: "Controllo cardiologico")]
        )
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: patient)
        await model.loadSelectedPatientCheckups()

        let suggestions = await model.followupSuggestions
        // "Controllo cardiologico" is excluded (already exists as a checkup,
        // case/whitespace-insensitive); "Controllo dermatologico" remains.
        XCTAssertEqual(suggestions.map(\.label), ["Controllo dermatologico"])

        let suggestion = try? XCTUnwrap(suggestions.first)
        guard let suggestion else { return XCTFail("expected one remaining suggestion") }
        await MainActor.run { model.prefillNewCheckupFromFollowup(suggestion) }

        let title = await model.newCheckupTitle
        let notes = await model.newCheckupNotes
        let source_ = await model.newCheckupSource
        XCTAssertEqual(title, "Controllo dermatologico")
        XCTAssertEqual(notes, "da rivalutare in ambulatorio\nSuggerito da referto-derma.pdf")
        XCTAssertEqual(source_, "ai_suggestion")
    }

    func testCapabilityGatingMessagesForNewDocumentCapabilities() async {
        let store = await ClinicalWorkspaceCapabilitiesStore()
        let source = DocumentsMockDataSource(
            details: [:],
            capabilities: [
                NetworkCapability(key: "network.replica.readonly-documents", status: "disabled", requiresPairing: true, description: "docs read"),
            ]
        )
        let connection = ClinicalWorkspaceConnection(
            dataSource: source,
            credentials: HomeBasePairedCredentials(clientId: "c", clientToken: "t"),
            sessionCookie: "sid=test",
            ambulatoryId: nil,
            masterKey: nil
        )
        await store.loadIfNeeded(using: connection)

        let hasReadonly = await store.hasCapability("network.replica.readonly-documents")
        let hasWrite = await store.hasCapability("network.replica.write-documents")
        XCTAssertFalse(hasReadonly)
        XCTAssertFalse(hasWrite)

        let readonlyMessage = await store.unavailableMessage(for: "network.replica.readonly-documents")
        let writeMessage = await store.unavailableMessage(for: "network.replica.write-documents")
        XCTAssertEqual(
            readonlyMessage,
            "L'host o il pairing corrente non espongono ancora l'archivio documenti. Aggiorna MediFlow sull'host e ripeti il pairing."
        )
        XCTAssertEqual(
            writeMessage,
            "L'host collegato non espone il caricamento documenti. Il pairing potrebbe essere precedente: esegui di nuovo il pairing dopo aver aggiornato MediFlow sull'host."
        )

        let visitDraftMessage = await store.unavailableMessage(for: "network.compute.visit-draft")
        XCTAssertEqual(
            visitDraftMessage,
            "L'host o il pairing corrente non espongono ancora l'elaborazione della bozza visita. Aggiorna MediFlow sull'host e ripeti il pairing."
        )
    }

    @MainActor
    private func makeModel(source: DocumentsMockDataSource) -> PairedPatientsWorkspaceModel {
        let suiteName = "PairedPatientsWorkspaceModelDocumentsTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        let pairedStore = HomeBasePairedStore(
            userDefaults: defaults,
            keychainReader: { _, _ in .success(nil) },
            keychainWriter: { _, _, _ in .success(()) },
            keychainDeleter: { _, _ in .success(()) }
        )
        let cacheDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PairedPatientsWorkspaceModelDocumentsTests-\(UUID().uuidString)", isDirectory: true)
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

    private func sealedField(_ value: String) -> String {
        guard let json = CryptoService.jsonEncode(value), let sealed = CryptoService.encryptField(json, masterKey: masterKey) else {
            fatalError("fixture sealing must not fail")
        }
        return sealed
    }

    private func detail(id: String) -> HomeBasePatientDetail {
        HomeBasePatientDetail(
            id: id, firstName: "Mario", lastName: "Rossi", birthDate: nil, taxCode: "RSSMRA80A01H501U",
            address: nil, phone: nil, caregiver: nil, exemptions: nil, diagnoses: nil, monitoringProfile: nil,
            statusReason: nil, notes: nil, aiSummary: nil, documentInsights: nil, isAdi: false, isArchived: false,
            version: 1, ambulatoryId: "AMB-1", createdAt: nil, updatedAt: Date(timeIntervalSince1970: 1_750_000_000),
            deletedAt: nil, deletionReason: nil
        )
    }

    /// Two document insights, one with a follow-up matching an already-existing
    /// checkup title (must be excluded) and one that stays a live suggestion.
    private func detailWithInsights(id: String) -> HomeBasePatientDetail {
        let json = """
        [
            {
                "id": "insight-1",
                "fileName": "referto-cardio.pdf",
                "date": "2026-06-01T00:00:00.000Z",
                "summary": "Referto cardiologico di controllo.",
                "evidencePack": {
                    "schemaVersion": "mediflow.document_evidence_pack.v2",
                    "source": { "documentInsightId": "insight-1", "fileName": "referto-cardio.pdf", "documentDate": "2026-06-01T00:00:00.000Z" },
                    "facts": [
                        { "id": "f1", "kind": "followup", "label": "Controllo cardiologico", "excerpt": "da ripetere fra 6 mesi", "sourceId": "s1", "temporality": "planned", "status": "planned", "origin": "documented" }
                    ]
                }
            },
            {
                "id": "insight-2",
                "fileName": "referto-derma.pdf",
                "date": "2026-06-02T00:00:00.000Z",
                "summary": "Referto dermatologico.",
                "evidencePack": {
                    "schemaVersion": "mediflow.document_evidence_pack.v2",
                    "source": { "documentInsightId": "insight-2", "fileName": "referto-derma.pdf", "documentDate": "2026-06-02T00:00:00.000Z" },
                    "facts": [
                        { "id": "f2", "kind": "followup", "label": "Controllo dermatologico", "excerpt": "da rivalutare in ambulatorio", "sourceId": "s2", "temporality": "planned", "status": "planned", "origin": "documented" }
                    ]
                }
            }
        ]
        """
        return HomeBasePatientDetail(
            id: id, firstName: "Mario", lastName: "Rossi", birthDate: nil, taxCode: "RSSMRA80A01H501U",
            address: nil, phone: nil, caregiver: nil, exemptions: nil, diagnoses: nil, monitoringProfile: nil,
            statusReason: nil, notes: nil, aiSummary: nil, documentInsights: json, isAdi: false, isArchived: false,
            version: 1, ambulatoryId: "AMB-1", createdAt: nil, updatedAt: Date(timeIntervalSince1970: 1_750_000_000),
            deletedAt: nil, deletionReason: nil
        )
    }

    private func checkup(id: String, title: String) -> HomeBaseCheckupSummary {
        HomeBaseCheckupSummary(
            id: id, patientId: "p1", date: Date(timeIntervalSince1970: 1_750_000_000), title: title, notes: nil,
            status: "pending", source: "manual", version: 1, createdAt: nil, updatedAt: nil, deletedAt: nil, deletionReason: nil
        )
    }

    private func attachmentSummary(
        id: String, name: String, ocrState: HomeBaseDocumentOcrQueueState? = nil, ocrReason: HomeBaseDocumentOcrQueueReason? = nil
    ) -> HomeBaseAttachmentSummary {
        HomeBaseAttachmentSummary(
            id: id, patientId: "p1", name: name, type: "application/pdf", size: 1024, path: sealedField("uploads/\(id)"),
            summarySnapshot: nil, parseEvidenceArtifactSnapshot: nil, ocrQueueState: ocrState, ocrQueueReason: ocrReason,
            ocrQueueUpdatedAt: nil, ocrReplayArtifactSnapshot: nil, createdAt: Date(timeIntervalSince1970: 1_750_000_000)
        )
    }

    private func attachmentDetail(id: String, name: String, data: String) -> HomeBaseAttachmentDetail {
        HomeBaseAttachmentDetail(
            id: id, patientId: "p1", name: name, type: "application/pdf", size: 1024, path: sealedField("uploads/\(id)"),
            summarySnapshot: nil, parseEvidenceArtifactSnapshot: nil, ocrQueueState: nil, ocrQueueReason: nil,
            ocrQueueUpdatedAt: nil, ocrReplayArtifactSnapshot: nil, createdAt: Date(timeIntervalSince1970: 1_750_000_000),
            data: data
        )
    }
}

actor DocumentsMockDataSource: HomeBasePatientsDataSource {
    private let details: [String: HomeBasePatientDetail]
    private let attachments: [HomeBaseAttachmentSummary]
    private let attachmentDetailFixture: HomeBaseAttachmentDetail?
    private let checkups: [HomeBaseCheckupSummary]
    private let capabilitiesFixture: [NetworkCapability]
    private let fetchAttachmentDelayNanoseconds: UInt64
    private(set) var lastCreatePayload: HomeBaseAttachmentCreatePayload?
    private(set) var lastCreatePatientId: String?
    private(set) var createAttachmentCalls = 0
    private(set) var fetchAttachmentCount = 0

    init(
        details: [String: HomeBasePatientDetail],
        attachments: [HomeBaseAttachmentSummary] = [],
        attachmentDetail: HomeBaseAttachmentDetail? = nil,
        checkups: [HomeBaseCheckupSummary] = [],
        capabilities: [NetworkCapability] = [],
        fetchAttachmentDelayNanoseconds: UInt64 = 0
    ) {
        self.details = details
        self.attachments = attachments
        self.attachmentDetailFixture = attachmentDetail
        self.checkups = checkups
        self.capabilitiesFixture = capabilities
        self.fetchAttachmentDelayNanoseconds = fetchAttachmentDelayNanoseconds
    }

    func login(username: String?, password: String) async throws -> HomeBaseLoginResult {
        HomeBaseLoginResult(sessionCookie: "sid=test", encryptedMasterKey: nil, salt: nil)
    }

    func changePin(currentPin: String, newPin: String, encryptedMasterKey: String, salt: String, credentials: HomeBasePairedCredentials, sessionCookie: String) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func logout(credentials: HomeBasePairedCredentials, sessionCookie: String) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func updateProfile(userId: String, displayName: String, ambulatoryName: String, credentials: HomeBasePairedCredentials, sessionCookie: String) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func createAmbulatory(payload: HomeBaseAmbulatoryCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String) async throws -> HomeBaseAmbulatoryMutationResponse {
        HomeBaseAmbulatoryMutationResponse(success: true, id: payload.id ?? "amb", version: 1)
    }

    func updateAmbulatory(id: String, payload: HomeBaseAmbulatoryUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String) async throws -> HomeBaseAmbulatoryMutationResponse {
        HomeBaseAmbulatoryMutationResponse(success: true, version: payload.expectedVersion + 1)
    }

    func deleteAmbulatory(id: String, expectedVersion: Int, credentials: HomeBasePairedCredentials, sessionCookie: String) async throws -> HomeBaseAmbulatoryMutationResponse {
        HomeBaseAmbulatoryMutationResponse(success: true)
    }

    func clearAmbulatory(id: String, expectedVersion: Int, credentials: HomeBasePairedCredentials, sessionCookie: String) async throws -> HomeBaseAmbulatoryMutationResponse {
        HomeBaseAmbulatoryMutationResponse(success: true, version: expectedVersion + 1)
    }

    func fetchPatients(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, includeDeleted: Bool) async throws -> [HomeBasePatientSummary] {
        details.values.map {
            HomeBasePatientSummary(
                id: $0.id, firstName: $0.firstName, lastName: $0.lastName, birthDate: $0.birthDate, taxCode: $0.taxCode,
                isAdi: $0.isAdi, isArchived: $0.isArchived, version: $0.version, updatedAt: $0.updatedAt,
                deletedAt: $0.deletedAt, deletionReason: $0.deletionReason, diagnoses: $0.diagnoses
            )
        }
    }

    func fetchPatients(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, includeDiagnoses: Bool) async throws -> [HomeBasePatientSummary] {
        try await fetchPatients(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId, includeDeleted: false)
    }

    func fetchNetworkAmbulatories(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [NetworkAmbulatorySummary] {
        []
    }

    func searchDrugs(query: String, limit: Int, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseDrugSummary] {
        []
    }

    func searchExemptions(query: String, limit: Int, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseExemptionSummary] {
        []
    }

    func searchTerminology(system: String, query: String, limit: Int, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseTerminologyItem] {
        []
    }

    func resolveTerminology(system: String, code: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseTerminologyItem {
        throw HomeBaseClientError.httpStatus(404, "Not found")
    }

    func fetchTerminologySystems(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseTerminologyRegistryEntry] {
        []
    }

    func fetchPatient(id: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBasePatientDetail {
        guard let detail = details[id] else { throw HomeBaseClientError.httpStatus(404, "Not found") }
        return detail
    }

    func updatePatient(patientId: String, payload: HomeBasePatientUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func createPatient(payload: HomeBasePatientCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "created", version: 1)
    }

    func softDeletePatient(id: String, version: Int, sealedReason: String?, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: id, version: version + 1)
    }

    func restorePatient(id: String, version: Int, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: id, version: version + 1)
    }

    func fetchEntries(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, limit: Int) async throws -> [HomeBaseEntrySummary] {
        []
    }

    func createEntry(patientId: String, payload: HomeBaseEntryCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: payload.id, version: 1)
    }

    func updateEntry(patientId: String, entryId: String, payload: HomeBaseEntryUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchAttachments(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseAttachmentSummary] {
        attachments
    }

    func fetchAttachment(patientId: String, attachmentId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseAttachmentDetail {
        fetchAttachmentCount += 1
        if fetchAttachmentDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: fetchAttachmentDelayNanoseconds)
        }
        guard let attachmentDetailFixture else { throw HomeBaseClientError.httpStatus(404, "Not found") }
        return attachmentDetailFixture
    }

    func createAttachment(patientId: String, payload: HomeBaseAttachmentCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        createAttachmentCalls += 1
        lastCreatePatientId = patientId
        lastCreatePayload = payload
        return HomeBaseCreatedResource(id: "attachment", version: nil)
    }

    func computeVisitDraft(input: HomeBaseVisitDraftInput, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseVisitDraftResponse {
        throw HomeBaseClientError.contract
    }

    func fetchAiRuntimeStatus(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseNetworkAiRuntimeSummary {
        throw HomeBaseClientError.contract
    }

    func fetchTherapies(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, limit: Int) async throws -> [HomeBaseTherapySummary] {
        []
    }

    func createTherapy(patientId: String, payload: HomeBaseTherapyCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "therapy", version: 1)
    }

    func updateTherapy(patientId: String, therapyId: String, payload: HomeBaseTherapyUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchCheckups(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, limit: Int) async throws -> [HomeBaseCheckupSummary] {
        checkups
    }

    func fetchScopedCheckups(dateFrom: Date?, dateTo: Date?, status: [String], limit: Int?, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseCheckupSummary] { checkups }
    func fetchScopedEntries(type: String?, dateFrom: Date?, dateTo: Date?, limit: Int?, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseEntrySummary] { [] }

    func createCheckup(patientId: String, payload: HomeBaseCheckupCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "checkup", version: 1)
    }

    func updateCheckup(patientId: String, checkupId: String, payload: HomeBaseCheckupUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchObservations(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?, limit: Int) async throws -> [HomeBaseObservationSummary] {
        []
    }

    func createObservation(patientId: String, payload: HomeBaseObservationCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "observation", version: 1)
    }

    func updateObservation(patientId: String, observationId: String, payload: HomeBaseObservationUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchServicePrescriptions(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseServicePrescriptionSummary] {
        []
    }

    func createServicePrescription(payload: HomeBaseServicePrescriptionCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "service", version: 1)
    }

    func updateServicePrescription(prescriptionId: String, payload: HomeBaseServicePrescriptionUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchServicePrescriptionItems(patientId: String?, prescriptionId: String?, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseServicePrescriptionItemSummary] {
        []
    }

    func createServicePrescriptionItem(payload: HomeBaseServicePrescriptionItemCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "service-item", version: 1)
    }

    func updateServicePrescriptionItem(itemId: String, payload: HomeBaseServicePrescriptionItemUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchServiceCatalog(query: String?, code: String?, limit: Int, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseServiceCatalogEntrySummary] {
        []
    }

    func fetchServiceCatalogCount(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCatalogCountResponse {
        HomeBaseCatalogCountResponse(count: 0)
    }

    func fetchProstheticPrescriptions(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseProstheticPrescriptionSummary] {
        []
    }

    func createProstheticPrescription(payload: HomeBaseProstheticPrescriptionCreatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseCreatedResource {
        HomeBaseCreatedResource(id: "prosthetic", version: 1)
    }

    func updateProstheticPrescription(prescriptionId: String, payload: HomeBaseProstheticPrescriptionUpdatePayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func fetchNetworkCapabilities(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> NetworkCapabilitiesResponse {
        NetworkCapabilitiesResponse(nodeId: "node", operatingMode: "network-home-base", protocolVersion: "1", capabilities: capabilitiesFixture)
    }

    func fetchNetworkIdentity(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> NetworkIdentitySummary {
        throw HomeBaseClientError.contract
    }

    func fetchNetworkNode(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> NetworkNodeSummary {
        NetworkNodeSummary(
            nodeId: "node", displayName: "Mac", role: "home-base-candidate", operatingMode: "network-home-base",
            protocolVersion: "1", transport: NetworkNodeSummary.Transport(apiBasePath: "/api/v1", tlsRequired: true, localTlsPort: 3443)
        )
    }

    func fetchNetworkRevision(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> NetworkRevisionSummary {
        NetworkRevisionSummary(revision: "1", sourceFingerprint: "src", fingerprint: "stable")
    }

    func fetchFseValidatePatient(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseValidatePatientExportResponse {
        HomeBaseValidatePatientExportResponse(
            patientId: patientId, hasErrors: false, hasWarnings: false,
            therapyMedication: HomeBaseFseValidationSummary(total: 0, ok: 0, withErrors: 0, withWarnings: 0, errorCount: 0, warningCount: 0, items: []),
            observationVitals: HomeBaseFseValidationSummary(total: 0, ok: 0, withErrors: 0, withWarnings: 0, errorCount: 0, warningCount: 0, items: [])
        )
    }

    func validateFseDocument(payload: HomeBaseFseDocumentValidationPayload, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseFseDocumentValidationResponse {
        HomeBaseFseDocumentValidationResponse(ok: true, profile: payload.profile, errors: [], warnings: [])
    }
}
