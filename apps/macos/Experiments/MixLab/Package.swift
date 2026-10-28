// swift-tools-version: 5.9
import PackageDescription

// Deliberately independent: this package is not a dependency of the installed app.
let package = Package(
  name: "SillageMixLab",
  platforms: [.macOS(.v14)],
  dependencies: [.package(url: "https://github.com/AudioKit/AudioKit.git", exact: "5.7.2")],
  targets: [
    .executableTarget(
      name: "MixLab", dependencies: [.product(name: "AudioKit", package: "AudioKit")])
  ]
)
