import CryptoKit
import XCTest
@testable import MediFlowAppleShared

/* @Codex */
@MainActor
final class ClinicalWorkspaceViewsTests: XCTestCase {
    private let key = SymmetricKey(data: Data(repeating: 4, count: 32))

    func testAgendaLoadsScopedRowsAndStatistics() async {
        let source = S6MockDataSource(
            details: details(detail(id: "p1")),
            scopedCheckups: [checkup(id: "c1", patientID: "p1")]
        )
        let model = AgendaWorkspaceModel(connectionProvider: { self.connection(source) }, now: { Date(timeIntervalSince1970: 1_750_000_000) })
        await model.load()
        XCTAssertEqual(model.state, ClinicalWorkspaceLoadState.loaded)
        XCTAssertEqual(model.rows.first?.patientName, "Anna Rossi")
        XCTAssertEqual(model.todayCount, 1)
    }

    func testDiaryDecryptsClinicalFieldsWithTestMasterKey() async {
        let encryptedTitle = CryptoService.encryptField(CryptoService.jsonEncode("Visita domiciliare")!, masterKey: key)!
        let encryptedContent = CryptoService.encryptField(CryptoService.jsonEncode("Quadro stabile")!, masterKey: key)!
        let source = S6MockDataSource(details: details(detail(id: "p1")), scopedEntries: [
            HomeBaseEntrySummary(id: "e1", patientId: "p1", type: "note", title: encryptedTitle, date: Date(), content: encryptedContent, setting: nil, metadata: nil, attachments: "[]", deletedAt: nil, deletionReason: nil, version: 1, createdAt: nil, updatedAt: nil)
        ])
        let model = GlobalDiaryWorkspaceModel(connectionProvider: { self.connection(source) })
        await model.load()
        XCTAssertEqual(model.state, ClinicalWorkspaceLoadState.loaded)
        XCTAssertEqual(model.rows.first?.item.title, "Visita domiciliare")
        XCTAssertEqual(model.rows.first?.item.preview, "Quadro stabile")
    }

    func testAnalyticsLoadsDecryptedDiagnosesAndScaleCatalogLoadsPatients() async {
        let diagnoses = CryptoService.encryptField("[{\"code\":\"I10\",\"description\":\"Ipertensione\",\"system\":\"ICD-10\"}]", masterKey: key)!
        let source = S6MockDataSource(details: details(detail(id: "p1", diagnoses: diagnoses)))
        let analytics = PopulationAnalyticsWorkspaceModel(connectionProvider: { self.connection(source) })
        await analytics.load()
        XCTAssertEqual(analytics.state, ClinicalWorkspaceLoadState.loaded)
        XCTAssertEqual(analytics.statistics?.topDiagnoses.first?.description, "Ipertensione")
        let scales = ClinicalScalesCatalogModel(connectionProvider: { self.connection(source) })
        await scales.load()
        XCTAssertEqual(scales.state, ClinicalWorkspaceLoadState.loaded)
        XCTAssertEqual(scales.visiblePatients.count, 1)
    }

    func testCapabilityMissingAndNetworkFailureAreHonestStates() async {
        let unavailable = ClinicalWorkspaceCapabilitiesStore()
        await unavailable.loadIfNeeded(using: connection(S6MockDataSource(details: details(detail(id: "p1")))))
        XCTAssertEqual(unavailable.unavailableMessage(for: "network.replica.readonly-agenda"), "L'host collegato non espone ancora l'agenda cross-paziente (capability network.replica.readonly-agenda). Aggiorna MediFlow sull'host.")
        let failing = AgendaWorkspaceModel(connectionProvider: { self.connection(S6MockDataSource(details: self.details(self.detail(id: "p1")), shouldFail: true)) })
        await failing.load()
        guard case .failed(let message) = failing.state else { return XCTFail("Expected network failure") }
        XCTAssertTrue(message.hasPrefix("Impossibile caricare l'agenda:"))
    }

    func testCapabilitiesReloadAfterPairingTokenRotation() async {
        let store = ClinicalWorkspaceCapabilitiesStore()
        let legacySource = S6MockDataSource(details: details(detail(id: "p1")))
        let reapprovedSource = S6MockDataSource(
            details: details(detail(id: "p1")),
            capabilities: [
                NetworkCapability(
                    key: "network.replica.readonly-documents",
                    status: "available",
                    requiresPairing: true,
                    description: "Documenti"
                ),
            ]
        )
        let legacyConnection = connection(legacySource, clientToken: "legacy-token")
        let reapprovedConnection = connection(reapprovedSource, clientToken: "reapproved-token")

        XCTAssertNotEqual(legacyConnection.identity, reapprovedConnection.identity)
        await store.loadIfNeeded(using: legacyConnection)
        XCTAssertFalse(store.hasCapability("network.replica.readonly-documents"))

        await store.loadIfNeeded(using: reapprovedConnection)
        XCTAssertTrue(store.hasCapability("network.replica.readonly-documents"))
    }

