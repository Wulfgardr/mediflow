import CryptoKit
import XCTest
@testable import MediFlowAppleShared

@MainActor
final class SettingsWorkspaceTests: XCTestCase {
    private let key = SymmetricKey(data: Data(repeating: 7, count: 32))

    func testAmbulatoriesModelCreatesAndRefreshesThroughDataSourceExistential() async {
        let source = S6MockDataSource(
            details: [:],
            ambulatories: [ambulatory(id: "amb-1", name: "Sede principale", version: 2)]
        )
        let model = SettingsAmbulatoriesModel(connectionProvider: { self.connection(source) }, sessionExpired: {})

        await model.load()
        model.newName = "Sede test"
        model.newType = "test"
        await model.create()

        let createCount = await source.createAmbulatoryCount
        let fetchCount = await source.fetchAmbulatoriesCount
        XCTAssertEqual(model.state, ClinicalWorkspaceLoadState.loaded)
        XCTAssertEqual(model.ambulatories.map(\.id), ["amb-1"])
        XCTAssertEqual(model.message, "Ambulatorio creato.")
        XCTAssertEqual(createCount, 1)
        XCTAssertGreaterThanOrEqual(fetchCount, 2)
    }

    func testAmbulatoriesModelRefreshesAfterVersionConflict() async {
        let conflict = VersionConflictPayload(
            error: "Version conflict", code: "VERSION_CONFLICT", entity: "ambulatory",
            recordId: "amb-1", expectedVersion: 1, currentVersion: 2,
            currentUpdatedAt: nil, currentState: "active", currentSnapshot: nil
        )
        let source = S6MockDataSource(
            details: [:],
            ambulatories: [ambulatory(id: "amb-1", name: "Nome aggiornato", version: 2)],
            ambulatoryMutationError: .versionConflict(conflict)
        )
        let model = SettingsAmbulatoriesModel(connectionProvider: { self.connection(source) }, sessionExpired: {})

        await model.load()
        guard let ambulatory = model.ambulatories.first else {
            return XCTFail("Expected ambulatory after load")
        }
        model.beginRenaming(ambulatory)
        model.editingName = "Nuovo nome"
        await model.rename(ambulatory)

        let fetchCount = await source.fetchAmbulatoriesCount
        XCTAssertEqual(model.state, ClinicalWorkspaceLoadState.loaded)
        XCTAssertEqual(model.ambulatories.first?.name, "Nome aggiornato")
        XCTAssertEqual(model.message, "I dati sono cambiati sull'host. La lista è stata aggiornata.")
        XCTAssertGreaterThanOrEqual(fetchCount, 2)
    }

    func testAmbulatoriesModelReportsMissingSessionHonestly() async {
        let model = SettingsAmbulatoriesModel(connectionProvider: { nil }, sessionExpired: {})

        await model.load()

        XCTAssertEqual(model.state, .unavailable("Collega l'home-base e accedi con il PIN operatore per gestire gli ambulatori."))
    }

    func testAmbulatoriesCapabilityExplainsWhenRepairingPairingIsRequired() async {
        let store = ClinicalWorkspaceCapabilitiesStore()
        await store.loadIfNeeded(using: connection(S6MockDataSource(details: [:])))

        XCTAssertEqual(
            store.unavailableMessage(for: "network.ambulatories.write"),
            "L'host collegato non espone la gestione ambulatori. Il pairing potrebbe essere precedente: esegui di nuovo il pairing dopo aver aggiornato MediFlow sull'host."
        )
    }

    func testAiFunctionsModelLoadsRuntimeStatusWithoutMutations() async throws {
        let source = S6MockDataSource(details: [:], aiRuntime: try aiRuntime())
        let model = SettingsAiFunctionsModel(connectionProvider: { self.connection(source) })

        await model.load()

        XCTAssertEqual(model.state, .loaded)
        XCTAssertEqual(model.runtime?.killSwitches.patientInsight, .enabled)
        XCTAssertEqual(model.runtime?.killSwitches.documentSynthesis, .disabled)
        XCTAssertEqual(model.runtime?.killSwitches.smartImport, .enabled)
        XCTAssertEqual(model.runtime?.killSwitches.treatmentReasoning, .disabled)
        XCTAssertEqual(model.runtime?.localRuntime.state, "configured")
        XCTAssertEqual(model.runtime?.centralRuntime.state, "available")
        let fetchCount = await source.fetchAiRuntimeStatusCount
        let createCount = await source.createAmbulatoryCount
        XCTAssertEqual(fetchCount, 1)
        XCTAssertEqual(createCount, 0)
    }

