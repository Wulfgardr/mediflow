// @Codex
import Foundation
import XCTest
@testable import MediFlowMac

/* @Codex */
final class LocalAPIClientAuthTests: XCTestCase {
    private var originalBaseURL: String?

    override func setUp() {
        super.setUp()
        originalBaseURL = UserDefaults.standard.string(forKey: LocalAPISettings.baseURLKey)
        LocalAPISettings.saveBaseURLString(LocalAPISettings.defaultBaseURL)
    }

    override func tearDown() {
        if let originalBaseURL {
            LocalAPISettings.saveBaseURLString(originalBaseURL)
        } else {
            UserDefaults.standard.removeObject(forKey: LocalAPISettings.baseURLKey)
        }
        super.tearDown()
    }

    func testTestConnectionFailsFastWhenTokenIsMissing() async {
        let client = LocalAPIClient(
            tokenProvider: LocalAPITokenProvider(
                keychainReader: { _ in .notFound },
                configReader: { nil },
                legacyReader: { nil }
            ),
            session: URLSession.shared
        )

        do {
            try await client.testConnection()
            XCTFail("Expected missing token failure")
        } catch let error as LocalAPIError {
            XCTAssertEqual(error, .missingAPIToken)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testTestConnectionSurfacesIncompleteBootstrapBeforeNetwork() async {
        let client = LocalAPIClient(
            tokenProvider: LocalAPITokenProvider(
                keychainReader: { _ in .interactionNotAllowed },
                configReader: { "config-token" },
                legacyReader: { "legacy-token" }
            ),
            session: URLSession.shared
        )

        do {
            try await client.testConnection()
            XCTFail("Expected bootstrap failure")
        } catch let error as LocalAPIError {
            XCTAssertEqual(
                error,
                .incompleteAPITokenBootstrap(.keychainInteractionNotAllowed)
            )
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }
}
