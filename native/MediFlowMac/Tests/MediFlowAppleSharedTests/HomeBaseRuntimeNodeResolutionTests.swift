import XCTest
@testable import MediFlowAppleShared

final class HomeBaseRuntimeNodeResolutionTests: XCTestCase {
    private var tempRoot: URL!

    override func setUpWithError() throws {
        tempRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("mediflow-node-resolve-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tempRoot, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tempRoot)
    }

    private func makeNode(version: String, relative: String) throws {
        let node = tempRoot.appendingPathComponent(version).appendingPathComponent(relative)
        try FileManager.default.createDirectory(
            at: node.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        FileManager.default.createFile(
            atPath: node.path,
            contents: Data("#!/bin/sh\n".utf8),
            attributes: [.posixPermissions: 0o755]
        )
    }

    func testPicksNewestNvmVersionNumerically() throws {
        try makeNode(version: "v9.0.0", relative: "bin/node")
        try makeNode(version: "v24.18.0", relative: "bin/node")
        try makeNode(version: "v18.3.1", relative: "bin/node")

        let result = HomeBaseRuntimeSupervisor.newestVersionManagerNode(in: [tempRoot], fileManager: .default)

        // Lexicographic on strings would wrongly pick v9; numeric must pick v24.
        // hasSuffix avoids the /var vs /private/var symlink-resolution mismatch.
        XCTAssertEqual(result?.hasSuffix("/v24.18.0/bin/node"), true, "got \(result ?? "nil")")
    }

    func testSupportsFnmLayoutAndNilWhenEmpty() throws {
        XCTAssertNil(HomeBaseRuntimeSupervisor.newestVersionManagerNode(in: [tempRoot], fileManager: .default))

        try makeNode(version: "v20.1.0", relative: "installation/bin/node")
        let result = HomeBaseRuntimeSupervisor.newestVersionManagerNode(in: [tempRoot], fileManager: .default)

        XCTAssertEqual(result?.hasSuffix("/v20.1.0/installation/bin/node"), true, "got \(result ?? "nil")")
    }

    func testSemanticVersionParsing() {
        XCTAssertEqual(HomeBaseRuntimeSupervisor.semanticVersion("v24.18.0"), [24, 18, 0])
        XCTAssertEqual(HomeBaseRuntimeSupervisor.semanticVersion("20.1.0"), [20, 1, 0])
    }

    func testSelectsMatchingABIInsteadOfNewestNode() throws {
        let node24 = tempRoot.appendingPathComponent("node24")
        let node26 = tempRoot.appendingPathComponent("node26")
        try Data("#!/bin/sh\nprintf '24.18.0 137 darwin arm64'\n".utf8).write(to: node24)
        try Data("#!/bin/sh\nprintf '26.4.0 147 darwin arm64'\n".utf8).write(to: node26)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: node24.path)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: node26.path)
        let contract = HomeBaseNodeRuntimeContract(
            node: .init(major: 24, version: "24.18.0", moduleVersion: "137"),
            platform: "darwin",
            arch: "arm64"
        )

        let result = HomeBaseRuntimeSupervisor.compatibleNode(
            in: [node26.path, node24.path], contract: contract, fileManager: .default
        )

        XCTAssertEqual(result, node24.path)
    }

    func testRejectsMatchingABIDifferentArchitecture() throws {
        let x64Node = tempRoot.appendingPathComponent("node24-x64")
        try Data("#!/bin/sh\nprintf '24.18.0 137 darwin x64'\n".utf8).write(to: x64Node)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: x64Node.path)
        let contract = HomeBaseNodeRuntimeContract(
            node: .init(major: 24, version: "24.18.0", moduleVersion: "137"),
            platform: "darwin",
            arch: "arm64"
        )

        XCTAssertNil(HomeBaseRuntimeSupervisor.compatibleNode(
            in: [x64Node.path], contract: contract, fileManager: .default
        ))
    }
}
