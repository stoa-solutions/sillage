import Foundation

/// What Sillage was called before 1.9. Read once to move an existing installation (settings,
/// session, Studio cache) and an old hosted origin; never written. Remove it together with
/// `LegacyInstall` once every installation has run 1.9.
public enum FormerIdentity {
  public static let bundleID = "solutions.stoa.playlist-recall"
  public static let supportFolder = "Playlist Recall"
  public static let host = "recall.stoa.solutions"
}
