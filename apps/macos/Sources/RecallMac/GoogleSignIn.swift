import AppKit
import CryptoKit
import Foundation
import RecallKit

@MainActor
final class GoogleSignIn {
  private var attempt: UUID?
  private var callback: GoogleCallback?
  private var continuation: CheckedContinuation<String, Error>?
  private var timeout: Task<Void, Never>?

  private func random() throws -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      throw RecallError.message("Impossible de préparer une connexion sécurisée.")
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
  func cancel() {
    attempt = nil
    let pending = continuation
    continuation = nil
    callback = nil
    timeout?.cancel()
    pending?.resume(throwing: RecallError.message("Connexion annulée. Tu peux réessayer."))
  }
  func connect(server: String) async throws -> Connection {
    guard attempt == nil else { throw RecallError.message("Une connexion est déjà en cours.") }
    let id = UUID()
    attempt = id
    defer { if attempt == id { attempt = nil } }
    let status = try await HTTPClient().json(url: URL(string: server + "/auth/status")!)
    guard attempt == id else { throw RecallError.message("Connexion annulée.") }
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
        pending.resume(throwing: RecallError.message("Impossible d’ouvrir ton navigateur."))
        return
      }
      timeout = Task { [weak self] in
        do { try await Task.sleep(nanoseconds: 600_000_000_000) } catch { return }
        self?.cancel()
      }
    }
    let result = try await HTTPClient().json(
      url: URL(string: server + "/auth/exchange")!, body: ["code": code, "verifier": verifier])
    guard let token = result["token"] as? String else {
      throw RecallError.message("Connexion incomplète.")
    }
    let connection = try Connection(url: server, token: token)
    guard attempt == id else {
      _ = try? await HTTPClient().server(connection, path: "logout", body: [:])
      throw RecallError.message("Connexion annulée.")
    }
    return connection
  }
}
