// swift-tools-version: 5.10
import PackageDescription
let package = Package(
    name: "SillageMac", platforms: [.macOS(.v14)],
    products: [.executable(name: "SillageMac", targets: ["SillageMac"])],
    dependencies: [.package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.0")],
    targets: [
        .target(name: "SillageKit"),
        .target(name: "SillageAudio", dependencies: ["SillageKit"]),
        .executableTarget(name: "SillageAudioTests", dependencies: ["SillageAudio"]),
        .executableTarget(name: "SillageDiagnostics", dependencies: ["SillageKit"]),
        .executableTarget(name: "SillageMac", dependencies: ["SillageKit", "SillageAudio", .product(name: "Sparkle", package: "Sparkle")], resources: [.copy("Resources")], linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]),
        .executableTarget(name: "SillageCoreTests", dependencies: ["SillageKit"]),
        .executableTarget(name: "SillageServerTests", dependencies: ["SillageKit"])
    ]
)
