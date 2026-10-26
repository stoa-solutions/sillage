import Foundation

public enum AIProvider: String, Codable, CaseIterable, Identifiable, Sendable {
  case google, anthropic
  public var id: Self { self }
  public var name: String { self == .google ? "Gemini" : "Claude" }
  public var defaultModel: String {
    self == .google ? "gemini-3.5-flash-lite" : "claude-sonnet-5-5"
  }
  public var keyURL: URL {
    URL(
      string: self == .google
        ? "https://aistudio.google.com/api-keys"
        : "https://platform.claude.com/settings/keys")!
  }
}

public struct AIProviderStatus: Decodable, Sendable {
  public struct Model: Decodable, Identifiable, Sendable {
    public let id: String
    public let name: String
  }
  public let id: AIProvider
  public let configured: Bool
  public let model: String
  public let models: [Model]
}
