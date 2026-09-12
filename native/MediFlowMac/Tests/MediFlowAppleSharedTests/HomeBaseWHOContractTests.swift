// @Codex: WUL-673. Synthetic fixtures, shared by DTO/client/store tests.
import Foundation
import XCTest
@testable import MediFlowAppleShared

enum WHOSyntheticFixtures {
    static let image = "sha256:" + String(repeating: "a", count: 64)
    static let dataset = "sha256:" + String(repeating: "b", count: 64)
    static let uri = "http://id.who.int/icd/release/11/2026-01/mms/1000000001"
    static let now = "2026-09-12T10:00:00.000Z"
    static let tomorrow = "2026-09-13T10:00:00.000Z"
    static var reference: [String: Any] { ["releaseId": "2026-01", "language": "en", "bindingId": HomeBaseWHODecoder.binding, "imageDigest": image, "datasetSnapshotId": dataset] }
    static func search(code: String = "AA00", source: String = "live", partial: Bool = false, empty: Bool = false) -> [String: Any] {
        var receipt = reference
        receipt.merge(["schemaVersion": "mediflow.reference-data.icd11-search-receipt.v2", "operation": "mediflow.reference_data.icd11.search.v2", "deployment": "local", "source": source, "resultCount": empty ? 0 : 1, "latencyMs": 0, "fetchedAt": now, "expiresAt": tomorrow, "completedAt": now]) { _, new in new }
        let canonical = code.contains("&") || code.contains("/") ? codeInfo(code) : uri
        return ["schemaVersion": "mediflow.reference-data.icd11-search-response.v2", "entries": empty ? [] : [["code": code, "description": "Synthetic term", "system": "ICD-11", "canonicalUri": canonical]], "partial": partial, "receipt": receipt]
    }
    static func codeInfo(_ code: String) -> String {
        "http://id.who.int/icd/release/11/2026-01/mms/codeinfo/" + code.replacingOccurrences(of: "&", with: "%26").replacingOccurrences(of: "/", with: "%2F")
    }
    static func check(code: String = "AA00", found: Bool = true) -> [String: Any] {
        var receipt = reference
        receipt.merge(["schemaVersion": "mediflow.reference-data.icd11-code-check-receipt.v1", "operation": "mediflow.reference_data.icd11.code_check.v1", "source": "live", "found": found, "checkedAt": now, "latencyMs": 0]) { _, new in new }
        return ["schemaVersion": "mediflow.reference-data.icd11-code-check.v1", "code": code, "status": found ? "found" : "not_found", "entry": found ? ["canonicalUri": codeInfo(code), "stemUri": uri, "stemCode": String(code.split(whereSeparator: { $0 == "&" || $0 == "/" })[0]), "stemTitle": "Synthetic stem"] : NSNull(), "receipt": receipt]
    }
    static func readiness(status: String = "configured") -> [String: Any] {
        var result = reference
        result.merge(["schemaVersion": "mediflow.reference-data.icd11-who-readiness.v2", "status": status, "deployment": "local", "lastLiveObservedAt": status == "available" ? now : NSNull(), "lastResultSource": status == "available" ? "live" : NSNull()]) { _, new in new }
        return result
    }
    static func data(_ value: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) }
}

