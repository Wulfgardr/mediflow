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
        .library(name: "MediFlowAppleShared", targets: ["MediFlowAppleShared"]),
        .executable(name: "MediFlowMac", targets: ["MediFlowMac"]),
        .executable(name: "MediFlowMobile", targets: ["MediFlowMobile"])
    ],
    targets: [
        .target(
            name: "MediFlowAppleShared"
        ),
        .executableTarget(
            name: "MediFlowMac",
            dependencies: ["MediFlowAppleShared"]
        ),
        .executableTarget(
            name: "MediFlowMobile",
            dependencies: ["MediFlowAppleShared"]
        ),
        .testTarget(
            name: "MediFlowMacTests",
            dependencies: ["MediFlowMac"]
        ),
        .testTarget(
            name: "MediFlowAppleSharedTests",
            dependencies: ["MediFlowAppleShared"]
        )
    ]
)
