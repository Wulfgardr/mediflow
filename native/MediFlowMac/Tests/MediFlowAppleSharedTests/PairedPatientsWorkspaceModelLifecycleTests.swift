import CryptoKit
import XCTest
@testable import MediFlowAppleShared

/* @Codex */
final class PairedPatientsWorkspaceModelLifecycleTests: XCTestCase {
    private let masterKey = SymmetricKey(data: Data(repeating: 7, count: 32))

    private struct CryptoFixture: Decodable {
        struct Inputs: Decodable {
            let pin: String
            let saltHex: String
            let rawMasterKeyHex: String
        }

        struct Vectors: Decodable {
            let wrappedMasterKeyB64: String
            let wrappedMasterKeyVersioned: String?
        }

        let version: Int
        let inputs: Inputs
        let vectors: Vectors
    }

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

    /* @Codex */
    func testLockedPatientFieldsStayEmptyAndAreOmittedFromUpdate() async throws {
        let locked = try XCTUnwrap(CryptoService.encryptField(
            CryptoService.jsonEncode("dato protetto")!, masterKey: SymmetricKey(size: .bits256)))
        let remote = detail(id: "p1", archived: false, version: 1, encryptedValue: locked)
        let source = LifecycleMockDataSource(details: ["p1": remote])
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey)

        await model.loadPatient(summary(id: "p1", archived: false, version: 1))
        await model.startEditingPatient()

        let expected: Set<PairedPatientsWorkspaceModel.EncryptedPatientField> = [
            .address, .phone, .caregiver, .notes, .diagnoses, .exemptions,
        ]
        let lockedFields = await model.lockedPatientFields
        XCTAssertEqual(lockedFields, expected)
        let address = await model.editPatientAddress
        XCTAssertTrue(address.isEmpty)

