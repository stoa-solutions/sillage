import Foundation
import ImageIO
import UniformTypeIdentifiers

public enum IdleBackdrop: String, Codable, CaseIterable, Sendable {
  case stoa, personal, none
}

/// Device-only appearance. No account, library or credential is stored here.
public struct AppearancePreferences: Codable, Equatable, Sendable {
  public var backdrop: IdleBackdrop = .stoa
  public var dimming: Double = 0.5
  public init() {}
  public mutating func normalize(hasPersonalImage: Bool) {
    dimming = dimming.isFinite ? min(0.85, max(0.25, dimming)) : 0.5
    if backdrop == .personal && !hasPersonalImage { backdrop = .stoa }
  }
}

/// Imports a bounded, decoded still image; configuration is replaced only after validation.
public struct AppearanceStore: Sendable {
  public let directory: URL
  public init(directory: URL) { self.directory = directory }
  public var imageURL: URL { directory.appendingPathComponent("background.jpg") }
  private var settingsURL: URL { directory.appendingPathComponent("appearance.json") }
  public var hasPersonalImage: Bool {
    guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil) else { return false }
    return CGImageSourceGetCount(source) > 0
  }
  public func load() -> AppearancePreferences {
    var value =
      (try? JSONDecoder().decode(AppearancePreferences.self, from: Data(contentsOf: settingsURL)))
      ?? AppearancePreferences()
    value.normalize(hasPersonalImage: hasPersonalImage)
    return value
  }
  public func save(_ preferences: AppearancePreferences) throws {
    try prepareDirectory()
    var value = preferences
    value.normalize(hasPersonalImage: hasPersonalImage)
    try JSONEncoder().encode(value).write(to: settingsURL, options: .atomic)
  }
  public func importImage(from url: URL) throws {
    let size = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
    guard size.isRegularFile == true, let count = size.fileSize, count > 0,
      count <= 30 * 1024 * 1024,
      let source = CGImageSourceCreateWithURL(
        url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
      let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = props[kCGImagePropertyPixelWidth] as? Int,
      let height = props[kCGImagePropertyPixelHeight] as? Int,
      width > 0, height > 0, width <= 30_000, height <= 30_000,
      Double(width) * Double(height) <= 150_000_000,
      let image = CGImageSourceCreateThumbnailAtIndex(
        source, 0,
        [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceCreateThumbnailWithTransform: true,
          kCGImageSourceThumbnailMaxPixelSize: 2560,
          kCGImageSourceShouldCacheImmediately: true,
        ] as CFDictionary)
    else {
      throw SillageError.message(
        "Choisis une image JPEG, PNG, HEIC ou WebP valide, de moins de 30 Mo.")
    }
    let data = NSMutableData()
    guard
      let destination = CGImageDestinationCreateWithData(
        data, UTType.jpeg.identifier as CFString, 1, nil)
    else { throw SillageError.message("Cette image ne peut pas être préparée.") }
    // Re-encoding keeps orientation but drops source EXIF/location metadata.
    CGImageDestinationAddImage(
      destination, image, [kCGImageDestinationLossyCompressionQuality: 0.88] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
      throw SillageError.message("Cette image ne peut pas être préparée.")
    }
    try prepareDirectory()
    try (data as Data).write(to: imageURL, options: .atomic)
  }
  private func prepareDirectory() throws {
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  }
}
