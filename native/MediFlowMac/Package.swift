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
        // Single shared library consumed by the universal Xcode app
        // (MediFlowAppleApp). The retired SPM executables (MediFlowMac,
        // MediFlowMobile) were duplicate app shells; the Xcode project is now the
        // sole shippable artifact. See docs/analysis/2026-06-28-fase0-decisioni-apple-universale.md
        .library(name: "MediFlowAppleShared", targets: ["MediFlowAppleShared"])
    ],
    targets: [
        .target(
            name: "MediFlowAppleShared"
        ),
        .testTarget(
            name: "MediFlowAppleSharedTests",
            dependencies: ["MediFlowAppleShared"]
        )
    ]
)
