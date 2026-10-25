// swift-tools-version: 5.10
import PackageDescription
let package = Package(
    name: "PlaylistRecallMac", platforms: [.macOS(.v14)],
    products: [.executable(name: "RecallMac", targets: ["RecallMac"])],
    dependencies: [.package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.0")],
    targets: [
        .target(name: "RecallKit"),
        .target(name: "RecallAudio", dependencies: ["RecallKit"]),
        .executableTarget(name: "RecallAudioTests", dependencies: ["RecallAudio"]),
        .executableTarget(name: "RecallDiagnostics", dependencies: ["RecallKit"]),
        .executableTarget(name: "RecallMac", dependencies: ["RecallKit", "RecallAudio", .product(name: "Sparkle", package: "Sparkle")], linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]),
        .executableTarget(name: "RecallCoreTests", dependencies: ["RecallKit"]),
        .executableTarget(name: "RecallServerTests", dependencies: ["RecallKit"])
    ]
)
