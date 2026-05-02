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
              "networkMode": "network-home-base"
            }
            """
        )
        try write("local-api-tls-proxy.pid", "12345")

        let snapshot = HomeBaseRuntimeStatusLoader.load(dataDirectory: temporaryDirectory)

        XCTAssertEqual(snapshot.baseURL, "https://localhost:3443/api/v1")
        XCTAssertEqual(snapshot.networkMode, "network-home-base")
        XCTAssertEqual(snapshot.generatedAt, "2026-05-02T11:20:00Z")
        XCTAssertTrue(snapshot.tokenPresent)
        XCTAssertTrue(snapshot.statusFilePresent)
        XCTAssertEqual(snapshot.tlsPinMatches, true)
        XCTAssertTrue(snapshot.components.contains { $0.id == "local-token" && $0.state == .ready })
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
