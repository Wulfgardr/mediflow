// swift-tools-version: 5.9
// @Codex
import PackageDescription

// ADR 0071 Fase 1: the platform-free core (MediFlowCore) builds on every OS; the
// Apple targets (SwiftUI/AppKit/UIKit) only exist when the manifest is evaluated
// on an Apple platform, so `swift build`/`swift test` on Linux/Windows compile and
// run ONLY MediFlowCore + its tests (the tri-OS golden-vector gate). On macOS the
// universal Xcode app still gets MediFlowAppleShared.
var products: [Product] = [
    .library(name: "MediFlowCore", targets: ["MediFlowCore"])
]
var targets: [Target] = [
    // ADR 0071 Fase 2 (Codex review): the vendored SQLite amalgamation, so the
    // core bundles SQLite on every OS instead of relying on a system libsqlite3.
    .target(
        name: "MediFlowSQLiteC",
        publicHeadersPath: "include",
        cSettings: [
            .define("SQLITE_THREADSAFE", to: "1"),
            .define("SQLITE_OMIT_LOAD_EXTENSION"),
            .define("SQLITE_DQS", to: "0"),
            .define("SQLITE_DEFAULT_FOREIGN_KEYS", to: "1")
        ]
    ),
    .target(
        name: "MediFlowCore",
        dependencies: [
            "MediFlowSQLiteC",
            // swift-crypto: one crypto source path for all OSes. Re-exports
            // CryptoKit on Apple; BoringSSL-backed on Linux/Windows.
            .product(name: "Crypto", package: "swift-crypto")
        ]
    ),
    .testTarget(
        name: "MediFlowCoreTests",
        dependencies: ["MediFlowCore"]
    )
]

#if os(macOS) || os(iOS)
// MediFlowAppleShared stays the product the universal Xcode app consumes; in
// Fase 1 it re-exports MediFlowCore (compatibility shim). It will later split into
// MediFlowAppleSync + MediFlowAppleUI.
products.append(.library(name: "MediFlowAppleShared", targets: ["MediFlowAppleShared"]))
targets.append(.target(name: "MediFlowAppleShared", dependencies: ["MediFlowCore"]))
targets.append(.testTarget(name: "MediFlowAppleSharedTests", dependencies: ["MediFlowAppleShared"]))
#endif

let package = Package(
    name: "MediFlowMac",
    platforms: [
        .macOS(.v13),
        .iOS(.v17)
    ],
    products: products,
    dependencies: [
        .package(url: "https://github.com/apple/swift-crypto.git", from: "3.0.0")
    ],
    targets: targets
)
