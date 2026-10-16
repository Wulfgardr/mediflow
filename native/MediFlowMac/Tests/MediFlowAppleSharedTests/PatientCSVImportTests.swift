import XCTest
import CryptoKit
@testable import MediFlowAppleShared

final class PatientCSVImportTests: XCTestCase {
    private let header = PatientCSV.headers.joined(separator: ";") + "\n"
    private let first = "Ada;Sintetica;RSSMRA80A01H501U;2000-02-29;Via prova;123"
    private let second = "Eva;Inventata;BNCLCU85B41F205X;;;"

    func testWebFormatBOMQuotedSeparatorsEscapedQuotesAndPhysicalLines() throws {
        let csv = "\u{FEFF}" + header + "Ada;Sintetica;rssmra80a01h501u;2000-02-29;\"Via; \\\"prova\\\"\nseconda linea\";123"
        let repaired = csv.replacingOccurrences(of: "\\\"", with: "\"\"")
        let rows = try PatientCSV.parse(Data(repaired.utf8))
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].line, 2)
        XCTAssertEqual(rows[0].taxCode, "RSSMRA80A01H501U")
        XCTAssertEqual(rows[0].cells[4], "Via; \"prova\"\nseconda linea")
        XCTAssertTrue(rows[0].eligible)
    }

    func testInvalidDatesASCIIAndAllDuplicateOccurrencesAreExcluded() throws {
        let rows = try PatientCSV.parse(Data((header + first + "\n" + first.lowercased() + "\n" +
            "Ada;Sintetica;SSSSSSSSSSSSSSSß;1900-02-29;;").utf8))
        XCTAssertFalse(rows[0].eligible)
        XCTAssertFalse(rows[1].eligible)
        XCTAssertFalse(rows[2].eligible)
        XCTAssertNil(PatientCSV.normalizedTaxCode("SSSSSSSSSSSSSSSß"))
        XCTAssertNil(PatientCSV.birthDate("1900-02-29"))
        XCTAssertNotNil(PatientCSV.birthDate("2000-02-29"))
        XCTAssertNil(PatientCSV.birthDate("2026-02-30"))
    }

    func testMalformedEncodingHeaderQuotesAndLimitsFailClosed() throws {
        let invalid: [Data] = [Data([0xff]), Data(("\n" + header).utf8),
            Data((header + "\"unterminated").utf8), Data((header + first + ";extra").utf8),
            Data((header + "Ada;Sintetica;RSSMRA80A01H501U;;" + String(repeating: "a", count: 1025) + ";").utf8),
            Data(repeating: 65, count: PatientCSV.maximumBytes + 1),
            Data((header + Array(repeating: second, count: 501).joined(separator: "\n")).utf8)]
        for bytes in invalid { XCTAssertThrowsError(try PatientCSV.parse(bytes)) }
        let controls = try PatientCSV.parse(Data((header + "Ad\ta;Sintetica;RSSMRA80A01H501U;;;").utf8))
        XCTAssertFalse(controls[0].eligible)
    }

    func testRecordLimitHasIdenticalEOFAndCRLFTerminatorSemantics() throws {
        let record = (Array(repeating: String(repeating: "a", count: 683), count: 5) + [String(repeating: "a", count: 676)]).joined(separator: ";")
        XCTAssertEqual(record.utf16.count, 4096)
        for suffix in ["", "\n", "\r\n"] {
            let rows = try PatientCSV.parse(Data((header + record + suffix).utf8))
            XCTAssertEqual(rows.count, 1)
            XCTAssertEqual(rows[0].cells.count, 6)
            XCTAssertThrowsError(try PatientCSV.parse(Data((header + record + "a" + suffix).utf8)))
        }
    }

    @MainActor
    func testReviewRequiredExistingTombstoneAndFileDuplicatesNeverSend() async {
        var sent = 0
        let model = PatientCSVImportModel(destination: "Sintetico", isCurrent: { true }, read: {
            [self.summary("existing", "RSSMRA80A01H501U", deleted: true)]
        }, create: { _, id in sent += 1; return HomeBaseCreatedResource(id: id, version: 1) })
        await model.load(Data((header + first + "\n" + second).utf8))
        XCTAssertEqual(model.eligibleCount, 1)
        await model.confirm(reviewed: false)
        XCTAssertEqual(sent, 0)
        await model.confirm(reviewed: true)
        XCTAssertEqual(sent, 1)
        XCTAssertEqual(model.receipts.map(\.outcome), [.excluded, .confirmed])
        await model.confirm(reviewed: true)
        XCTAssertEqual(sent, 1)
    }

    @MainActor
    func testPreflightRechecksDuplicatesAndExpiryAfterRead() async {
        var reads = 0, sent = 0
        var time = Date(timeIntervalSince1970: 1000)
        let model = PatientCSVImportModel(destination: "Sintetico", isCurrent: { true }, read: {
            reads += 1
            if reads == 2 { return [self.summary("new", "RSSMRA80A01H501U")] }
            return []
        }, create: { _, id in sent += 1; return HomeBaseCreatedResource(id: id, version: 1) }, now: { time })
        await model.load(Data((header + first).utf8))
        await model.confirm(reviewed: true)
        XCTAssertEqual(sent, 0)
        XCTAssertEqual(model.receipts.first?.outcome, .excluded)
        let expiry = PatientCSVImportModel(destination: "Sintetico", isCurrent: { true }, read: { [] },
            create: { _, id in sent += 1; return HomeBaseCreatedResource(id: id, version: 1) }, now: { time })
        await expiry.load(Data((header + first).utf8))
        time.addTimeInterval(300)
        await expiry.confirm(reviewed: true)
        XCTAssertEqual(sent, 0)
    }

    @MainActor
    func testUncertainResponseStopsWithoutRetryAndReadOnlyReconciliation() async {
        var sent = 0
        var observed: [HomeBasePatientSummary] = []
        let model = PatientCSVImportModel(destination: "Sintetico", isCurrent: { true }, read: { observed },
            create: { row, id in
                sent += 1
                observed = [self.summary(id, row.taxCode!)]
                throw URLError(.networkConnectionLost)
            })
        await model.load(Data((header + first + "\n" + second).utf8))
        await model.confirm(reviewed: true)
        XCTAssertEqual(sent, 1)
        XCTAssertEqual(model.receipts.map(\.outcome), [.unknown, .notSent])
        XCTAssertFalse(model.canReadFile)
        await model.load(Data((header + first).utf8))
        await model.confirm(reviewed: true)
        XCTAssertEqual(sent, 1)
        await model.reconcile()
        XCTAssertEqual(sent, 1)
        XCTAssertEqual(model.receipts.map(\.outcome), [.observed, .notSent])
    }

    @MainActor
    func testMissingReadOnlyResultDoesNotProveRollback() async {
        let model = PatientCSVImportModel(destination: "Sintetico", isCurrent: { true }, read: { [] },
            create: { _, _ in throw URLError(.timedOut) })
        await model.load(Data((header + first).utf8))
        await model.confirm(reviewed: true)
        await model.reconcile()
        XCTAssertTrue(model.hasUncertainResult)
    }

    @MainActor
    func testCancelWhileRowIsInFlightPreservesConfirmedAndStopsNextRow() async {
        let gate = CSVGate()
        var sent = 0
        let model = PatientCSVImportModel(destination: "Sintetico", isCurrent: { true }, read: { [] },
            create: { _, id in sent += 1; await gate.pause(); return HomeBaseCreatedResource(id: id, version: 1) })
        await model.load(Data((header + first + "\n" + second).utf8))
        let operation = Task { await model.confirm(reviewed: true) }
        await gate.waitUntilPaused()
        model.cancel()
        XCTAssertTrue(model.busy)
        await gate.release()
        await operation.value
        XCTAssertEqual(sent, 1)
        XCTAssertEqual(model.receipts.map(\.outcome), [.confirmed, .notSent])
        XCTAssertTrue(model.notice?.contains("parziale") == true)
    }

    @MainActor
    func testContextChangeBeforeSendAndDuringInFlightCannotSendSubsequentRows() async {
        var current = true, sent = 0
        let model = PatientCSVImportModel(destination: "Sintetico", isCurrent: { current }, read: { [] },
            create: { _, id in sent += 1; current = false; return HomeBaseCreatedResource(id: id, version: 1) })
        await model.load(Data((header + first + "\n" + second).utf8))
        await model.confirm(reviewed: true)
        XCTAssertEqual(sent, 1)
        XCTAssertEqual(model.receipts.map(\.outcome), [.confirmed, .notSent])
        let blocked = PatientCSVImportModel(destination: "Sintetico", isCurrent: { current }, read: { [] },
            create: { _, id in sent += 1; return HomeBaseCreatedResource(id: id, version: 1) })
        await blocked.load(Data((header + first).utf8))
        await blocked.confirm(reviewed: true)
        XCTAssertEqual(sent, 1)
    }

    func testOptionalDTOFieldsBindUUIDAndDestinationAndKeepManualCreateCompatible() throws {
        let manual = HomeBasePatientCreatePayload(firstName: "Ada", lastName: "Sintetica", taxCode: "RSSMRA80A01H501U")
        let pinned = HomeBasePatientCreatePayload(id: "synthetic-id", ambulatoryId: "synthetic-scope", firstName: "Ada", lastName: "Sintetica", taxCode: "RSSMRA80A01H501U")
        let encoder = JSONEncoder()
        let manualJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: encoder.encode(manual)) as? [String: Any])
        let pinnedJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: encoder.encode(pinned)) as? [String: Any])
        XCTAssertNil(manualJSON["id"])
        XCTAssertNil(manualJSON["ambulatoryId"])
        XCTAssertEqual(pinnedJSON["id"] as? String, "synthetic-id")
        XCTAssertEqual(pinnedJSON["ambulatoryId"] as? String, "synthetic-scope")
        XCTAssertNil(pinnedJSON["isArchived"])
    }

    @MainActor
    func testWorkspaceFactorySealsFieldsPinsScopeAndRevokesOnLockOrScopeChange() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("PatientCSV-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let suite = "PatientCSV.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = HomeBasePairedStore(userDefaults: defaults, keychainReader: { _, _ in .success(nil) },
            keychainWriter: { _, _, _ in .success(()) }, keychainDeleter: { _, _ in .success(()) })
        let cache = HomeBasePatientCacheStore(cacheDirectory: directory,
            keyProvider: { SymmetricKey(data: Data(repeating: 8, count: 32)) })
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CSVURLProtocol.self]
        let client = HomeBasePatientsClient(configuration: HomeBaseConnectionConfiguration(serverURLString: "https://localhost:3443"),
            session: URLSession(configuration: configuration))
        let key = SymmetricKey(data: Data(repeating: 7, count: 32))
        var stored: [HomeBasePatientSummary] = [summary("existing", "EXSTNG00A01H501Z")]
        var creates = 0, refreshes = 0
        CSVURLProtocol.configure { request in
            if request.url?.path == "/api/auth/native/logout" { return Data("{\"success\":true}".utf8) }
            XCTAssertEqual(request.url?.path, "/api/v1/network/patients")
            XCTAssertTrue(request.value(forHTTPHeaderField: "Cookie")?.contains("ambulatory_id=synthetic-scope") == true)
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "test-client")
            if request.httpMethod == "POST" {
                creates += 1
                let data = try Self.body(request)
                let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
                let id = try XCTUnwrap(json["id"] as? String)
                XCTAssertNotNil(UUID(uuidString: id))
                XCTAssertEqual(json["ambulatoryId"] as? String, "synthetic-scope")
                XCTAssertEqual(json["birthDate"] as? String, "2000-02-29T00:00:00Z")
                let address = try XCTUnwrap(json["address"] as? String)
                let phone = try XCTUnwrap(json["phone"] as? String)
                XCTAssertTrue(address.hasPrefix("ENC:"))
                XCTAssertTrue(phone.hasPrefix("ENC:"))
                let addressJSON = try XCTUnwrap(CryptoService.decryptField(address, masterKey: key))
                let phoneJSON = try XCTUnwrap(CryptoService.decryptField(phone, masterKey: key))
                XCTAssertEqual(try JSONDecoder().decode(String.self, from: Data(addressJSON.utf8)), "Via prova")
                XCTAssertEqual(try JSONDecoder().decode(String.self, from: Data(phoneJSON.utf8)), "123")
                stored.append(self.summary(id, json["taxCode"] as! String))
                return Data("{\"id\":\"\(id)\",\"version\":1}".utf8)
            }
            if request.url?.query == "include=diagnoses" { refreshes += 1 }
            else {
                XCTAssertEqual(request.url?.query, "includeDeleted=true")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Cache-Control"), "no-store")
            }
            return try JSONEncoder().encode(stored)
        }
        defer { CSVURLProtocol.configure(nil) }
        let workspace = PairedPatientsWorkspaceModel(pairedStore: store, cacheStore: cache, dataSourceFactory: { _ in client })
        workspace.ambulatoryId = "synthetic-scope"
        workspace.configurePairedOnlineForTests(masterKey: key)
        workspace.preparePatientCSVImport()
        let csv = try XCTUnwrap(workspace.patientCSVImport)
        await csv.load(Data((header + first).utf8))
        await csv.confirm(reviewed: true)
        XCTAssertEqual(csv.receipts.first?.outcome, .confirmed)
        XCTAssertEqual(workspace.patients.map(\.id), stored.map(\.id))
        XCTAssertEqual(workspace.patients.count, 2)
        XCTAssertTrue(csv.contextAvailable)
        XCTAssertEqual(refreshes, 1)
        await csv.confirm(reviewed: true)
        XCTAssertEqual(creates, 1)
        XCTAssertEqual(refreshes, 1)
        workspace.resetPatientCSVImport()
        let next = try XCTUnwrap(workspace.patientCSVImport)
        await next.load(Data((header + second).utf8))
        XCTAssertTrue(next.canConfirm)
        workspace.ambulatoryId = "other-scope"
        XCTAssertFalse(next.canConfirm)
        XCTAssertTrue(next.rows.isEmpty)
        XCTAssertFalse(next.contextAvailable)
        workspace.resetPatientCSVImport()
        let changed = try XCTUnwrap(workspace.patientCSVImport)
        await workspace.lockSessionNow()
        XCTAssertFalse(changed.contextAvailable)
        XCTAssertFalse(workspace.canStartPatientCSVImport)
    }

    @MainActor
    func testWorkspaceRefreshesTwoConfirmedRowsAndExcludesExistingTombstoneWithoutResending() async throws {
        let workspace = makeWorkspace()
        let existing = summary("existing", "EXSTNG00A01H501Z", deleted: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        var stored = [existing]
        var creates = 0, refreshes = 0
        CSVURLProtocol.configure { request in
            XCTAssertEqual(request.url?.path, "/api/v1/network/patients")
            if request.httpMethod == "POST" {
                creates += 1
                let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: Self.body(request)) as? [String: Any])
                let id = try XCTUnwrap(payload["id"] as? String)
                stored.append(self.summary(id, try XCTUnwrap(payload["taxCode"] as? String)))
                return Data("{\"id\":\"\(id)\",\"version\":1}".utf8)
            }
            if request.url?.query == "include=diagnoses" {
                refreshes += 1
                return try encoder.encode(stored.filter { $0.deletedAt == nil })
            }
            XCTAssertEqual(request.url?.query, "includeDeleted=true")
            return try encoder.encode(stored)
        }
        defer { CSVURLProtocol.configure(nil) }
        workspace.preparePatientCSVImport()
        let csv = try XCTUnwrap(workspace.patientCSVImport)
        await csv.load(Data((header + first + "\n" + second + "\nAlfa;Esistente;EXSTNG00A01H501Z;;;").utf8))
        XCTAssertEqual(csv.eligibleCount, 2)
        await csv.confirm(reviewed: false)
        XCTAssertEqual(creates, 0)
        XCTAssertEqual(refreshes, 0)
        await csv.confirm(reviewed: true)
        XCTAssertEqual(csv.receipts.map(\.outcome), [.confirmed, .confirmed, .excluded])
        XCTAssertEqual(Set(workspace.patients.map(\.id)), Set(stored.dropFirst().map(\.id)))
        XCTAssertEqual(refreshes, 1)
        await csv.confirm(reviewed: true)
        XCTAssertEqual(creates, 2)
        XCTAssertEqual(refreshes, 1)
    }

    @MainActor
    func testWorkspaceRefreshDoesNotResolveUncertainWriteOrRepeatIt() async throws {
        let workspace = makeWorkspace()
        var stored: [HomeBasePatientSummary] = []
        var creates = 0, refreshes = 0
        CSVURLProtocol.configure { request in
            if request.httpMethod == "POST" {
                creates += 1
                let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: Self.body(request)) as? [String: Any])
                stored.append(self.summary(try XCTUnwrap(payload["id"] as? String), try XCTUnwrap(payload["taxCode"] as? String)))
                throw URLError(.networkConnectionLost)
            }
            if request.url?.query == "include=diagnoses" { refreshes += 1 }
            return try JSONEncoder().encode(stored)
        }
        defer { CSVURLProtocol.configure(nil) }
        workspace.preparePatientCSVImport()
        let csv = try XCTUnwrap(workspace.patientCSVImport)
        await csv.load(Data((header + first + "\n" + second).utf8))
        await csv.confirm(reviewed: true)
        XCTAssertEqual(creates, 1)
        XCTAssertEqual(refreshes, 1)
        XCTAssertEqual(workspace.patients.map(\.id), stored.map(\.id))
        XCTAssertEqual(csv.receipts.map(\.outcome), [.unknown, .notSent])
        XCTAssertTrue(csv.contextAvailable)
        await csv.confirm(reviewed: true)
        await csv.reconcile()
        XCTAssertEqual(creates, 1)
        XCTAssertEqual(csv.receipts.map(\.outcome), [.observed, .notSent])
    }

    @MainActor
    func testRefreshRevocationLocksSessionWithoutLosingConfirmedReceiptOrResending() async throws {
        let workspace = makeWorkspace()
        var creates = 0
        CSVURLProtocol.configure { request in
            if request.httpMethod == "POST" {
                creates += 1
                let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: Self.body(request)) as? [String: Any])
                return Data("{\"id\":\"\(try XCTUnwrap(payload["id"] as? String))\",\"version\":1}".utf8)
            }
            if request.url?.query == "include=diagnoses" { throw CSVResponseFailure(status: 401) }
            return Data("[]".utf8)
        }
        defer { CSVURLProtocol.configure(nil) }
        workspace.preparePatientCSVImport()
        let csv = try XCTUnwrap(workspace.patientCSVImport)
        await csv.load(Data((header + first).utf8))
        await csv.confirm(reviewed: true)
        XCTAssertEqual(csv.receipts.map(\.outcome), [.confirmed])
        XCTAssertNil(workspace.clinicalWorkspaceConnection)
        XCTAssertFalse(csv.contextAvailable)
        XCTAssertFalse(workspace.canStartPatientCSVImport)
        await csv.confirm(reviewed: true)
        XCTAssertEqual(creates, 1)
    }

    @MainActor
    func testLateCSVRefreshCannotPublishAfterScopeChangesAndReturns() async throws {
        let gate = CSVGate()
        let workspace = makeWorkspace()
        CSVURLProtocol.configure { request in
            if request.httpMethod == "POST" {
                let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: Self.body(request)) as? [String: Any])
                return Data("{\"id\":\"\(try XCTUnwrap(payload["id"] as? String))\",\"version\":1}".utf8)
            }
            if request.url?.query == "include=diagnoses" {
                await gate.pause()
                return try JSONEncoder().encode([self.summary("late-patient", "RSSMRA80A01H501U")])
            }
            return Data("[]".utf8)
        }
        defer { CSVURLProtocol.configure(nil) }
        workspace.preparePatientCSVImport()
        let csv = try XCTUnwrap(workspace.patientCSVImport)
        await csv.load(Data((header + first).utf8))
        let operation = Task { await csv.confirm(reviewed: true) }
        await gate.waitUntilPaused()
        workspace.ambulatoryId = "other-scope"
        workspace.ambulatoryId = "synthetic-scope"
        await gate.release()
        await operation.value
        XCTAssertTrue(workspace.patients.isEmpty)
        XCTAssertFalse(csv.contextAvailable)
        XCTAssertEqual(csv.receipts.map(\.outcome), [.confirmed])
    }

    @MainActor
    private func makeWorkspace() -> PairedPatientsWorkspaceModel {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("PatientCSV-\(UUID())")
        let suite = "PatientCSV.\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        let store = HomeBasePairedStore(userDefaults: defaults, keychainReader: { _, _ in .success(nil) },
            keychainWriter: { _, _, _ in .success(()) }, keychainDeleter: { _, _ in .success(()) })
        let cache = HomeBasePatientCacheStore(cacheDirectory: directory,
            keyProvider: { SymmetricKey(data: Data(repeating: 8, count: 32)) })
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CSVURLProtocol.self]
        let session = URLSession(configuration: configuration)
        addTeardownBlock {
            session.invalidateAndCancel()
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        let client = HomeBasePatientsClient(configuration: HomeBaseConnectionConfiguration(serverURLString: "https://localhost:3443"),
            session: session)
        let workspace = PairedPatientsWorkspaceModel(pairedStore: store, cacheStore: cache, dataSourceFactory: { _ in client })
        workspace.ambulatoryId = "synthetic-scope"
        workspace.configurePairedOnlineForTests(masterKey: SymmetricKey(data: Data(repeating: 7, count: 32)))
        return workspace
    }

    private static func body(_ request: URLRequest) throws -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { throw URLError(.cannotDecodeRawData) }
        stream.open()
        defer { stream.close() }
        var result = Data()
        var buffer = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count >= 0 else { throw URLError(.cannotDecodeRawData) }
            if count == 0 { break }
            result.append(contentsOf: buffer.prefix(count))
        }
        return result
    }

    private func summary(_ id: String, _ code: String, deleted: Bool = false) -> HomeBasePatientSummary {
        HomeBasePatientSummary(id: id, firstName: "Ada", lastName: "Sintetica", birthDate: nil,
            taxCode: code, isAdi: false, isArchived: false, version: 1, updatedAt: nil,
            deletedAt: deleted ? Date() : nil)
    }
}

private actor CSVGate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var entered = false
    func pause() async { entered = true; await withCheckedContinuation { continuation = $0 } }
    func waitUntilPaused() async { while !entered { await Task.yield() } }
    func release() { continuation?.resume(); continuation = nil }
}

private struct CSVResponseFailure: Error {
    let status: Int
}

private final class CSVURLProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var handler: ((URLRequest) async throws -> Data)?
    private var operation: Task<Void, Never>?
    static func configure(_ value: ((URLRequest) async throws -> Data)?) {
        lock.lock(); defer { lock.unlock() }; handler = value
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); let handler = Self.handler; Self.lock.unlock()
        operation = Task {
            do {
                guard let handler else { throw URLError(.badServerResponse) }
                let data = try await handler(request)
                respond(data: data, status: request.httpMethod == "POST" ? 201 : 200)
            } catch let failure as CSVResponseFailure {
                respond(data: Data("{}".utf8), status: failure.status)
            } catch { client?.urlProtocol(self, didFailWithError: error) }
        }
    }
    override func stopLoading() { operation?.cancel() }

    private func respond(data: Data, status: Int) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status,
            httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}
