import Foundation

/// Provider errors stay typed until the session decides whether another track can help.
/// No raw extractor output, cookies or signed media URLs are retained in this value.
public struct PlaybackFailure: Error, LocalizedError, Sendable, Equatable {
  public enum Kind: Sendable, Equatable {
    case videoUnavailable, embeddingDenied, configuration, authentication, rateLimited, network
    case download, unknown
  }
  public let kind: Kind
  public let youtubeCode: Int?
  public init(_ kind: Kind, youtubeCode: Int? = nil) {
    self.kind = kind
    self.youtubeCode = youtubeCode
  }
  public var mayTryAnotherTrack: Bool { kind == .videoUnavailable || kind == .embeddingDenied }
  public var errorDescription: String? { message }
  public var message: String {
    let detail: String
    switch kind {
    case .videoUnavailable: detail = "Cette vidéo est indisponible sur YouTube."
    case .embeddingDenied:
      detail = "YouTube refuse la lecture de cette vidéo dans le lecteur intégré."
    case .configuration: detail = "YouTube ne reconnaît pas la configuration du lecteur Recall."
    case .authentication:
      detail = "YouTube demande une connexion ou une vérification avant de lire les clips."
    case .rateLimited: detail = "YouTube limite temporairement les demandes de lecture."
    case .network: detail = "Impossible de joindre YouTube. Vérifie ta connexion."
    case .download: detail = "Le clip n’a pas pu être préparé sur ce Mac."
    case .unknown: detail = "YouTube n’a pas pu démarrer la lecture."
    }
    return detail + (youtubeCode.map { " (code \($0))" } ?? "")
  }
  public static func youtube(code: Int?) -> Self {
    switch code {
    case 100: Self(.videoUnavailable, youtubeCode: code)
    case 101, 150: Self(.embeddingDenied, youtubeCode: code)
    case 2, 153: Self(.configuration, youtubeCode: code)
    default: Self(.unknown, youtubeCode: code)
    }
  }
  /// Classify bounded stderr in memory, then discard it. Never display the raw output.
  public static func downloadDiagnostic(_ text: String, timedOut: Bool = false) -> Self {
    let text = text.lowercased()
    if text.contains("not a bot") || text.contains("login_required")
      || text.contains("login required") || text.contains("sign in to confirm")
    {
      return Self(.authentication)
    }
    if text.contains("429") || text.contains("too many requests") { return Self(.rateLimited) }
    if timedOut || text.contains("timed out") || text.contains("unable to download webpage")
      || text.contains("resolve host") || text.contains("network is unreachable")
    {
      return Self(.network)
    }
    if text.contains("video unavailable") || text.contains("private video")
      || text.contains("video has been removed")
    {
      return Self(.videoUnavailable)
    }
    return Self(.download)
  }
}