    func testDisconnectClearsCapabilitiesAndAllowsSameConnectionToReload() async {
        let store = ClinicalWorkspaceCapabilitiesStore()
        let source = S6MockDataSource(
            details: details(detail(id: "p1")),
            capabilities: [
                NetworkCapability(
                    key: "network.replica.readonly-documents",
                    status: "available",
                    requiresPairing: true,
                    description: "Documenti"
                ),
            ]
        )
        let activeConnection = connection(source)

        await store.loadIfNeeded(using: activeConnection)
        XCTAssertTrue(store.hasCapability("network.replica.readonly-documents"))

        await store.loadIfNeeded(using: nil)
        XCTAssertFalse(store.hasCapability("network.replica.readonly-documents"))

        await store.loadIfNeeded(using: activeConnection)
        XCTAssertEqual(store.state, .loaded)
        XCTAssertTrue(store.hasCapability("network.replica.readonly-documents"))
    }

    func testFailedPairingRefreshDoesNotBlockPreviousConnection() async {
        let store = ClinicalWorkspaceCapabilitiesStore()
        let availableCapability = NetworkCapability(
            key: "network.replica.readonly-documents",
            status: "available",
            requiresPairing: true,
            description: "Documenti"
        )
        let workingSource = S6MockDataSource(
            details: details(detail(id: "p1")),
            capabilities: [availableCapability]
        )
        let failingSource = S6MockDataSource(
            details: details(detail(id: "p1")),
            shouldFail: true
        )
        let workingConnection = connection(workingSource, clientToken: "working-token")
        let failingConnection = connection(failingSource, clientToken: "rejected-token")

        await store.loadIfNeeded(using: workingConnection)
        XCTAssertTrue(store.hasCapability("network.replica.readonly-documents"))

        await store.loadIfNeeded(using: failingConnection)
        guard case .failed = store.state else { return XCTFail("Expected failed refresh") }
        XCTAssertFalse(store.hasCapability("network.replica.readonly-documents"))

        await store.loadIfNeeded(using: workingConnection)
        XCTAssertEqual(store.state, .loaded)
        XCTAssertTrue(store.hasCapability("network.replica.readonly-documents"))
    }

    func testCancelledCapabilityLoadCanRestartTheSameConnectionIdentity() async {
        let store = ClinicalWorkspaceCapabilitiesStore()
        let source = DocumentsMockDataSource(
            details: [:],
            capabilities: [
                NetworkCapability(
                    key: "network.replica.readonly-documents",
                    status: "available",
                    requiresPairing: true,
                    description: "Documenti"
                ),
            ],
            fetchCapabilitiesDelayNanoseconds: 50_000_000
        )
        let activeConnection = ClinicalWorkspaceConnection(
            dataSource: source,
            credentials: HomeBasePairedCredentials(clientId: "client", clientToken: "token"),
            sessionCookie: "sid=test",
            ambulatoryId: nil,
            masterKey: key
        )

        let cancelledLoad = Task { await store.loadIfNeeded(using: activeConnection) }
        try? await Task.sleep(nanoseconds: 5_000_000)
        cancelledLoad.cancel()
        await store.loadIfNeeded(using: activeConnection)
        await cancelledLoad.value

        XCTAssertEqual(store.state, .loaded)
        XCTAssertTrue(store.hasCapability("network.replica.readonly-documents"))
    }

    // MARK: - Proactive capability gate

    func testUnknownCapabilitiesPermitEveryActionInsteadOfDisablingTheApp() {
        // The failure mode this rules out. The store answers false for a key it
        // has not asked about yet, so wiring the buttons straight to it would
        // disable every action while the capability request is in flight, and
        // for good if that request failed. A network hiccup would turn the
        // archive read-only with no explanation.
        let unasked = ClinicalCapabilityGate()
        XCTAssertNil(unasked.availableKeys)
        XCTAssertTrue(unasked.permits(NetworkCapabilityKey.writePatientLifecycle))
        XCTAssertTrue(unasked.permits("una.chiave.che.non.esiste"))
    }

    func testASettledAnswerDeniesExactlyTheAbsentCapability() {
        let settled = ClinicalCapabilityGate(availableKeys: [
            NetworkCapabilityKey.readonlyPatients, NetworkCapabilityKey.writePatientProfile
        ])
        XCTAssertTrue(settled.permits(NetworkCapabilityKey.writePatientProfile))
        XCTAssertFalse(settled.permits(NetworkCapabilityKey.writePatientLifecycle))
        XCTAssertFalse(settled.permits(NetworkCapabilityKey.writeClinicalDiary))

        // An empty answer denies; it is not the same as no answer.
        XCTAssertFalse(ClinicalCapabilityGate(availableKeys: []).permits(NetworkCapabilityKey.writePatientProfile))
        // A disconnection returns the gate to "not asked", not to "denied".
        XCTAssertTrue(ClinicalCapabilityGate(availableKeys: nil).permits(NetworkCapabilityKey.writePatientLifecycle))
    }