final class HomeBaseWHOContractTests: XCTestCase {
    // Optional reproducible integration: JSON emitted by the actual paired route
    // and canonical runtime, using tools/export-wire-fixtures.mjs in the handoff.
    func testActualBackendWireFixturesWhenProvided() throws {
        guard let directory = ProcessInfo.processInfo.environment["WHO_CROSS_LANGUAGE_FIXTURES"] else {
            throw XCTSkip("Set WHO_CROSS_LANGUAGE_FIXTURES to exported synthetic backend envelopes")
        }
        struct Fixture: Decodable { let file: String; let operation: String; let status: Int; let code: String? }
        let root = URL(fileURLWithPath: directory, isDirectory: true)
        let index = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: root.appendingPathComponent("index.json")))
        XCTAssertEqual(index.count, 13)
        for item in index {
            let data = try Data(contentsOf: root.appendingPathComponent(item.file))
            if item.status == 400 || item.status == 409 {
                XCTAssertEqual(HomeBaseWHODecoder.error(data, status: item.status), item.status == 400 ? .invalidRequest : .releaseNotSupported)
            } else if item.operation == "search" {
                let result = try HomeBaseWHODecoder.search(data)
                XCTAssertEqual(result.receipt.releaseId, "2026-01")
                XCTAssertEqual(result.receipt.resultCount, result.entries.count)
            } else if item.operation == "readiness" {
                let result = try HomeBaseWHODecoder.readiness(data)
                XCTAssertEqual(result.status == .available, item.status == 200)
            } else {
                let result = try HomeBaseWHODecoder.checkCode(data, requestedCode: XCTUnwrap(item.code))
                XCTAssertEqual(result.receipt.source, .live)
            }
        }
    }
    func testSearchLiveCachePartialEmptyPreserveFullContract() throws {
        for source in ["live", "cache"] { for partial in [false, true] { for empty in [false, true] {
            let result = try HomeBaseWHODecoder.search(WHOSyntheticFixtures.data(WHOSyntheticFixtures.search(source: source, partial: partial, empty: empty)))
            XCTAssertEqual(result.receipt.source.rawValue, source)
            XCTAssertEqual(result.partial, partial)
            XCTAssertEqual(result.entries.count, empty ? 0 : 1)
            XCTAssertEqual(result.receipt.resultCount, result.entries.count)
            XCTAssertEqual(result.receipt.releaseId, "2026-01")
            XCTAssertEqual(result.receipt.language, "en")
            XCTAssertEqual(result.receipt.imageDigest, WHOSyntheticFixtures.image)
            XCTAssertEqual(result.receipt.datasetSnapshotId, WHOSyntheticFixtures.dataset)
            if !empty { XCTAssertEqual(result.entries.first?.canonicalUri, WHOSyntheticFixtures.uri) }
        } } }
    }
    func testSearchCombinationExactCanonicalReference() throws {
        for code in ["AA00&XA001", "AA00/XA001"] {
            let result = try HomeBaseWHODecoder.search(WHOSyntheticFixtures.data(WHOSyntheticFixtures.search(code: code)))
            XCTAssertEqual(result.entries.first?.code, code)
            XCTAssertEqual(result.entries.first?.canonicalUri, WHOSyntheticFixtures.codeInfo(code))
        }
    }
    func testSearchRejectsWrongSchemaExtraMissingMalformedAndUnknownEnum() throws {
        let valid = WHOSyntheticFixtures.search()
        for (key, value) in [("schemaVersion", "mediflow.reference-data.icd11-search-response.v1" as Any), ("secret", "not-allowed"), ("entries", NSNull()), ("partial", "true")] {
            var bad = valid; bad[key] = value
            XCTAssertThrowsError(try HomeBaseWHODecoder.search(WHOSyntheticFixtures.data(bad)), key)
        }
        for key in valid.keys {
            var bad = valid; bad.removeValue(forKey: key)
            XCTAssertThrowsError(try HomeBaseWHODecoder.search(WHOSyntheticFixtures.data(bad)), key)
        }
        for (key, value) in [("source", "remote" as Any), ("resultCount", 2), ("language", "it"), ("releaseId", "2025-01"), ("bindingId", "other"), ("imageDigest", "latest"), ("datasetSnapshotId", ""), ("deployment", "remote"), ("latencyMs", -1), ("schemaVersion", "unknown"), ("operation", "other"), ("token", "not-allowed")] {
            var bad = valid; var receipt = bad["receipt"] as! [String: Any]; receipt[key] = value; bad["receipt"] = receipt
            XCTAssertThrowsError(try HomeBaseWHODecoder.search(WHOSyntheticFixtures.data(bad)), key)
        }
        XCTAssertThrowsError(try HomeBaseWHODecoder.search(Data("{bad}".utf8)))
    }
    func testSearchRejectsMalformedEntryAndDuplicateCodes() throws {
        for (key, value) in [("code", "N/A"), ("code", "AA00&&XA00"), ("canonicalUri", "https://example.invalid/"), ("canonicalUri", WHOSyntheticFixtures.uri.replacingOccurrences(of: "2026-01", with: "2025-01")), ("description", "<b>term</b>"), ("description", " term"), ("description", "term\u{200f}"), ("system", "ICD-10"), ("vendor", "unexpected")] {
            var bad = WHOSyntheticFixtures.search(); var entry = (bad["entries"] as! [[String: Any]])[0]
            entry[key] = value; bad["entries"] = [entry]
            XCTAssertThrowsError(try HomeBaseWHODecoder.search(WHOSyntheticFixtures.data(bad)), key)
        }
        var duplicate = WHOSyntheticFixtures.search(); let entry = (duplicate["entries"] as! [[String: Any]])[0]
        duplicate["entries"] = [entry, entry]; var receipt = duplicate["receipt"] as! [String: Any]; receipt["resultCount"] = 2; duplicate["receipt"] = receipt
        XCTAssertThrowsError(try HomeBaseWHODecoder.search(WHOSyntheticFixtures.data(duplicate)))
    }
    func testSearchRejectsInvalidReceiptChronologyAndOverboundBody() throws {
        for (key, value) in [("expiresAt", WHOSyntheticFixtures.now), ("completedAt", WHOSyntheticFixtures.tomorrow), ("fetchedAt", "2026-09-12T10:00:01.000Z"), ("completedAt", "2026-09-12T10:00:00Z"), ("completedAt", "2026-09-12T10:00:00.001Z")] {
            var bad = WHOSyntheticFixtures.search(); var receipt = bad["receipt"] as! [String: Any]; receipt[key] = value; bad["receipt"] = receipt
            XCTAssertThrowsError(try HomeBaseWHODecoder.search(WHOSyntheticFixtures.data(bad)), key)
        }
        var data = try WHOSyntheticFixtures.data(WHOSyntheticFixtures.search())
        data.append(Data(repeating: 32, count: 65_537 - data.count))
        XCTAssertEqual(HomeBaseWHODecoder.maximumBytes, 65_536)
        XCTAssertThrowsError(try HomeBaseWHODecoder.search(data))
    }
    func testReadinessConfiguredIsNotAvailableAndNullFieldsAreRequired() throws {
        for status in ["disabled", "configuration_required", "configured", "available", "unavailable"] {
            let parsed = try HomeBaseWHODecoder.readiness(WHOSyntheticFixtures.data(WHOSyntheticFixtures.readiness(status: status)))
            XCTAssertEqual(parsed.status.rawValue, status)
        }
        var disabled = WHOSyntheticFixtures.readiness(status: "disabled")
        disabled["imageDigest"] = NSNull(); disabled["datasetSnapshotId"] = NSNull()
        XCTAssertNoThrow(try HomeBaseWHODecoder.readiness(WHOSyntheticFixtures.data(disabled)))
        var configured = disabled; configured["status"] = "configured"
        XCTAssertThrowsError(try HomeBaseWHODecoder.readiness(WHOSyntheticFixtures.data(configured)))
        var available = WHOSyntheticFixtures.readiness(status: "available"); available["lastLiveObservedAt"] = NSNull()
        XCTAssertThrowsError(try HomeBaseWHODecoder.readiness(WHOSyntheticFixtures.data(available)))
        for key in ["lastResultSource", "lastLiveObservedAt", "imageDigest"] {
            var bad = disabled; bad.removeValue(forKey: key)
            XCTAssertThrowsError(try HomeBaseWHODecoder.readiness(WHOSyntheticFixtures.data(bad)), key)
        }
        var unknown = disabled; unknown["status"] = "starting"
        XCTAssertThrowsError(try HomeBaseWHODecoder.readiness(WHOSyntheticFixtures.data(unknown)))
    }
    func testCodeCheckFoundAndNotFoundAreLiveAndBoundToRequestedCode() throws {
        for code in ["AA00", "AA00&XA001", "AA00/XA001"] { for found in [false, true] {
            let result = try HomeBaseWHODecoder.checkCode(WHOSyntheticFixtures.data(WHOSyntheticFixtures.check(code: code, found: found)), requestedCode: code)
            XCTAssertEqual(result.receipt.source, .live)
            XCTAssertEqual(result.receipt.found, found)
            XCTAssertEqual(result.code, code)
            XCTAssertEqual(result.entry != nil, found)
        } }
        XCTAssertThrowsError(try HomeBaseWHODecoder.checkCode(WHOSyntheticFixtures.data(WHOSyntheticFixtures.check()), requestedCode: "AA01"))
    }
    func testCodeCheckRejectsCacheAndInconsistentFoundOrStem() throws {
        for (key, value) in [("source", "cache" as Any), ("found", false), ("checkedAt", "yesterday"), ("bindingId", "other")] {
            var bad = WHOSyntheticFixtures.check(); var receipt = bad["receipt"] as! [String: Any]; receipt[key] = value; bad["receipt"] = receipt
            XCTAssertThrowsError(try HomeBaseWHODecoder.checkCode(WHOSyntheticFixtures.data(bad), requestedCode: "AA00"), key)
        }
        for (key, value) in [("stemCode", "AA01"), ("stemTitle", "<script>"), ("stemUri", "file:///tmp/"), ("canonicalUri", WHOSyntheticFixtures.uri)] {
            var bad = WHOSyntheticFixtures.check(); var entry = bad["entry"] as! [String: Any]; entry[key] = value; bad["entry"] = entry
            XCTAssertThrowsError(try HomeBaseWHODecoder.checkCode(WHOSyntheticFixtures.data(bad), requestedCode: "AA00"), key)
        }
        var notFound = WHOSyntheticFixtures.check(found: false); notFound["entry"] = WHOSyntheticFixtures.check()["entry"]
        XCTAssertThrowsError(try HomeBaseWHODecoder.checkCode(WHOSyntheticFixtures.data(notFound), requestedCode: "AA00"))
    }
    func testInputsAreBoundedWithoutFallbackOrRemoteLookup() throws {
        XCTAssertEqual(try HomeBaseWHODecoder.normalizedQuery(" synthetic   term "), "synthetic term")
        for value in ["", " ", "<script>", String(repeating: "a", count: 161), String(repeating: "é", count: 81)] {
            XCTAssertThrowsError(try HomeBaseWHODecoder.normalizedQuery(value))
        }
        for code in ["", "N/A", "AA00&", "AA00&&XA00", "aa00", "AA00?", String(repeating: "A", count: 33)] {
            XCTAssertFalse(HomeBaseWHODecoder.isCheckCode(code), code)
        }
    }
    func testErrorsAreClosedAndGeneric503DoesNotClaimOversize() throws {
        let errors: [(Int, String, HomeBaseWHOError)] = [(400, "request_invalid", .invalidRequest), (409, "release_not_supported", .releaseNotSupported), (502, "upstream_response_invalid", .upstreamResponseInvalid), (503, "service_unavailable", .unavailable), (504, "upstream_timeout", .upstreamTimeout)]
        for (status, code, expected) in errors {
            let data = try WHOSyntheticFixtures.data(["schemaVersion": "mediflow.reference-data.icd11-error.v1", "code": code])
            XCTAssertEqual(HomeBaseWHODecoder.error(data, status: status), expected)
        }
        XCTAssertFalse(HomeBaseWHOError.unavailable.localizedDescription.contains("oltre il limite"))
        XCTAssertEqual(HomeBaseWHODecoder.error(Data(), status: 401), .unauthorized)
        XCTAssertEqual(HomeBaseWHODecoder.error(Data(), status: 403), .forbidden)
        XCTAssertEqual(HomeBaseWHODecoder.error(try WHOSyntheticFixtures.data(["code": "NETWORK_MODE_DISABLED"]), status: 409), .networkModeDisabled)
        XCTAssertEqual(HomeBaseWHODecoder.error(try WHOSyntheticFixtures.data(["code": "vendor-secret"]), status: 503), .invalidResponse)
    }
    func testRequestFenceOutOfOrderInvalidateAndDisconnect() {
        var fence = RepertoriRequestFence<String>()
        let first = fence.begin(identity: "original")
        let second = fence.begin(identity: "original")
        XCTAssertFalse(fence.isCurrent(first, identity: "original"))
        XCTAssertTrue(fence.isCurrent(second, identity: "original"))
        XCTAssertFalse(fence.isCurrent(second, identity: "different-session-or-scope"))
        XCTAssertFalse(fence.isCurrent(second, identity: nil))
        fence.invalidate()
        XCTAssertFalse(fence.isCurrent(second, identity: "original"))
        let replacement = fence.begin(identity: "original")
        XCTAssertTrue(fence.isCurrent(replacement, identity: "original"))
        XCTAssertFalse(fence.isCurrent(first, identity: "original"))
    }
}
