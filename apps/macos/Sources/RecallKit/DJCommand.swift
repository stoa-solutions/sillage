import Foundation

/// Explicit shortcuts are local commands, never ambiguous prose sent to a model.
public enum DJCommand: Equatable, Sendable {
  case next, pause, resume
  case prepare(Int)
  case help, rules, invalid
  public static let suggestions = [
    (command: "/suite 5", label: "Préparer 5 nouveaux titres"),
    (command: "/suivant", label: "Passer au titre suivant"),
    (command: "/pause", label: "Mettre en pause"),
    (command: "/reprendre", label: "Reprendre la lecture"),
    (command: "/prompt", label: "Consulter les règles du DJ"),
    (command: "/aide", label: "Voir les commandes"),
  ]
  public static var helpText: String {
    suggestions.map { "\($0.command) — \($0.label)" }.joined(separator: "\n")
      + "\n/suite accepte de 1 à 8 titres. Si les sources n’en fournissent pas assez, le DJ le précise. Les règles sont consultables ; les skills personnalisés ne sont pas encore activés."
  }
  public static func parse(_ text: String) -> Self {
    let words = text.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
    guard let first = words.first else { return .invalid }
    if first == "/suite" {
      guard words.count <= 2, let count = Int(words.count == 2 ? words[1] : "5"),
        (1...8).contains(count)
      else { return .invalid }
      return .prepare(count)
    }
    guard words.count == 1 else { return .invalid }
    switch first {
    case "/suivant", "/next": return .next
    case "/pause": return .pause
    case "/reprendre", "/play": return .resume
    case "/aide", "/help", "/": return .help
    case "/prompt": return .rules
    default: return .invalid
    }
  }
}
