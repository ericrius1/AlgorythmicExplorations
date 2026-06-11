// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "Bonfire",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(
      name: "Bonfire",
      resources: [.copy("Shaders.metal")]
    )
  ]
)
