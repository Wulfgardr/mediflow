// Codex: created 2026-05-02
// @Codex
import XCTest
@testable import MediFlowAppleShared

final class HomeBaseRuntimeStatusTests: XCTestCase {
    private var temporaryDirectory: URL!

    override func setUpWithError() throws {
        temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("HomeBaseRuntimeStatusTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        if let temporaryDirectory {
            try? FileManager.default.removeItem(at: temporaryDirectory)
        }
        temporaryDirectory = nil
    }

    func testLoadReportsReadyRuntimeFilesWithoutExposingToken() throws {
        try write(
            "native-config.json",
            """
            {
              "baseURL": "https://localhost:3443/api/v1",
              "tlsPin": "AB:CD",
              "token": "secret-token"
            }
            """
        )
        try write(
            "runtime-status.json",
            """
            {
              "generatedAt": "2026-05-02T11:20:00Z",
              "baseURL": "https://localhost:3443/api/v1",
              "tlsPin": "abcd",
              "networkMode": "network-home-base",
              "port": 3443,
              "bindHost": "127.0.0.1",
              "httpTarget": "http://127.0.0.1:3000",
              "certPath": "/tmp/local-api.crt",
              "keyPath": "/tmp/local-api.key",
              "proxyPidPath": "\(temporaryDirectory.appendingPathComponent("local-api-tls-proxy.pid").path)"
            }
            """
        )
        try write("local-api-tls-proxy.pid", "12345")

        let snapshot = HomeBaseRuntimeStatusLoader.load(dataDirectory: temporaryDirectory)

        XCTAssertEqual(snapshot.baseURL, "https://localhost:3443/api/v1")
        XCTAssertEqual(snapshot.networkMode, "network-home-base")
        XCTAssertEqual(snapshot.generatedAt, "2026-05-02T11:20:00Z")
        XCTAssertEqual(snapshot.port, 3443)
        XCTAssertEqual(snapshot.bindHost, "127.0.0.1")
        XCTAssertEqual(snapshot.httpTarget, "http://127.0.0.1:3000")
        XCTAssertEqual(snapshot.certPath, "/tmp/local-api.crt")
        XCTAssertEqual(snapshot.keyPath, "/tmp/local-api.key")
        XCTAssertEqual(snapshot.proxyPidPath, temporaryDirectory.appendingPathComponent("local-api-tls-proxy.pid").path)
        XCTAssertTrue(snapshot.tokenPresent)
        XCTAssertTrue(snapshot.statusFilePresent)
        XCTAssertEqual(snapshot.tlsPinMatches, true)
        XCTAssertEqual(
            snapshot.summary,
            "Bootstrap locale registrato. Il bundle packaged può gestire WebRuntime e proxy TLS; i provider AI opzionali restano diagnostici."
        )
        XCTAssertTrue(snapshot.components.contains { $0.id == "local-token" && $0.state == .ready })
    }

    func testSupervisorStopHandlesMissingPidAsNoActiveProxy() async throws {
        let snapshot = HomeBaseRuntimeStatusLoader.load(dataDirectory: temporaryDirectory)
        let supervisor = await HomeBaseRuntimeSupervisor()

        await supervisor.stopProxy(snapshot: snapshot)

        let statusMessage = await supervisor.statusMessage
        XCTAssertEqual(statusMessage, "Nessun proxy TLS attivo registrato.")
    }

    func testLoadReportsMissingRuntimeStatusAsObservableGap() throws {
        let snapshot = HomeBaseRuntimeStatusLoader.load(dataDirectory: temporaryDirectory)

        XCTAssertNil(snapshot.baseURL)
        XCTAssertNil(snapshot.networkMode)
        XCTAssertFalse(snapshot.tokenPresent)
        XCTAssertFalse(snapshot.statusFilePresent)
        XCTAssertTrue(snapshot.summary.contains("Nessun bootstrap runtime"))
        XCTAssertTrue(snapshot.components.contains { $0.id == "native-config" && $0.state == .missing })
    }

    func testLoadDetectsPinMismatchBetweenConfigAndRuntimeStatus() throws {
        try write(
            "native-config.json",
            """
            {
              "baseURL": "https://localhost:3443/api/v1",
              "tlsPin": "aaaa",
              "token": ""
            }
            """
        )
        try write(
            "runtime-status.json",
            """
            {
              "generatedAt": "2026-05-02T11:20:00Z",
              "baseURL": "https://localhost:3443/api/v1",
              "tlsPin": "bbbb",
              "networkMode": "local-only"
            }
            """
        )

        let snapshot = HomeBaseRuntimeStatusLoader.load(dataDirectory: temporaryDirectory)

        XCTAssertEqual(snapshot.tlsPinMatches, false)
        XCTAssertTrue(snapshot.components.contains { $0.id == "tls-pin" && $0.state == .mismatch })
    }

    private func write(_ fileName: String, _ content: String) throws {
        try content.data(using: .utf8)?.write(to: temporaryDirectory.appendingPathComponent(fileName))
    }
}
