/// Window constraints shared by the scene and the automated layout checks.
/// The minimum belongs to SwiftUI content, not a competing AppKit resize callback.
public enum RecallWindowLayout {
  public static func minimumWidth(studio: Bool, reading: Bool) -> Double {
    studio || reading ? 900 : 600
  }
}
