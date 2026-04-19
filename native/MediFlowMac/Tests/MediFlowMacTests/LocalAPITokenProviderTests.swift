// @Codex
import Security
import XCTest
@testable import MediFlowMac

/* @Codex */
final class LocalAPITokenProviderTests: XCTestCase {
    func testResolveTokenPrefersKeychainBeforeConfigAndLegacy() {
        let provider = LocalAPITokenProvider(
            keychainReader: { _ in .success("keychain-token") },
            configReader: {
                XCTFail("Config fallback should not win over Keychain")
                return nil
            },
            legacyReader: {
                XCTFail("Legacy fallback should not win over Keychain")
                return nil
            }
        )

        XCTAssertEqual(provider.resolveToken(), .resolved("keychain-token", source: .keychain))
    }

    func testResolveTokenFallsBackToConfigBeforeLegacyWhenKeychainIsMissing() {
        let provider = LocalAPITokenProvider(
            keychainReader: { _ in .notFound },
            configReader: { "config-token" },
            legacyReader: {
                XCTFail("Legacy fallback should not be used when config is available")
                return nil
            }
        )

        XCTAssertEqual(provider.resolveToken(), .resolved("config-token", source: .config))
    }

    func testResolveTokenReturnsNotFoundWhenAllSourcesAreMissing() {
        let provider = LocalAPITokenProvider(
            keychainReader: { _ in .notFound },
            configReader: { nil },
            legacyReader: { nil }
        )

        XCTAssertEqual(provider.resolveToken(), .failure(.notFound))
    }

    func testResolveTokenStopsUsingConfigAsSoonAsKeychainBecomesAvailable() {
        var keychainResult: KeychainReadResult = .notFound
        let provider = LocalAPITokenProvider(
            keychainReader: { _ in keychainResult },
            configReader: { "config-token" },
            legacyReader: { "legacy-token" }
        )

        XCTAssertEqual(provider.resolveToken(), .resolved("config-token", source: .config))

        keychainResult = .success("keychain-token")
        XCTAssertEqual(provider.resolveToken(), .resolved("keychain-token", source: .keychain))
    }

    func testResolveTokenDoesNotSilentlyFallbackWhenKeychainBootstrapIsBlocked() {
        let provider = LocalAPITokenProvider(
            keychainReader: { _ in .interactionNotAllowed },
            configReader: { "config-token" },
            legacyReader: { "legacy-token" }
        )

        XCTAssertEqual(
            provider.resolveToken(),
            .failure(.keychainInteractionNotAllowed)
        )
    }

    func testResolveTokenDoesNotSilentlyFallbackWhenKeychainAuthFails() {
        let provider = LocalAPITokenProvider(
            keychainReader: { _ in .authFailed },
            configReader: { "config-token" },
            legacyReader: { "legacy-token" }
        )

        XCTAssertEqual(
            provider.resolveToken(),
            .failure(.keychainAuthFailed)
        )
    }

    func testResolveTokenDoesNotSilentlyFallbackWhenKeychainIsUnavailable() {
        let provider = LocalAPITokenProvider(
            keychainReader: { _ in .other(errSecNotAvailable) },
            configReader: { "config-token" },
            legacyReader: { "legacy-token" }
        )

        XCTAssertEqual(
            provider.resolveToken(),
            .failure(.keychainUnavailable)
        )
    }
}
