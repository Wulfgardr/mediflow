import CryptoKit
import XCTest
@testable import MediFlowAppleShared

// S3 (D3, lane PRREG): "Prescrittivo regionale" copia il CF decifrato in
// clipboard e apre la dashboard PRREG nel browser di sistema, senza toccare il
// pasteboard/browser reali del runner grazie allo spy iniettato al posto di
// SystemActions.
final class PairedPatientsWorkspaceModelPrregTests: XCTestCase {
    private actor SystemActionsSpy: SystemActionsPerforming {
        private(set) var openedURLs: [URL] = []
        private(set) var copiedTexts: [String] = []
        private let openResult: Bool
        private let copyResult: Bool

        init(openResult: Bool = true, copyResult: Bool = true) {
            self.openResult = openResult
            self.copyResult = copyResult
        }

        func openExternalURL(_ url: URL) async -> Bool {
            openedURLs.append(url)
            return openResult
        }

        func copyToSystemClipboard(_ text: String) async -> Bool {
            copiedTexts.append(text)
            return copyResult
        }

        func recordedActions() -> (openedURLs: [URL], copiedTexts: [String]) {
            (openedURLs, copiedTexts)
        }
    }

    func testOpenPrregHandoffCopiesTaxCodeAndOpensDashboard() async {
        let spy = SystemActionsSpy()
        let model = await makeModel(systemActions: spy)
        await model.configurePairedOnlineForTests(selectedPatient: detail(taxCode: "RSSMRA80A01H501U"))

        await model.openPrregHandoff()

        let actions = await spy.recordedActions()
        XCTAssertEqual(actions.copiedTexts, ["RSSMRA80A01H501U"])
        XCTAssertEqual(actions.openedURLs, [SissPortalURLs.prescrittivoRegionale])
        XCTAssertEqual(
            actions.openedURLs.first?.absoluteString,
            "https://operatorisiss.servizirl.it/prescrittivoRegionale/pages/dashboard"
        )
        let statusMessage = await model.statusMessage
        XCTAssertEqual(statusMessage, "CF copiato. Portale regionale aperto nel browser.")
        let errorMessage = await model.errorMessage
        XCTAssertNil(errorMessage)
    }

    func testOpenPrregHandoffWithoutTaxCodeStillOpensDashboardButDoesNotCopy() async {
        let spy = SystemActionsSpy()
        let model = await makeModel(systemActions: spy)
        await model.configurePairedOnlineForTests(selectedPatient: detail(taxCode: "   "))

        await model.openPrregHandoff()

        let actions = await spy.recordedActions()
        XCTAssertEqual(actions.copiedTexts, [])
        XCTAssertEqual(actions.openedURLs, [SissPortalURLs.prescrittivoRegionale])
        let statusMessage = await model.statusMessage
        XCTAssertEqual(
            statusMessage,
            "CF non disponibile per questo paziente. Portale regionale aperto nel browser."
        )
        let errorMessage = await model.errorMessage
        XCTAssertNil(errorMessage)
    }

    func testOpenPrregHandoffWithoutSelectedPatientDoesNothing() async {
        let spy = SystemActionsSpy()
        let model = await makeModel(systemActions: spy)

        await model.openPrregHandoff()

        let actions = await spy.recordedActions()
        XCTAssertTrue(actions.openedURLs.isEmpty)
        XCTAssertTrue(actions.copiedTexts.isEmpty)
        let statusMessage = await model.statusMessage
        XCTAssertNil(statusMessage)
    }

    func testOpenPrregHandoffReportsClipboardFailureWithoutHidingSuccessfulOpen() async {
        let spy = SystemActionsSpy(copyResult: false)
        let model = await makeModel(systemActions: spy)
        await model.configurePairedOnlineForTests(selectedPatient: detail(taxCode: "RSSMRA80A01H501U"))

        await model.openPrregHandoff()

        let actions = await spy.recordedActions()
        XCTAssertEqual(actions.copiedTexts, ["RSSMRA80A01H501U"])
        XCTAssertEqual(actions.openedURLs, [SissPortalURLs.prescrittivoRegionale])
        let statusMessage = await model.statusMessage
        XCTAssertNil(statusMessage)
        let errorMessage = await model.errorMessage
        XCTAssertEqual(errorMessage, "Portale regionale aperto, ma la copia del CF non è riuscita.")
    }

    func testOpenPrregHandoffReportsOpenFailureWithoutHidingSuccessfulCopy() async {
        let spy = SystemActionsSpy(openResult: false)
        let model = await makeModel(systemActions: spy)
        await model.configurePairedOnlineForTests(selectedPatient: detail(taxCode: "RSSMRA80A01H501U"))

        await model.openPrregHandoff()

        let actions = await spy.recordedActions()
        XCTAssertEqual(actions.copiedTexts, ["RSSMRA80A01H501U"])
        XCTAssertEqual(actions.openedURLs, [SissPortalURLs.prescrittivoRegionale])
        let statusMessage = await model.statusMessage
        XCTAssertNil(statusMessage)
        let errorMessage = await model.errorMessage
        XCTAssertEqual(errorMessage, "CF copiato, ma l'apertura del portale regionale non è riuscita.")
    }

    @MainActor
    private func makeModel(systemActions: SystemActionsPerforming) -> PairedPatientsWorkspaceModel {
        let suiteName = "PairedPatientsWorkspaceModelPrregTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        let pairedStore = HomeBasePairedStore(
            userDefaults: defaults,
            keychainReader: { _, _ in .success(nil) },
            keychainWriter: { _, _, _ in .success(()) },
            keychainDeleter: { _, _ in .success(()) }
        )
        let cacheDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PairedPatientsWorkspaceModelPrregTests-\(UUID().uuidString)", isDirectory: true)
        let cacheStore = HomeBasePatientCacheStore(
            cacheDirectory: cacheDirectory,
            keyProvider: { SymmetricKey(data: Data(repeating: 8, count: 32)) }
        )
        return PairedPatientsWorkspaceModel(
            pairedStore: pairedStore,
            cacheStore: cacheStore,
            dataSourceFactory: nil,
            systemActions: systemActions
        )
    }

    private func detail(taxCode: String) -> HomeBasePatientDetail {
        HomeBasePatientDetail(
            id: "p1",
            firstName: "Mario",
            lastName: "Rossi",
            birthDate: nil,
            taxCode: taxCode,
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
}