    func testStoreReportsSettledKeysOnlyOnceTheyMeanSomething() async {
        let store = ClinicalWorkspaceCapabilitiesStore()
        XCTAssertNil(store.settledCapabilityKeys, "In stato .idle la risposta non esiste ancora")
        await store.loadIfNeeded(using: nil)
        XCTAssertNil(store.settledCapabilityKeys, "Senza connessione la risposta resta sconosciuta, non vuota")
    }

    func testEveryCapabilityTheClientGatesOnIsOfferedByTheDemo() {
        // The pact written beside `demoCapabilityKeys`: a key the client gates
        // on but the demo does not list is a surface that is dead offline. The
        // action gate added four keys, and this is what catches the fifth.
        let gated = [
            NetworkCapabilityKey.readonlyPatients, NetworkCapabilityKey.readonlyAgenda,
            NetworkCapabilityKey.readonlyClinicalDiaryGlobal, NetworkCapabilityKey.readonlyDocuments,
            NetworkCapabilityKey.writeDocuments, NetworkCapabilityKey.ambulatoriesWrite,
            NetworkCapabilityKey.computeVisitDraft, NetworkCapabilityKey.writePatientProfile,
            NetworkCapabilityKey.writePatientLifecycle, NetworkCapabilityKey.writeClinicalDiary,
            NetworkCapabilityKey.fseValidate
        ]
        let demo = Set(ClinicalWorkspaceCapabilitiesStore.demoCapabilityKeys)
        for key in gated {
            XCTAssertTrue(demo.contains(key), "\(key) e sotto cancello ma manca alla modalita dimostrativa")
        }
    }

    // MARK: - An unread archive must never be described as an empty one

    func testUnreadStateIsNeverReportedAsAnEmptyResult() {
        // The defect this pins: the three cross-patient views ended their `if`
        // chain on `rows.isEmpty`, so every state that is not loading or failed
        // produced the empty-result sentence. `.unavailable` is the state the
        // Agenda is actually in when no home-base is connected, and it is the
        // state demo mode leaves it in while forcing the capability gate open.
        let unread = ClinicalWorkspaceSectionContent(
            state: .unavailable("Collega l'home-base prima di caricare l'agenda."),
            isEmpty: true,
            idleMessage: "Agenda non ancora letta.",
            emptyMessage: "Nessuna visita pianificata."
        )
        XCTAssertEqual(unread, .message("Collega l'home-base prima di caricare l'agenda."))
        XCTAssertNotEqual(unread, .message("Nessuna visita pianificata."))

        let neverStarted = ClinicalWorkspaceSectionContent(
            state: .idle, isEmpty: true,
            idleMessage: "Agenda non ancora letta.", emptyMessage: "Nessuna visita pianificata."
        )
        XCTAssertEqual(neverStarted, .message("Agenda non ancora letta."))
        XCTAssertNotEqual(neverStarted, .message("Nessuna visita pianificata."))

        let failure = ClinicalWorkspaceSectionContent(
            state: .failed("Impossibile caricare l'agenda: rete assente"), isEmpty: true,
            idleMessage: "Agenda non ancora letta.", emptyMessage: "Nessuna visita pianificata."
        )
        XCTAssertEqual(failure, .message("Impossibile caricare l'agenda: rete assente"))

        XCTAssertEqual(
            ClinicalWorkspaceSectionContent(state: .loading, isEmpty: true, idleMessage: "i", emptyMessage: "e"),
            .progress
        )
    }

    func testEmptyResultIsStillReportedWhenTheReadActuallyHappened() {
        // The twin assertion: the guard above must not have been bought by
        // suppressing the empty-result sentence everywhere. After a real read
        // that returned nothing, "Nessuna visita pianificata." is the true
        // statement and must still be made.
        XCTAssertEqual(
            ClinicalWorkspaceSectionContent(
                state: .loaded, isEmpty: true,
                idleMessage: "Agenda non ancora letta.", emptyMessage: "Nessuna visita pianificata."
            ),
            .message("Nessuna visita pianificata.")
        )
        XCTAssertEqual(
            ClinicalWorkspaceSectionContent(
                state: .loaded, isEmpty: false,
                idleMessage: "Agenda non ancora letta.", emptyMessage: "Nessuna visita pianificata."
            ),
            .rows
        )
    }