    func testAiFunctionsModelFailsClosedWhenRuntimeStatusIsUnavailable() async {
        let source = S6MockDataSource(details: [:])
        let model = SettingsAiFunctionsModel(connectionProvider: { self.connection(source) })

        await model.load()

        XCTAssertEqual(model.state, .failed("Stato non disponibile."))
        XCTAssertNil(model.runtime)
        let fetchCount = await source.fetchAiRuntimeStatusCount
        XCTAssertEqual(fetchCount, 1)
    }

    func testAiFunctionsModelReportsMissingConnectionHonestly() async {
        let model = SettingsAiFunctionsModel(connectionProvider: { nil })

        await model.load()

        XCTAssertEqual(model.state, .unavailable("Collega l'home-base e accedi con il PIN operatore per consultare le funzioni AI."))
        XCTAssertNil(model.runtime)
    }

    func testProfileModelSavesAndNotifiesOperatorIdentityOwner() async {
        let source = S6MockDataSource(details: [:])
        var saved: (String?, String?)?
        let profile = SettingsProfileModel(
            connectionProvider: { self.connection(source) },
            profileUpdated: { displayName, ambulatoryName in saved = (displayName, ambulatoryName) },
            sessionExpired: {}
        )
        let identity = PairedPatientsWorkspaceModel.OperatorIdentity(
            userId: "operator-1", displayName: "Dott. Bianchi", ambulatoryName: "Centro Salute"
        )
        profile.sync(from: identity)
        profile.displayName = "Dott.ssa Bianchi"
        await profile.save(identity: identity)

        XCTAssertEqual(profile.message, "Profilo aggiornato.")
        XCTAssertEqual(saved?.0, "Dott.ssa Bianchi")
        XCTAssertEqual(saved?.1, "Centro Salute")
    }

    private func connection(_ source: any HomeBasePatientsDataSource) -> ClinicalWorkspaceConnection {
        ClinicalWorkspaceConnection(
            dataSource: source,
            credentials: HomeBasePairedCredentials(clientId: "client", clientToken: "token"),
            sessionCookie: "sid=test",
            ambulatoryId: nil,
            masterKey: key
        )
    }

    private func ambulatory(id: String, name: String, version: Int) -> NetworkAmbulatorySummary {
        NetworkAmbulatorySummary(
            id: id, name: name, address: nil, type: "live", isDefault: false,
            version: version, createdAt: nil
        )
    }

    private func aiRuntime() throws -> HomeBaseNetworkAiRuntimeSummary {
        try JSONDecoder().decode(
            HomeBaseNetworkAiRuntimeSummary.self,
            from: Data(#"{"plane":"ai-plane-separate-from-data-plane","mode":"centralized-available","localRuntime":{"provider":"ollama","state":"configured","targetPolicy":"loopback-only","hardwareProfile":"high","clinicalModel":null,"reasoningModel":null,"ocrModel":null},"centralRuntime":{"state":"available","capabilityStatus":"available","requiresPairing":true,"executionTarget":"paired-home-base","accessMode":"status-only","executionAuthorized":false},"fabric":{"schemaVersion":"mediflow.ai.network-fabric-status.v1","contractVersion":"mediflow.ai.fabric.v1","access":"status_only","pairedExecution":"not_authorized","egressGateOpen":false,"readinessNote":"available_unqualified","fallback":"denied_by_contract","venues":{"local_process":"configured","home_base":"host_configured","on_device":"not_implemented","cloud":"egress_profile_closed"}},"fallbackPolicy":"ai-unavailable-no-automatic-fallback","rolloutGate":"lane-benchmarks-and-rollout-governance-required","surfaces":["patient-insight","smart-import","document-synthesis","treatment-reasoning"],"killSwitches":{"patientInsight":"enabled","documentSynthesis":"disabled","smartImport":"enabled","treatmentReasoning":"disabled"},"guardrails":[]}"#.utf8)
        )
    }
}
