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

private final class Counter {
    var value = 0
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
        logoutError: HomeBaseClientError? = nil
    ) {
        self.summaries = summaries
        self.details = details
        self.loginResult = loginResult
        self.pinChangeError = pinChangeError
        self.logoutError = logoutError
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
        if let pinChangeError { throw pinChangeError }
        return HomeBaseMutationAcknowledgement(success: true)
    }

    func logout(
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseMutationAcknowledgement {
        logoutCalls += 1
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