    func testAgendaWithoutAConnectionSaysSoInsteadOfClaimingNoAppointments() async {
        let model = AgendaWorkspaceModel(connectionProvider: { nil })
        await model.load()
        XCTAssertEqual(model.state, .unavailable("Collega l'home-base prima di caricare l'agenda."))
        XCTAssertEqual(
            ClinicalWorkspaceSectionContent(
                state: model.state, isEmpty: model.rows.isEmpty,
                idleMessage: "Agenda non ancora letta.", emptyMessage: "Nessuna visita pianificata."
            ),
            .message("Collega l'home-base prima di caricare l'agenda.")
        )
    }

    func testGlobalDiaryMarksSealedFieldsAsLockedInsteadOfEmpty() async {
        // Sealed with a key this session does not hold. `decryptEntry` returns
        // "" for what it cannot open, the presentation layer fills the blank
        // with its own words, and the row then reads as an entry a clinician
        // left empty. The lock has to survive that trip.
        let otherKey = SymmetricKey(data: Data(repeating: 9, count: 32))
        let sealedTitle = CryptoService.encryptField(CryptoService.jsonEncode("Referto neurologico")!, masterKey: otherKey)!
        let sealedContent = CryptoService.encryptField(CryptoService.jsonEncode("Quadro in peggioramento")!, masterKey: otherKey)!
        let source = S6MockDataSource(details: details(detail(id: "p1")), scopedEntries: [
            HomeBaseEntrySummary(id: "e1", patientId: "p1", type: "note", title: sealedTitle, date: Date(), content: sealedContent, setting: nil, metadata: nil, attachments: "[]", deletedAt: nil, deletionReason: nil, version: 1, createdAt: nil, updatedAt: nil)
        ])
        let model = GlobalDiaryWorkspaceModel(connectionProvider: { self.connection(source) })
        await model.load()

        guard let row = model.rows.first else { return XCTFail("La voce sigillata deve comunque comparire nell'elenco") }
        XCTAssertTrue(row.lockedFields.contains(.title), "Il titolo sigillato deve risultare bloccato")
        XCTAssertTrue(row.lockedFields.contains(.content), "Il contenuto sigillato deve risultare bloccato")
        // Documents why the flag is needed: without it the row would show these
        // two sentences, which describe an entry nobody wrote.
        XCTAssertEqual(row.item.title, "Voce diario")
        XCTAssertEqual(row.item.preview, "Voce senza testo clinico.")
    }

    func testGlobalDiaryLeavesReadableFieldsUnlocked() async {
        // Twin assertion: the lock must come from the data, not be set always.
        let readableTitle = CryptoService.encryptField(CryptoService.jsonEncode("Visita di controllo")!, masterKey: key)!
        let readableContent = CryptoService.encryptField(CryptoService.jsonEncode("Parametri nella norma")!, masterKey: key)!
        let source = S6MockDataSource(details: details(detail(id: "p1")), scopedEntries: [
            HomeBaseEntrySummary(id: "e1", patientId: "p1", type: "note", title: readableTitle, date: Date(), content: readableContent, setting: nil, metadata: nil, attachments: "[]", deletedAt: nil, deletionReason: nil, version: 1, createdAt: nil, updatedAt: nil)
        ])
        let model = GlobalDiaryWorkspaceModel(connectionProvider: { self.connection(source) })
        await model.load()
        XCTAssertEqual(model.rows.first?.item.title, "Visita di controllo")
        XCTAssertFalse(model.rows.first?.lockedFields.contains(.title) ?? true)
    }

    private func connection(_ source: S6MockDataSource, clientToken: String = "token") -> ClinicalWorkspaceConnection {
        ClinicalWorkspaceConnection(dataSource: source, credentials: HomeBasePairedCredentials(clientId: "client", clientToken: clientToken), sessionCookie: "sid=test", ambulatoryId: nil, masterKey: key)
    }

    private func detail(id: String, diagnoses: String? = nil) -> HomeBasePatientDetail {
        HomeBasePatientDetail(id: id, firstName: "Anna", lastName: "Rossi", birthDate: Date(timeIntervalSince1970: 0), taxCode: "RSSANN00A00H501A", address: nil, phone: nil, caregiver: nil, exemptions: nil, diagnoses: diagnoses, monitoringProfile: nil, statusReason: nil, notes: nil, aiSummary: nil, documentInsights: nil, isAdi: false, isArchived: false, version: 1, ambulatoryId: nil, createdAt: nil, updatedAt: nil)
    }

    private func details(_ detail: HomeBasePatientDetail) -> [String: HomeBasePatientDetail] {
        [detail.id: detail]
    }

    private func checkup(id: String, patientID: String) -> HomeBaseCheckupSummary {
        HomeBaseCheckupSummary(id: id, patientId: patientID, date: Date(timeIntervalSince1970: 1_750_000_000), title: "Controllo", notes: nil, status: "pending", source: nil, version: 1, createdAt: nil, updatedAt: nil, deletedAt: nil, deletionReason: nil)
    }
}
