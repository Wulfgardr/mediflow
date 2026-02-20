// swift-tools-version: 5.9
// @Codex
import PackageDescription

let package = Package(
    name: "MediFlowMac",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "MediFlowMac", targets: ["MediFlowMac"])
    ],
    targets: [
        .executableTarget(
            name: "MediFlowMac"
        ),
        .testTarget(
            name: "MediFlowMacTests",
            dependencies: ["MediFlowMac"]
        )
    ]
)
