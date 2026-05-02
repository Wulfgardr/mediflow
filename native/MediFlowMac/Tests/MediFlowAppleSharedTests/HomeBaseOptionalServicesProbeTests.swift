// Codex: created 2026-05-02
// @Codex
import XCTest
@testable import MediFlowAppleShared

final class HomeBaseOptionalServicesProbeTests: XCTestCase {
    func testInitialSnapshotReportsOptionalServicesAsUnknownNotMissing() {
        let snapshot = HomeBaseOptionalServicesSnapshot.initial

        XCTAssertEqual(snapshot.services.map(\.id), ["optional-ollama", "optional-docker-icd"])
        XCTAssertTrue(snapshot.services.allSatisfy { $0.state == .unknown })
        XCTAssertFalse(snapshot.services.contains { $0.state == .missing })
    }

    func testReachableOptionalServicesUseReadyWithoutChangingIds() {
        let snapshot = HomeBaseOptionalServicesProbe.buildSnapshot(
            ollamaReachable: true,
            icdReachable: true
        )

        XCTAssertEqual(snapshot.services.map(\.id), ["optional-ollama", "optional-docker-icd"])
        XCTAssertTrue(snapshot.services.allSatisfy { $0.state == .ready })
        XCTAssertTrue(snapshot.services.contains { $0.title == "Ollama (AI locale)" })
        XCTAssertTrue(snapshot.services.contains { $0.title == "Docker / ICD (container)" })
    }

    func testUnreachableOptionalServicesRemainUnknownNotError() {
        let snapshot = HomeBaseOptionalServicesProbe.buildSnapshot(
            ollamaReachable: false,
            icdReachable: false
        )

        XCTAssertTrue(snapshot.services.allSatisfy { $0.state == .unknown })
        XCTAssertTrue(snapshot.services.contains { $0.detail.contains("11434 non rilevato") })
        XCTAssertTrue(snapshot.services.contains { $0.detail.contains("8888 non rilevato") })
        XCTAssertFalse(snapshot.services.contains { $0.state == .missing || $0.state == .mismatch })
    }
}
