import Foundation
import ImageIO
import RecallKit
import UniformTypeIdentifiers

func checkAppearance() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = AppearanceStore(directory: directory.appendingPathComponent("appearance"))
  try expect(store.load() == AppearancePreferences(), "New install did not default to Stoa")
  var value = AppearancePreferences()
  value.backdrop = .personal
  value.dimming = 3
  try store.save(value)
  try expect(
    store.load().backdrop == .stoa && store.load().dimming == 0.85, "Invalid appearance persisted")
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  let original = directory.appendingPathComponent("original.png")
  let context = CGContext(
    data: nil, width: 3000, height: 100, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  let image = context.makeImage()!
  let destination = CGImageDestinationCreateWithURL(
    original as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(destination, image, nil)
  try expect(CGImageDestinationFinalize(destination), "Test image generation failed")
  try store.importImage(from: original)
  value.backdrop = .personal
  value.dimming = 0.35
  try store.save(value)
  try FileManager.default.removeItem(at: original)
  let reloaded = AppearanceStore(directory: store.directory)
  try expect(
    reloaded.load() == value && reloaded.hasPersonalImage,
    "Personal background depended on original file or was not persisted")
  let source = CGImageSourceCreateWithURL(store.imageURL as CFURL, nil)!
  let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as! [CFString: Any]
  try expect((props[kCGImagePropertyPixelWidth] as? Int) == 2560, "Image memory was not bounded")
  let before = try Data(contentsOf: store.imageURL)
  let invalid = directory.appendingPathComponent("invalid.jpg")
  try Data("not an image".utf8).write(to: invalid)
  try expectFailure { try store.importImage(from: invalid) }
  try expect(
    try Data(contentsOf: store.imageURL) == before, "Invalid import destroyed previous background")
  try store.save(AppearancePreferences())
  try expect(
    store.load().backdrop == .stoa && store.hasPersonalImage, "Reset deleted personal image")
  try Data("broken".utf8).write(to: store.directory.appendingPathComponent("appearance.json"))
  try expect(store.load() == AppearancePreferences(), "Corrupt settings failed to recover")
  print("Appearance persistence/import checks passed")
}
