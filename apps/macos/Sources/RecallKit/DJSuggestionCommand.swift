import Foundation

/// Explicit references to the visible cards are resolved before calling an AI.
/// This uses the same verified tracks as clicking their Play / Queue buttons.
public struct DJSuggestionCommand: Sendable {
  public let indices: [Int]
  public let append: Bool

  public static func parse(_ text: String, count: Int) -> Self? {
    let words = text.folding(
      options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "fr_FR")
    )
    .components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(
      separator: " ")
    let pattern =
      #"^(?:mets|met|joue|lance|ajoute|rajoute|ecoute)(?: moi)? (le premier|la premiere|le deuxieme|la deuxieme|le troisieme|la troisieme|le dernier|la derniere|le [1-8]|la [1-8]|le un|le deux|le trois|les trois|les deux|les [1-8]|les tous|tout|tous|ces morceaux)(?: (?:en file d attente|dans la file|dans la queue|a la suite|maintenant|directement|tout de suite|stp|s il te plait))*$"#
    guard let match = words.range(of: pattern, options: .regularExpression) else { return nil }
    let phrase = String(words[match])
    let references = [
      "premier": 0, "premiere": 0, "deuxieme": 1, "troisieme": 2,
      "un": 0, "deux": 1, "trois": 2,
    ]
    let tokens = phrase.split(separator: " ").map(String.init)
    let plural =
      tokens.contains("les") || phrase.contains("ces morceaux") || tokens.contains("tous")
      || tokens.contains("tout")
    let index = tokens.compactMap { references[$0] ?? Int($0).map { $0 - 1 } }.first
    let indices: [Int]
    if plural {
      indices = Array(0..<(index.map { $0 + 1 } ?? count))
    } else {
      indices = [
        tokens.contains("dernier") || tokens.contains("derniere") ? count - 1 : index ?? -1
      ]
    }
    let immediate = ["maintenant", "directement", "tout de suite"].contains { phrase.contains($0) }
    let deferred =
      ["file", "queue", "suite"].contains { tokens.contains($0) }
      || tokens.contains("ajoute") || tokens.contains("rajoute")
    return Self(indices: indices, append: deferred && !immediate)
  }
}
