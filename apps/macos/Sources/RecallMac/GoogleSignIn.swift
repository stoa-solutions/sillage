import AppKit
import AuthenticationServices
import CryptoKit
import Foundation
import RecallKit

@MainActor
final class GoogleSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
  private var webSession: ASWebAuthenticationSession?
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    NSApp.keyWindow ?? NSApp.windows.first ?? ASPresentationAnchor()
  }
  private func random() throws -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      throw RecallError.message("Impossible de préparer une connexion sécurisée.")
    }
    return Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
  func connect(server: String) async throws -> Connection {
    guard webSession == nil else { throw RecallError.message("Une connexion est déjà en cours.") }
    let status = try await HTTPClient().json(url: URL(string: server + "/auth/status")!)
    guard status["google"] as? Bool == true else {
      throw RecallError.message("La connexion Google attend sa configuration sur le serveur.")
    }
    let verifier = try random()
    let state = try random()
    let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
    var start = URLComponents(string: server + "/auth/google/start")!
    start.queryItems = [
      URLQueryItem(name: "challenge", value: challenge),
      URLQueryItem(name: "app_state", value: state),
    ]
    defer { webSession = nil }
    let callback: URL = try await withCheckedThrowingContinuation { continuation in
      let session = ASWebAuthenticationSession(
        url: start.url!, callbackURLScheme: "playlist-recall"
      ) { url, error in
        if let url {
          continuation.resume(returning: url)
        } else {
          continuation.resume(throwing: error ?? RecallError.message("Connexion annulée."))
        }
      }
      session.presentationContextProvider = self
      // Use the user's browser Google session; Google still asks which account to use.
      session.prefersEphemeralWebBrowserSession = false
      self.webSession = session
      if !session.start() {
        continuation.resume(
          throwing: RecallError.message("Impossible d’ouvrir la connexion Google."))
      }
    }
    let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
    guard callback.scheme == "playlist-recall", callback.host == "auth",
      items.first(where: { $0.name == "state" })?.value == state,
      let code = items.first(where: { $0.name == "code" })?.value
    else { throw RecallError.message("Cette réponse de connexion n’est pas destinée à Recall.") }
    let result = try await HTTPClient().json(
      url: URL(string: server + "/auth/exchange")!, body: ["code": code, "verifier": verifier])
    guard let token = result["token"] as? String else {
      throw RecallError.message("Connexion incomplète.")
    }
    return try Connection(url: server, token: token)
  }
}
