// swift-tools-version: 5.9
// @Codex
import PackageDescription

let package = Package(
    name: "MediFlowMac",
    platforms: [
        .macOS(.v13),
        .iOS(.v17)
    ],
    products: [
        // ADR 0071 Fase 1: MediFlowCore is the platform-free shared core (crypto
        // today; codecs/scales/SQLite/validators next). Standalone product so the
        // tri-OS CI gate can build/test it on Windows-MSVC and Linux.
        .library(name: "MediFlowCore", targets: ["MediFlowCore"]),
        // MediFlowAppleShared stays the product the universal Xcode app consumes;
        // in Fase 1 it re-exports MediFlowCore (compatibility shim) so the app does
        // not break while the split proceeds. It will later split into
        // MediFlowAppleSync + MediFlowAppleUI.
        .library(name: "MediFlowAppleShared", targets: ["MediFlowAppleShared"])
    ],
    dependencies: [
        // swift-crypto: one crypto source path for all OSes. Re-exports CryptoKit
        // on Apple; BoringSSL-backed on Linux/Windows. Same AES-GCM/PBKDF2 API.
        .package(url: "https://github.com/apple/swift-crypto.git", from: "3.0.0")
    ],
    targets: [
        .target(
            name: "MediFlowCore",
            dependencies: [
                .product(name: "Crypto", package: "swift-crypto")
            ]
        ),
        .target(
            name: "MediFlowAppleShared",
            dependencies: ["MediFlowCore"]
        ),
        .testTarget(
            name: "MediFlowCoreTests",
            dependencies: ["MediFlowCore"]
        ),
        .testTarget(
            name: "MediFlowAppleSharedTests",
            dependencies: ["MediFlowAppleShared"]
        )
    ]
)
