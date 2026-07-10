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