        await model.savePatient()
        let capturedUpdate = await source.lastUpdate
        let payload = try XCTUnwrap(capturedUpdate?.payload)
        for field in [payload.address, payload.phone, payload.caregiver, payload.notes, payload.diagnoses, payload.exemptions] {
            guard case .omit = field else { return XCTFail("every locked encrypted field must be omitted") }
        }
    }

    func testOlderPatientLoadCannotReplaceNewerSelection() async {
        let gate = LifecycleLoadGate(["patient:1"])
        let source = LifecycleMockDataSource(details: ["a": detail(id: "a", archived: false, version: 1), "b": detail(id: "b", archived: false, version: 1)], loadGate: gate)
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests()
        let older = Task { await model.loadPatient(summary(id: "a", archived: false, version: 1)) }
        await gate.wait(for: "patient:1")
        await model.loadPatient(summary(id: "b", archived: false, version: 1))
        await gate.release("patient:1"); await older.value
        let state = await MainActor.run { (model.selectedPatientID, model.selectedPatient?.id, model.isWorking) }
        XCTAssertEqual(state.0, "b"); XCTAssertEqual(state.1, "b"); XCTAssertFalse(state.2)
    }

    func testStaleFailureCannotFinishNewerLoadAndContextDriftClosesItsOwner() async {
        let gate = LifecycleLoadGate(["patient:1", "patient:2"])
        let source = LifecycleMockDataSource(details: ["b": detail(id: "b", archived: false, version: 1)], loadGate: gate)
        let model = await makeModel(source: source); await model.configurePairedOnlineForTests()
        let stale = Task { await model.loadPatient(summary(id: "a", archived: false, version: 1)) }
        await gate.wait(for: "patient:1")
        let current = Task { await model.loadPatient(summary(id: "b", archived: false, version: 1)) }
        await gate.wait(for: "patient:2"); await gate.release("patient:1"); await stale.value
        let during = await MainActor.run { (model.selectedPatientID, model.isWorking, model.errorMessage, model.statusMessage) }
        XCTAssertEqual(during.0, "b"); XCTAssertTrue(during.1); XCTAssertNil(during.2); XCTAssertNil(during.3)
        await model.configurePairedOnlineForTests(credentials: .init(clientId: "other", clientToken: "other"))
        await gate.release("patient:2"); await current.value
        let after = await MainActor.run { (model.selectedPatient, model.isWorking, model.errorMessage) }
        XCTAssertNil(after.0); XCTAssertFalse(after.1); XCTAssertNil(after.2)
    }

    func testSamePatientLatestRequestTokenWins() async {
        let gate = LifecycleLoadGate(["patient:1", "patient:2"])
        let source = LifecycleMockDataSource(details: ["p": detail(id: "p", archived: false, version: 1)], loadGate: gate)
        let model = await makeModel(source: source); await model.configurePairedOnlineForTests()
        let first = Task { await model.loadPatient(summary(id: "p", archived: false, version: 1)) }
        await gate.wait(for: "patient:1"); await source.setDetail(detail(id: "p", archived: false, version: 2))
        let second = Task { await model.loadPatient(summary(id: "p", archived: false, version: 2)) }
        await gate.wait(for: "patient:2"); await gate.release("patient:2"); await second.value
        await gate.release("patient:1"); await first.value
        let state = await MainActor.run { (model.selectedPatient?.version, model.isWorking) }
        XCTAssertEqual(state.0, 2); XCTAssertFalse(state.1)
    }

    func testPatientWorkspacePublishesAtomicallyWithCapturedKeyAndClearsOnChildFailure() async throws {
        let sealed = try XCTUnwrap(CryptoService.encryptField(CryptoService.jsonEncode("Nota B")!, masterKey: masterKey))
        let entry = HomeBaseEntrySummary(id: "e", patientId: "b", type: "note", title: sealed, date: .distantPast, content: sealed, setting: nil, metadata: nil, attachments: nil, deletedAt: nil, deletionReason: nil, version: 1, createdAt: nil, updatedAt: nil)
        let gate = LifecycleLoadGate(["prosthetic:b"])
        let source = LifecycleMockDataSource(details: ["b": detail(id: "b", archived: false, version: 1), "c": detail(id: "c", archived: false, version: 1)], loadGate: gate, entriesByPatient: ["b": [entry]], entryErrorsByPatient: ["c": .httpStatus(500, "child failed")])
        let model = await makeModel(source: source); await model.configurePairedOnlineForTests(masterKey: masterKey)
        let load = Task { await model.loadPatient(summary(id: "b", archived: false, version: 1)) }
        await gate.wait(for: "prosthetic:b")
        let pending = await MainActor.run { (model.selectedPatientID, model.selectedPatient, model.entries, model.isWorking) }
        XCTAssertEqual(pending.0, "b"); XCTAssertNil(pending.1); XCTAssertTrue(pending.2.isEmpty); XCTAssertTrue(pending.3)
        await model.configurePairedOnlineForTests(masterKey: SymmetricKey(data: Data(repeating: 9, count: 32)))
        await gate.release("prosthetic:b"); await load.value
        let loaded = await MainActor.run { (model.selectedPatient?.id, model.entries.first?.title) }
        XCTAssertEqual(loaded.0, "b"); XCTAssertEqual(loaded.1, "Nota B")
        await model.loadPatient(summary(id: "c", archived: false, version: 1))
        let failed = await MainActor.run { (model.selectedPatientID, model.selectedPatient, model.entries, model.errorMessage, model.isWorking) }
        XCTAssertEqual(failed.0, "c"); XCTAssertNil(failed.1); XCTAssertTrue(failed.2.isEmpty)
        XCTAssertTrue(failed.3?.contains("child failed") == true); XCTAssertFalse(failed.4)
    }

    func testLockInvalidatesPatientLoadBeforeRemoteLogoutCompletes() async {
        let gate = LifecycleLoadGate(["patient:1", "logout"])
        let source = LifecycleMockDataSource(
            details: ["a": detail(id: "a", archived: false, version: 1)], loadGate: gate)
        let model = await makeModel(source: source); await model.configurePairedOnlineForTests()
        let load = Task { await model.loadPatient(summary(id: "a", archived: false, version: 1)) }
        await gate.wait(for: "patient:1")
        let lock = Task { await model.lockSessionNow() }
        await gate.wait(for: "logout")
        await gate.release("patient:1"); await load.value
        let duringLock = await MainActor.run {
            (model.selectedPatient, model.isWorking, model.canChangePatientSelection)
        }
        XCTAssertNil(duringLock.0); XCTAssertTrue(duringLock.1); XCTAssertFalse(duringLock.2)
        await gate.release("logout"); await lock.value
        let locked = await MainActor.run {
            (model.selectedPatient, model.connectionState, model.isWorking, model.canChangePatientSelection)
        }
        XCTAssertNil(locked.0); XCTAssertEqual(locked.1, .sessionExpired)
        XCTAssertFalse(locked.2); XCTAssertTrue(locked.3)
    }

    func testScopeRoundTripInvalidatesCapturedPatientLoad() async {
        let gate = LifecycleLoadGate(["patient:1"])
        let source = LifecycleMockDataSource(
            details: ["a": detail(id: "a", archived: false, version: 1)], loadGate: gate)
        let model = await makeModel(source: source); await model.configurePairedOnlineForTests()
        await MainActor.run { model.ambulatoryId = "AMB-A" }
        let load = Task { await model.loadPatient(summary(id: "a", archived: false, version: 1)) }
        await gate.wait(for: "patient:1")
        await MainActor.run { model.ambulatoryId = "AMB-B"; model.ambulatoryId = "AMB-A" }
        let invalidated = await MainActor.run {
            (model.selectedPatientID, model.selectedPatient, model.isWorking, model.canChangePatientSelection)
        }
        XCTAssertNil(invalidated.0); XCTAssertNil(invalidated.1)
        XCTAssertFalse(invalidated.2); XCTAssertTrue(invalidated.3)
        await gate.release("patient:1"); await load.value
        let state = await MainActor.run {
            (model.selectedPatientID, model.selectedPatient, model.isWorking, model.canChangePatientSelection)
        }
        XCTAssertNil(state.0); XCTAssertNil(state.1); XCTAssertFalse(state.2); XCTAssertTrue(state.3)
    }

    func testOverlappingExclusiveTasksKeepSelectionDisabledUntilLastOwnerFinishes() async {
        let gate = LifecycleLoadGate(["pin:1", "pin:2"])
        let initial = detail(id: "a", archived: false, version: 1)
        let source = LifecycleMockDataSource(details: ["a": initial, "b": detail(id: "b", archived: false, version: 1)], loadGate: gate)
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: initial)
        let first = Task { await model.changePin(currentPin: "1357", newPin: "2468") }
        await gate.wait(for: "pin:1")
        let second = Task { await model.changePin(currentPin: "1357", newPin: "8642") }
        await gate.wait(for: "pin:2")
        await model.loadPatient(summary(id: "b", archived: false, version: 1))
        let overlapping = await MainActor.run {
            (model.selectedPatientID, model.isWorking, model.canChangePatientSelection)
        }
        XCTAssertEqual(overlapping.0, "a"); XCTAssertTrue(overlapping.1); XCTAssertFalse(overlapping.2)
        await gate.release("pin:1"); await first.value
        let oneOwner = await MainActor.run { (model.isWorking, model.canChangePatientSelection) }
        XCTAssertTrue(oneOwner.0); XCTAssertFalse(oneOwner.1)
        await gate.release("pin:2"); await second.value
        let finished = await MainActor.run { (model.isWorking, model.canChangePatientSelection) }
        XCTAssertFalse(finished.0); XCTAssertTrue(finished.1)
    }

    func testRevisionSupersededBySelectionLeavesFingerprintRetryable() async {
        let oldA = detail(id: "a", archived: false, version: 1)
        let newA = detail(id: "a", archived: false, version: 2)
        let b = detail(id: "b", archived: false, version: 1)
        let gate = LifecycleLoadGate(["revision:2"])
        let source = LifecycleMockDataSource(
            summaries: [summary(id: "a", archived: false, version: 2), summary(id: "b", archived: false, version: 1)],
            details: ["a": newA, "b": b], loadGate: gate,
            revisions: [revision("stable"), revision("changed"), revision("changed")])
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(
            patients: [summary(id: "a", archived: false, version: 1), summary(id: "b", archived: false, version: 1)],
            selectedPatient: oldA)
        await model.checkNetworkRevisionOnForeground()
        let stale = Task { await model.checkNetworkRevisionOnForeground() }
        await gate.wait(for: "revision:2"); await model.loadPatient(summary(id: "b", archived: false, version: 1))
        await gate.release("revision:2"); await stale.value
        var state = await MainActor.run { (model.patients.first?.version, model.selectedPatient?.id, model.statusMessage) }
        XCTAssertEqual(state.0, 1); XCTAssertEqual(state.1, "b"); XCTAssertEqual(state.2, "Dettaglio Rossi aperto.")
        await model.checkNetworkRevisionOnForeground()
        state = await MainActor.run { (model.patients.first?.version, model.selectedPatient?.id, model.statusMessage) }
        XCTAssertEqual(state.0, 2); XCTAssertEqual(state.1, "b"); XCTAssertEqual(state.2, "Home-base aggiornato, dati ricaricati.")
    }

    /* @Codex */
    func testForegroundRevisionDoesNotSupersedeActivePatientLoad() async {
        let b = detail(id: "b", archived: false, version: 1)
        let gate = LifecycleLoadGate(["patient:1"])
        let source = LifecycleMockDataSource(details: ["b": b], loadGate: gate)
        let model = await makeModel(source: source); await model.configurePairedOnlineForTests()
        let load = Task { await model.loadPatient(summary(id: "b", archived: false, version: 1)) }
        await gate.wait(for: "patient:1"); await model.checkNetworkRevisionOnForeground()
        var state = await MainActor.run { (model.selectedPatientID, model.selectedPatient?.id, model.isWorking) }
        XCTAssertEqual(state.0, "b"); XCTAssertNil(state.1); XCTAssertTrue(state.2)
        await gate.release("patient:1"); await load.value
        state = await MainActor.run { (model.selectedPatientID, model.selectedPatient?.id, model.isWorking) }
        XCTAssertEqual(state.0, "b"); XCTAssertEqual(state.1, "b"); XCTAssertFalse(state.2)
    }

    func testRevisionPublishesListWorkspaceAndStatusAtomically() async {
        let oldA = detail(id: "a", archived: false, version: 1)
        let gate = LifecycleLoadGate(["prosthetic:a"])
        let source = LifecycleMockDataSource(
            summaries: [summary(id: "a", archived: false, version: 2)],
            details: ["a": detail(id: "a", archived: false, version: 2)], loadGate: gate,
            revisions: [revision("stable"), revision("changed")])
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(
            patients: [summary(id: "a", archived: false, version: 1)], selectedPatient: oldA)
        await model.checkNetworkRevisionOnForeground()
        let refresh = Task { await model.checkNetworkRevisionOnForeground() }
        await gate.wait(for: "prosthetic:a")
        var state = await MainActor.run { (model.patients.first?.version, model.selectedPatient?.version, model.statusMessage, model.isWorking) }
        XCTAssertEqual(state.0, 1); XCTAssertEqual(state.1, 1); XCTAssertNil(state.2); XCTAssertTrue(state.3)
        await gate.release("prosthetic:a"); await refresh.value
        state = await MainActor.run { (model.patients.first?.version, model.selectedPatient?.version, model.statusMessage, model.isWorking) }
        XCTAssertEqual(state.0, 2); XCTAssertEqual(state.1, 2)
        XCTAssertEqual(state.2, "Home-base aggiornato, dati ricaricati."); XCTAssertFalse(state.3)
    }

    func testReloadSupersededBySelectionCannotOverwriteNewerConflictState() async {
        let conflict = await PairedPatientsWorkspaceModel.uiTestSeededConflict()
        let a = detail(id: "a", archived: false, version: 1)
        let b = detail(id: "b", archived: false, version: 1)
        let gate = LifecycleLoadGate(["patient:1"])
        let source = LifecycleMockDataSource(
            details: ["a": a, "b": b], pinChangeError: .versionConflict(conflict), loadGate: gate)
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey, selectedPatient: a)
        let reload = Task { await model.reloadAfterConflict() }
        await gate.wait(for: "patient:1"); await model.loadPatient(summary(id: "b", archived: false, version: 1))
        await model.changePin(currentPin: "1357", newPin: "2468")
        await gate.release("patient:1"); await reload.value
        let state = await MainActor.run {
            (model.selectedPatient?.id, model.pendingConflict, model.statusMessage, model.errorMessage, model.isWorking)
        }
        XCTAssertEqual(state.0, "b"); XCTAssertEqual(state.1, conflict)
        XCTAssertEqual(state.2, HomeBaseClientError.versionConflict(conflict).localizedDescription)
        XCTAssertNil(state.3); XCTAssertFalse(state.4)
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

    func testUnlockVersionedV1GoldenFixtureRotatesToV2WithIdenticalMasterKeyBytes() async throws {
        try await assertGoldenFixtureUnlockAndRotation(version: 1)
    }

    func testUnlockVersionedV2GoldenFixtureRotatesWithIdenticalMasterKeyBytes() async throws {
        try await assertGoldenFixtureUnlockAndRotation(version: 2)
    }

    func testChangePinFailsClosedWithoutMasterKey() async {
        let source = LifecycleMockDataSource()
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: nil)

        await model.changePin(currentPin: "1357", newPin: "2468")

        let calls = await source.pinChangeCalls
        let errorMessage = await model.errorMessage
        XCTAssertTrue(calls.isEmpty)
        XCTAssertEqual(
            errorMessage,
            "Cifratura non disponibile: riaccedi con il PIN operatore prima di cambiarlo."
        )
    }

    func testChangePinSurfacesDedicatedConflictWithoutReplacingMasterKey() async throws {
        let source = LifecycleMockDataSource(
            pinChangeError: .pinChangeConflict(
                "Il PIN e stato modificato da un'altra sessione. Ricarica e riprova."))
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey)

        await model.changePin(currentPin: "1357", newPin: "2468")
        await model.changePin(currentPin: "1357", newPin: "8642")

        let calls = await source.pinChangeCalls
        let statusMessage = await model.statusMessage
        let errorMessage = await model.errorMessage
        XCTAssertEqual(calls.count, 2, "a conflict must not replace or discard the in-memory master key")
        XCTAssertEqual(statusMessage, "Il PIN e stato modificato da un'altra sessione. Ricarica e riprova.")
        XCTAssertNil(errorMessage)
    }

    func testChangePin401UsesExistingSessionExpiredFlow() async {
        let source = LifecycleMockDataSource(pinChangeError: .httpStatus(401, "PIN non valido"))
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey)

        await model.changePin(currentPin: "1357", newPin: "2468")

        let state = await model.connectionState
        let connection = await model.clinicalWorkspaceConnection
        XCTAssertEqual(state, .sessionExpired)
        XCTAssertNil(connection)
    }

    func testLockSessionNowClearsLocalSessionAndMasterKeyWhenLogoutFails() async {
        let source = LifecycleMockDataSource(logoutError: .transport(.timeout))
        let model = await makeModel(source: source)
        await model.configurePairedOnlineForTests(masterKey: masterKey)

        await model.lockSessionNow()
        await model.changePin(currentPin: "1357", newPin: "2468")

        let logoutCalls = await source.logoutCalls
        let pinChangeCalls = await source.pinChangeCalls
        let state = await model.connectionState
        let statusMessage = await model.statusMessage
        let errorMessage = await model.errorMessage
        XCTAssertEqual(logoutCalls, 1)
        XCTAssertTrue(pinChangeCalls.isEmpty)
        XCTAssertEqual(state, .sessionExpired)
        XCTAssertTrue(statusMessage?.contains("Logout remoto non confermato") == true)
        XCTAssertEqual(
            errorMessage,
            "Cifratura non disponibile: riaccedi con il PIN operatore prima di cambiarlo."
        )
    }

    func testChangePinDoesNotPersistToUserDefaultsOrPairedStore() async {
        let suiteName = "PairedPatientsWorkspaceModelLifecycleTests.persistence.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let keychainWrites = Counter()
        let pairedStore = HomeBasePairedStore(
            userDefaults: defaults,
            keychainReader: { _, _ in .success(nil) },
            keychainWriter: { _, _, _ in
                keychainWrites.value += 1
                return .success(())
            },
            keychainDeleter: { _, _ in .success(()) }
        )
        let source = LifecycleMockDataSource()
        let cacheStore = HomeBasePatientCacheStore(
            cacheDirectory: FileManager.default.temporaryDirectory
                .appendingPathComponent("PairedPatientsWorkspaceModelLifecycleTests-\(UUID().uuidString)"),
            keyProvider: { SymmetricKey(data: Data(repeating: 8, count: 32)) }
        )
        let model = await MainActor.run {
            PairedPatientsWorkspaceModel(
                pairedStore: pairedStore,
                cacheStore: cacheStore,
                dataSourceFactory: { _ in source }
            )
        }
        await model.configurePairedOnlineForTests(masterKey: masterKey)
        let defaultsBefore = defaults.persistentDomain(forName: suiteName) ?? [:]

        await model.changePin(currentPin: "1357", newPin: "2468")

        let defaultsAfter = defaults.persistentDomain(forName: suiteName) ?? [:]
        let persistedCalls = await source.pinChangeCalls
        XCTAssertEqual(defaultsAfter as NSDictionary, defaultsBefore as NSDictionary)
        XCTAssertEqual(keychainWrites.value, 0)
        XCTAssertEqual(persistedCalls.count, 1)
    }

    private func assertGoldenFixtureUnlockAndRotation(version: Int) async throws {
        let fixture = try loadCryptoFixture(version: version)
        let blob = version == 1
            ? fixture.vectors.wrappedMasterKeyB64
            : try XCTUnwrap(fixture.vectors.wrappedMasterKeyVersioned)
        let loginResult = HomeBaseLoginResult(
            sessionCookie: "sid=test",
            encryptedMasterKey: blob,
            salt: data(hex: fixture.inputs.saltHex).base64EncodedString()
        )
        let source = LifecycleMockDataSource(loginResult: loginResult)
        let model = await makeModel(source: source)
        await MainActor.run {
            model.username = "doctor"
            model.password = fixture.inputs.pin
            model.pairedClientId = "test-client"
            model.pairedClientToken = "test-token"
        }

        await model.login()
        await model.changePin(currentPin: fixture.inputs.pin, newPin: "2468")

        let pinChangeCalls = await source.pinChangeCalls
        let call = try XCTUnwrap(pinChangeCalls.last)
        let rotatedSalt = try XCTUnwrap(Data(base64Encoded: call.salt))
        let rotatedMasterKey = try XCTUnwrap(CryptoService.unwrapMasterKeyVersioned(
            blob: call.encryptedMasterKey,
            pin: call.newPin,
            salt: rotatedSalt
        ))
        let rotatedBytes = rotatedMasterKey.withUnsafeBytes { Data($0) }
        XCTAssertEqual(CryptoService.kdfVersion(of: call.encryptedMasterKey), CryptoService.currentKdfVersion)
        XCTAssertEqual(rotatedSalt.count, 16)
        XCTAssertEqual(rotatedBytes, data(hex: fixture.inputs.rawMasterKeyHex))

        if version == 1 {
            // The first call returned success. A second rotation proves the model
            // retained the same in-memory master key instead of re-deriving it.
            await model.changePin(currentPin: "2468", newPin: "8642")
            let callsAfterSuccess = await source.pinChangeCalls
            let secondCall = try XCTUnwrap(callsAfterSuccess.last)
            XCTAssertEqual(callsAfterSuccess.count, 2)
            let secondSalt = try XCTUnwrap(Data(base64Encoded: secondCall.salt))
            let secondMasterKey = try XCTUnwrap(CryptoService.unwrapMasterKeyVersioned(
                blob: secondCall.encryptedMasterKey,
                pin: secondCall.newPin,
                salt: secondSalt
            ))
            XCTAssertEqual(
                secondMasterKey.withUnsafeBytes { Data($0) },
                data(hex: fixture.inputs.rawMasterKeyHex)
            )
        }
    }

    private func loadCryptoFixture(version: Int) throws -> CryptoFixture {
        let nativeDirectory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let url = nativeDirectory
            .appendingPathComponent("contracts")
            .appendingPathComponent("crypto-golden-vectors.v\(version).json")
        return try JSONDecoder().decode(CryptoFixture.self, from: Data(contentsOf: url))
    }

    private func data(hex: String) -> Data {
        var result = Data(capacity: hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            result.append(UInt8(hex[index..<next], radix: 16)!)
            index = next
        }
        return result
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

    /* @Codex */
    private func detail(
        id: String,
        archived: Bool,
        version: Int,
        deleted: Bool = false,
        encryptedValue: String? = nil
    ) -> HomeBasePatientDetail {
        HomeBasePatientDetail(
            id: id,
            firstName: "Mario",
            lastName: "Rossi",
            birthDate: nil,
            taxCode: "RSSMRA80A01H501U",
            address: encryptedValue,
            phone: encryptedValue,
            caregiver: encryptedValue,
            exemptions: encryptedValue,
            diagnoses: encryptedValue,
            monitoringProfile: nil,
            statusReason: nil,
            notes: encryptedValue,
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

    private func revision(_ fingerprint: String) -> NetworkRevisionSummary {
        NetworkRevisionSummary(revision: fingerprint, sourceFingerprint: "src", fingerprint: fingerprint)
    }
}

private final class Counter {
    var value = 0
}

/* @Codex */
private actor LifecycleLoadGate {
    private let keys: Set<String>
    private var reached: Set<String> = []
    private var blocks: [String: CheckedContinuation<Void, Never>] = [:]
    private var waiters: [String: [CheckedContinuation<Void, Never>]] = [:]

    init(_ keys: Set<String>) { self.keys = keys }

    func pause(_ key: String) async {
        guard keys.contains(key) else { return }
        await withCheckedContinuation { continuation in
            blocks[key] = continuation
            reached.insert(key)
            waiters.removeValue(forKey: key)?.forEach { $0.resume() }
        }
    }

    func wait(for key: String) async {
        guard !reached.contains(key) else { return }
        await withCheckedContinuation { waiters[key, default: []].append($0) }
    }

    func release(_ key: String) { blocks.removeValue(forKey: key)?.resume() }
}

private actor LifecycleMockDataSource: HomeBasePatientsDataSource {
    struct PinChangeCall {
        let currentPin: String
        let newPin: String
        let encryptedMasterKey: String
        let salt: String
    }

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
    private let loadGate: LifecycleLoadGate?
    private let entriesByPatient: [String: [HomeBaseEntrySummary]]
    private let entryErrorsByPatient: [String: HomeBaseClientError]
    private let revisions: [NetworkRevisionSummary]
    private var patientFetchCount = 0
    private var revisionFetchCount = 0
    private let loginResult: HomeBaseLoginResult
    private let pinChangeError: HomeBaseClientError?
    private let logoutError: HomeBaseClientError?
    private(set) var lastUpdate: UpdateCall?
    private(set) var lastCreate: HomeBasePatientCreatePayload?
    private(set) var lastSoftDelete: DeleteCall?
    private(set) var lastRestore: RestoreCall?
    private(set) var softDeleteCalls = 0
    private(set) var pinChangeCalls: [PinChangeCall] = []
    private(set) var logoutCalls = 0

    init(
        summaries: [HomeBasePatientSummary] = [],
        details: [String: HomeBasePatientDetail] = [:],
        loginResult: HomeBaseLoginResult = HomeBaseLoginResult(
            sessionCookie: "sid=test", encryptedMasterKey: nil, salt: nil),
        pinChangeError: HomeBaseClientError? = nil,
        logoutError: HomeBaseClientError? = nil,
        loadGate: LifecycleLoadGate? = nil,
        entriesByPatient: [String: [HomeBaseEntrySummary]] = [:],
        entryErrorsByPatient: [String: HomeBaseClientError] = [:],
        revisions: [NetworkRevisionSummary] = [
            NetworkRevisionSummary(revision: "1", sourceFingerprint: "src", fingerprint: "stable")
        ]
    ) {
        self.summaries = summaries
        self.details = details
        self.loginResult = loginResult
        self.pinChangeError = pinChangeError
        self.logoutError = logoutError
        self.loadGate = loadGate
        self.entriesByPatient = entriesByPatient
        self.entryErrorsByPatient = entryErrorsByPatient
        self.revisions = revisions
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
        loginResult
    }

    func changePin(
        currentPin: String, newPin: String, encryptedMasterKey: String, salt: String,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseMutationAcknowledgement {
        pinChangeCalls.append(PinChangeCall(
            currentPin: currentPin,
            newPin: newPin,
            encryptedMasterKey: encryptedMasterKey,
            salt: salt
        ))
        await loadGate?.pause("pin:\(pinChangeCalls.count)")
        if let pinChangeError { throw pinChangeError }
        return HomeBaseMutationAcknowledgement(success: true)
    }

    func logout(
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseMutationAcknowledgement {
        logoutCalls += 1
        await loadGate?.pause("logout")
        if let logoutError { throw logoutError }
        return HomeBaseMutationAcknowledgement(success: true)
    }

    func updateProfile(
        userId: String, displayName: String, ambulatoryName: String,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseMutationAcknowledgement {
        HomeBaseMutationAcknowledgement(success: true)
    }

    func createAmbulatory(
        payload: HomeBaseAmbulatoryCreatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseAmbulatoryMutationResponse {
        HomeBaseAmbulatoryMutationResponse(success: true, id: payload.id ?? "amb", version: 1)
    }

    func updateAmbulatory(
        id: String, payload: HomeBaseAmbulatoryUpdatePayload,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseAmbulatoryMutationResponse {
        HomeBaseAmbulatoryMutationResponse(success: true, version: payload.expectedVersion + 1)
    }

    func deleteAmbulatory(
        id: String, expectedVersion: Int,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseAmbulatoryMutationResponse {
        HomeBaseAmbulatoryMutationResponse(success: true)
    }

    func clearAmbulatory(
        id: String, expectedVersion: Int,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseAmbulatoryMutationResponse {
        HomeBaseAmbulatoryMutationResponse(success: true, version: expectedVersion + 1)
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
        patientFetchCount += 1
        let detail = details[id]
        await loadGate?.pause("patient:\(patientFetchCount)")
        guard let detail else { throw HomeBaseClientError.httpStatus(404, "Not found") }
        return detail
    }

    func setDetail(_ detail: HomeBasePatientDetail) { details[detail.id] = detail }

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
        if let error = entryErrorsByPatient[patientId] { throw error }
        return entriesByPatient[patientId] ?? []
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
        throw HomeBaseClientError.contract
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
        await loadGate?.pause("prosthetic:\(patientId)")
        return []
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
        revisionFetchCount += 1
        await loadGate?.pause("revision:\(revisionFetchCount)")
        guard !revisions.isEmpty else { throw HomeBaseClientError.contract }
        return revisions[min(revisionFetchCount - 1, revisions.count - 1)]
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
