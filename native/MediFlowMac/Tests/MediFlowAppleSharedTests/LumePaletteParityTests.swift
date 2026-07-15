// @Codex
import Foundation
import XCTest
@testable import MediFlowAppleShared

final class LumePaletteParityTests: XCTestCase {
    func testCodeFirstPaletteMatchesCanonicalJSON() throws {
        let data = try Data(contentsOf: canonicalTokenURL())
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        var canonical: [String: String] = [:]
        collectHexTokens(in: root, path: [], into: &canonical)

        let swiftPalette = LumePalette.tokenHexValues
        let allKeys = Set(canonical.keys).union(swiftPalette.keys).sorted()
        let failures = allKeys.compactMap { key -> String? in
            guard let expected = canonical[key] else { return "unexpected Swift token: \(key)" }
            guard let actual = swiftPalette[key] else { return "missing Swift token: \(key)" }
            guard expected.lowercased() == actual.lowercased() else {
                return "\(key): JSON \(expected), Swift \(actual)"
            }
            return nil
        }

        XCTAssertTrue(
            failures.isEmpty,
            "Lume palette drifted from docs/design/lume/tokens/lume.tokens.json:\n\(failures.joined(separator: "\n"))"
        )
    }

    private func canonicalTokenURL() throws -> URL {
        var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while directory.path != "/" {
            let candidate = directory.appendingPathComponent(
                "docs/design/lume/tokens/lume.tokens.json"
            )
            if FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
            directory.deleteLastPathComponent()
        }
        throw NSError(
            domain: "LumePaletteParityTests",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Canonical Lume token JSON not found from #filePath"]
        )
    }

    private func collectHexTokens(
        in node: [String: Any],
        path: [String],
        into tokens: inout [String: String]
    ) {
        if let value = node["$value"] as? String {
            tokens[path.joined(separator: ".")] = value
            return
        }

        for key in node.keys.sorted() where !key.hasPrefix("$") {
            guard let child = node[key] as? [String: Any] else { continue }
            collectHexTokens(in: child, path: path + [key], into: &tokens)
        }
    }
}
