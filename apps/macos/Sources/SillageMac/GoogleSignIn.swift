import AppKit
import CryptoKit
import Foundation
import SillageKit

@MainActor
final class GoogleSignIn {
  private var attempt: UUID?
  private var callback: GoogleCallback?
  private var continuation: CheckedContinuation<String, Error>?
  private var timeout: Task<Void, Never>?

  private func random() throws -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      throw SillageError.message("Impossible de préparer une connexion sécurisée.")
    }
    return Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
  func receive(_ url: URL) {
    guard let code = callback?.consume(url), let pending = continuation else { return }
    continuation = nil
    timeout?.cancel()
    pending.resume(returning: code)
    NSApp.activate(ignoringOtherApps: true)
  }
  func cancel() { finishWithError("Connexion annulée. Tu peux réessayer.") }

  private func finishWithError(_ message: String) {
    attempt = nil
    let pending = continuation
    continuation = nil
    callback = nil
    timeout?.cancel()
    pending?.resume(throwing: SillageError.message(message))
  }
  func connect(server: String) async throws -> Connection {
    guard attempt == nil else { throw SillageError.message("Une connexion est déjà en cours.") }
    let id = UUID()
    attempt = id
    defer { if attempt == id { attempt = nil } }
    let status = try await HTTPClient().json(url: URL(string: server + "/auth/status")!)
    guard attempt == id else { throw SillageError.message("Connexion annulée.") }
    guard status["google"] as? Bool == true else {
      throw SillageError.message("La connexion Google attend sa configuration sur le serveur.")
    }
    // A QA copy or an old app bundle may have registered the same callback scheme.
    // Bind the return to the app that actually started this login, before leaving for Google.
    guard Bundle.main.bundleIdentifier == "solutions.stoa.sillage" else {
      throw SillageError.message(
        "Cet aperçu ne permet pas la connexion. Ouvre Sillage dans Applications.")
    }
    let callbackURL = URL(string: "sillage://auth")!
    if NSWorkspace.shared.urlForApplication(toOpen: callbackURL)?.standardizedFileURL
      != Bundle.main.bundleURL.standardizedFileURL
    {
      try await NSWorkspace.shared.setDefaultApplication(
        at: Bundle.main.bundleURL, toOpenURLsWithScheme: "sillage")
    }
    guard attempt == id else { throw SillageError.message("Connexion annulée.") }
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
    defer {
      continuation = nil
      callback = nil
      timeout?.cancel()
    }
    let code: String = try await withCheckedThrowingContinuation { pending in
      continuation = pending
      callback = GoogleCallback(state: state)
      // Standard external-browser flow: no hidden macOS authentication sheet or Keychain lookup.
      guard NSWorkspace.shared.open(start.url!) else {
        continuation = nil
        pending.resume(throwing: SillageError.message("Impossible d’ouvrir ton navigateur."))
        return
      }
      timeout = Task { [weak self] in
        do { try await Task.sleep(nanoseconds: 600_000_000_000) } catch { return }
        guard self?.attempt == id else { return }
        self?.finishWithError("La connexion Google a expiré. Recommence depuis Sillage.")
      }
    }
    let result = try await HTTPClient().json(
      url: URL(string: server + "/auth/exchange")!, body: ["code": code, "verifier": verifier])
    guard let token = result["token"] as? String else {
      throw SillageError.message("Connexion incomplète.")
    }
    let connection = try Connection(url: server, token: token)
    guard attempt == id else {
      _ = try? await HTTPClient().server(connection, path: "logout", body: [:])
      throw SillageError.message("Connexion annulée.")
    }
    return connection
  }
}
