// Codex: created 2026-04-18
// @Codex
import Foundation
import XCTest
@testable import MediFlowAppleShared

final class HomeBaseBonjourDiscoveryTests: XCTestCase {
    func testMakeCandidateParsesBonjourMetadataAndNormalizesHost() {
        let txtRecord = NetService.data(fromTXTRecord: [
            HomeBaseBonjourService.txtKeyDisplay: Data("Studio Demo".utf8),
            HomeBaseBonjourService.txtKeyNode: Data("node-42".utf8),
            HomeBaseBonjourService.txtKeyProtocol: Data("1.10.0".utf8),
            HomeBaseBonjourService.txtKeyMode: Data("network-home-base".utf8),
            HomeBaseBonjourService.txtKeyPin: Data("abc123".utf8),
        ])

        let candidate = HomeBaseBonjourService.makeCandidate(
            serviceName: "MediFlow Smoke",
            hostName: "mediflow-smoke.local.",
            port: 3443,
            txtRecordData: txtRecord
        )

        XCTAssertEqual(
            candidate,
            HomeBaseDiscoveryCandidate(
                serviceName: "MediFlow Smoke",
                displayName: "Studio Demo",
                serverURLString: "https://mediflow-smoke.local:3443",
                tlsPin: "abc123",
                nodeId: "node-42",
                protocolVersion: "1.10.0",
                operatingMode: "network-home-base"
            )
        )
    }

    func testMakeCandidateFallsBackToServiceNameWithoutTxtDisplay() {
        let candidate = HomeBaseBonjourService.makeCandidate(
            serviceName: "MediFlow Home Base",
            hostName: "127.0.0.1",
            port: 3443,
            txtRecordData: nil
        )

        XCTAssertEqual(candidate?.displayName, "MediFlow Home Base")
        XCTAssertEqual(candidate?.serverURLString, "https://127.0.0.1:3443")
        XCTAssertNil(candidate?.tlsPin)
    }

    func testMakeCandidateRejectsMissingHostOrPort() {
        XCTAssertNil(
            HomeBaseBonjourService.makeCandidate(
                serviceName: "MediFlow",
                hostName: nil,
                port: 3443,
                txtRecordData: nil
            )
        )

        XCTAssertNil(
            HomeBaseBonjourService.makeCandidate(
                serviceName: "MediFlow",
                hostName: "localhost",
                port: 0,
                txtRecordData: nil
            )
        )
    }
}
