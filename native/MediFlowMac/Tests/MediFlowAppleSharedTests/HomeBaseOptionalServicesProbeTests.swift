// Codex: created 2026-05-02
// @Codex
import XCTest
@testable import MediFlowAppleShared

final class HomeBaseOptionalServicesProbeTests: XCTestCase {
    func testInitialSnapshotReportsOptionalServicesAsUnknownNotMissing() {
        let snapshot = HomeBaseOptionalServicesSnapshot.initial

        XCTAssertEqual(snapshot.services.map(\.id), ["optional-ollama", "optional-mlx"])
        XCTAssertTrue(snapshot.services.allSatisfy { $0.state == .unknown })
        XCTAssertFalse(snapshot.services.contains { $0.state == .missing })
    }

    func testReachableOptionalServicesUseReadyWithoutChangingIds() {
        let snapshot = HomeBaseOptionalServicesProbe.buildSnapshot(
            ollamaReachable: true,
            mlxReachable: true
        )

        XCTAssertEqual(snapshot.services.map(\.id), ["optional-ollama", "optional-mlx"])
        XCTAssertTrue(snapshot.services.allSatisfy { $0.state == .ready })
        XCTAssertTrue(snapshot.services.contains { $0.title == "Ollama (AI locale)" })
        XCTAssertTrue(snapshot.services.contains { $0.title == "MLX (AI benchmark locale)" })
        XCTAssertFalse(snapshot.services.contains { $0.title.localizedCaseInsensitiveContains("ICD") })
    }

    func testUnreachableOptionalServicesRemainUnknownNotError() {
        let snapshot = HomeBaseOptionalServicesProbe.buildSnapshot(
            ollamaReachable: false,
            mlxReachable: false
        )

        XCTAssertTrue(snapshot.services.allSatisfy { $0.state == .unknown })
        XCTAssertTrue(snapshot.services.contains { $0.detail.contains("11434 non rilevato") })
        XCTAssertTrue(snapshot.services.contains { $0.detail.contains("8080 non rilevato") })
        XCTAssertFalse(snapshot.services.contains { $0.detail.contains("8888") })
        XCTAssertFalse(snapshot.services.contains { $0.state == .missing || $0.state == .mismatch })
    }
}
