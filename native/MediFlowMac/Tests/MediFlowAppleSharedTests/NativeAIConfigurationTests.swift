/* @Codex */
import Foundation
import XCTest
@testable import MediFlowAppleShared

@MainActor
final class NativeAIConfigurationTests: XCTestCase {
    private func snapshot(revision: Character = "a") throws -> NativeAIFunctionPreferences {
        let ids = ["patient_insight", "smart_import", "document_synthesis", "treatment_reasoning"]
        let object: [String: Any] = [
            "schemaVersion": "mediflow.function-preferences.v1", "revision": "sha256_" + String(repeating: String(revision), count: 64),
            "catalogRevision": "sha256_" + String(repeating: "b", count: 64), "check": "configuration_only", "apply": "denied",
            "presets": ["host_defaults", "all_off"],
            "functions": ids.map { ["id": $0, "enabled": false, "defaultModelOptionId": NSNull(), "defaultSource": "host_configuration", "bindingState": "unsupported", "options": []] as [String: Any] }
        ]
        return try JSONDecoder().decode(NativeAIFunctionPreferences.self, from: JSONSerialization.data(withJSONObject: object))
    }
    private func connection(generation: UInt = 0) -> ClinicalWorkspaceConnection {
        ClinicalWorkspaceConnection(dataSource: S6MockDataSource(details: [:]),
            credentials: HomeBasePairedCredentials(clientId: "synthetic-mac", clientToken: "synthetic-token"),
            sessionCookie: "mediflow_session=synthetic-native", ambulatoryId: nil, masterKey: nil,
            serverURL: "https://localhost", tlsPin: String(repeating: "a", count: 64), sessionGeneration: generation)
    }
    private func settle(_ model: NativeAIConfigurationModel) async {
        for _ in 0..<100 where model.isWorking { await Task.yield() }
    }
    func testCommandsEncodeExactKeysAndExplicitNullWithoutProviderOrCookie() throws {
        let value = try snapshot(); try value.validate()
        let command = NativeAIFunctionCommand(snapshot: value, functionId: "patient_insight", enabled: false, defaultModelOptionId: nil)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(command)) as? [String: Any])
        XCTAssertEqual(Set(object.keys), Set(["schemaVersion", "commandId", "expectedRevision", "expectedCatalogRevision", "action", "functionId", "enabled", "defaultModelOptionId"]))
        XCTAssertTrue(object["defaultModelOptionId"] is NSNull)
        let preset = NativeAIFunctionCommand(snapshot: value, presetId: "all_off")
        let presetObject = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(preset)) as? [String: Any])
        XCTAssertEqual(Set(presetObject.keys), Set(["schemaVersion", "commandId", "expectedRevision", "expectedCatalogRevision", "action", "presetId"]))
        XCTAssertEqual(preset.expectedRevision, value.revision)
    }
    func testPreviewAndConfirmKeepCommandIDAndRereadAfterApply() async throws {
        let initial = try snapshot(); let updated = try snapshot(revision: "c")
        var reads = 0; var previews = 0; var applied: NativeAIFunctionCommand?
        let model = NativeAIConfigurationModel(connectionProvider: { self.connection() }, services: .init(read: { _ in
            reads += 1; return reads == 1 ? initial : updated
        }, preview: { command, _ in
            previews += 1
            return NativeAIFunctionPreview(schemaVersion: "mediflow.function-preferences-preview.v1", command: command, proposed: updated, writesPerformed: 0)
        }, apply: { command, _ in applied = command; return updated }))
        model.load(); await settle(model)
        let command = NativeAIFunctionCommand(snapshot: initial, presetId: "all_off")
        model.prepare(command); await settle(model)
        XCTAssertEqual(previews, 1); XCTAssertNil(applied); XCTAssertEqual(model.preview?.command.commandId, command.commandId)
        model.confirm(); await settle(model)
        XCTAssertEqual(applied, command); XCTAssertEqual(reads, 2); XCTAssertEqual(model.snapshot, updated); XCTAssertNil(model.preview)
        XCTAssertEqual(model.message, "Preferenze salvate e rilette dall’host.")
    }
    func testLockDiscardsLateReadEvenWhenTransportIgnoresCancellation() async throws {
        let value = try snapshot()
        var pending: CheckedContinuation<NativeAIFunctionPreferences, Never>?
        let model = NativeAIConfigurationModel(connectionProvider: { self.connection() }, services: .init(read: { _ in
            await withCheckedContinuation { pending = $0 }
        }, preview: { _, _ in throw HomeBaseClientError.contract }, apply: { _, _ in throw HomeBaseClientError.contract }))
        model.load()
        for _ in 0..<100 where pending == nil { await Task.yield() }
        XCTAssertNotNil(pending); model.invalidate(); pending?.resume(returning: value)
        await Task.yield(); await Task.yield()
        XCTAssertNil(model.snapshot); XCTAssertNil(model.preview); XCTAssertFalse(model.isWorking)
    }
    func testSessionChangeDiscardsLatePreview() async throws {
        let value = try snapshot(); var current = connection()
        var pending: CheckedContinuation<NativeAIFunctionPreview, Never>?
        let model = NativeAIConfigurationModel(connectionProvider: { current }, services: .init(read: { _ in value }, preview: { _, _ in
            await withCheckedContinuation { pending = $0 }
        }, apply: { _, _ in XCTFail("No apply expected"); return value }))
        model.load(); await settle(model)
        let command = NativeAIFunctionCommand(snapshot: value, presetId: "all_off")
        model.prepare(command)
        for _ in 0..<100 where pending == nil { await Task.yield() }
        current = connection(generation: 1); model.invalidate()
        pending?.resume(returning: NativeAIFunctionPreview(schemaVersion: "mediflow.function-preferences-preview.v1", command: command, proposed: value, writesPerformed: 0))
        await Task.yield(); await Task.yield()
        model.confirm(); XCTAssertNil(model.preview); XCTAssertNil(model.snapshot)
    }
    func testSessionChangeBeforeViewRefreshCannotConfirmAnotherSessionsPreview() async throws {
        let value = try snapshot(); var current = connection(); var applies = 0
        let model = NativeAIConfigurationModel(connectionProvider: { current }, services: .init(read: { _ in value }, preview: { command, _ in
            NativeAIFunctionPreview(schemaVersion: "mediflow.function-preferences-preview.v1", command: command, proposed: value, writesPerformed: 0)
        }, apply: { _, _ in applies += 1; return value }))
        model.load(); await settle(model)
        model.prepare(NativeAIFunctionCommand(snapshot: value, presetId: "all_off")); await settle(model)
        XCTAssertNotNil(model.preview)
        current = connection(generation: 2)
        model.confirm() // No view-driven invalidate has run yet.
        await settle(model)
        XCTAssertEqual(applies, 0); XCTAssertNil(model.preview); XCTAssertNil(model.snapshot)
    }

    func testGrantDeniedAndConflictClearSnapshotAndNeverAutoRetry() async throws {
        let value = try snapshot()
        for status in [403, 409] {
            var count = 0
            let model = NativeAIConfigurationModel(connectionProvider: { self.connection() }, services: .init(read: { _ in value }, preview: { _, _ in
                count += 1; throw HomeBaseClientError.httpStatus(status, nil)
            }, apply: { _, _ in XCTFail("No apply expected"); return value }))
            model.load(); await settle(model); model.prepare(NativeAIFunctionCommand(snapshot: value, presetId: "all_off")); await settle(model)
            XCTAssertNil(model.snapshot); XCTAssertNil(model.preview); XCTAssertEqual(count, 1)
        }
    }
}
