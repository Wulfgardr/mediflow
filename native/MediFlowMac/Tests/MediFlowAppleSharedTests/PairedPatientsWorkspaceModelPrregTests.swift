import CryptoKit
import XCTest
@testable import MediFlowAppleShared

// S3 (D3, lane PRREG): "Prescrittivo regionale" copia il CF decifrato in
// clipboard e apre la dashboard PRREG nel browser di sistema, senza toccare il
// pasteboard/browser reali del runner grazie allo spy iniettato al posto di
// SystemActions.
final class PairedPatientsWorkspaceModelPrregTests: XCTestCase {
    private final class SystemActionsSpy: SystemActionsPerforming, @unchecked Sendable {
        private(set) var openedURLs: [URL] = []
        private(set) var copiedTexts: [String] = []

        func openExternalURL(_ url: URL) {
            openedURLs.append(url)
        }

        func copyToSystemClipboard(_ text: String) {
            copiedTexts.append(text)
        }
    }

    func testOpenPrregHandoffCopiesTaxCodeAndOpensDashboard() async {
        let spy = SystemActionsSpy()
        let model = await makeModel(systemActions: spy)
        await model.configurePairedOnlineForTests(selectedPatient: detail(taxCode: "RSSMRA80A01H501U"))

        await model.openPrregHandoff()

        XCTAssertEqual(spy.copiedTexts, ["RSSMRA80A01H501U"])
        XCTAssertEqual(spy.openedURLs, [SissPortalURLs.prescrittivoRegionale])
        XCTAssertEqual(
            spy.openedURLs.first?.absoluteString,
            "https://operatorisiss.servizirl.it/prescrittivoRegionale/pages/dashboard"
        )
        let statusMessage = await model.statusMessage
        XCTAssertEqual(statusMessage, "CF copiato. Si apre il portale regionale nel browser.")
    }

    func testOpenPrregHandoffWithoutTaxCodeStillOpensDashboardButDoesNotCopy() async {
        let spy = SystemActionsSpy()
        let model = await makeModel(systemActions: spy)
        await model.configurePairedOnlineForTests(selectedPatient: detail(taxCode: "   "))

        await model.openPrregHandoff()

        XCTAssertEqual(spy.copiedTexts, [])
        XCTAssertEqual(spy.openedURLs, [SissPortalURLs.prescrittivoRegionale])
        let statusMessage = await model.statusMessage
        XCTAssertEqual(
            statusMessage,
            "CF non disponibile per questo paziente. Si apre comunque il portale regionale nel browser."
        )
    }

    func testOpenPrregHandoffWithoutSelectedPatientDoesNothing() async {
        let spy = SystemActionsSpy()
        let model = await makeModel(systemActions: spy)

        await model.openPrregHandoff()

        XCTAssertTrue(spy.openedURLs.isEmpty)
        XCTAssertTrue(spy.copiedTexts.isEmpty)
        let statusMessage = await model.statusMessage
        XCTAssertNil(statusMessage)
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
