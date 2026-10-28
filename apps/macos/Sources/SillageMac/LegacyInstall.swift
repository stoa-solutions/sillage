import Foundation
import SillageKit

/// Moves an installation made under the former identity (`FormerIdentity`) to Sillage's own,
/// once, before anything reads the session: the Application Support folder (session, appearance,
/// Studio cache) and the settings. Nothing is overwritten: an existing Sillage folder or setting
/// wins. The former caches are dropped; macOS asks again for the microphone and speech once.
enum LegacyInstall {
  static func migrate() {
    // A test copy with its own data folder never touches the real installation.
    guard ProcessInfo.processInfo.environment["SILLAGE_DATA_DIR"] == nil,
      Bundle.main.bundleIdentifier != FormerIdentity.bundleID
    else { return }
    let files = FileManager.default
    let library = files.urls(for: .libraryDirectory, in: .userDomainMask)[0]
    let support = files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let former = support.appendingPathComponent(FormerIdentity.supportFolder, isDirectory: true)
    let current = support.appendingPathComponent("Sillage", isDirectory: true)
    if files.fileExists(atPath: former.path) && !files.fileExists(atPath: current.path) {
      try? files.moveItem(at: former, to: current)
    }
    let defaults = UserDefaults.standard
    if let settings = defaults.persistentDomain(forName: FormerIdentity.bundleID) {
      for (key, value) in settings where defaults.object(forKey: key) == nil {
        defaults.set(value, forKey: key)
      }
      defaults.removePersistentDomain(forName: FormerIdentity.bundleID)
    }
    for folder in ["Caches", "WebKit", "HTTPStorages", "Saved Application State"] {
      let name =
        folder == "Saved Application State"
        ? FormerIdentity.bundleID + ".savedState" : FormerIdentity.bundleID
      try? files.removeItem(at: library.appendingPathComponent(folder).appendingPathComponent(name))
    }
    try? files.removeItem(
      at: library.appendingPathComponent("Preferences/\(FormerIdentity.bundleID).plist"))
  }
}
