import Foundation

/// Foundation parses Markdown; the app only chooses how its semantic blocks are laid out.
public struct MessageMarkdown {
  public struct Block: Identifiable {
    public enum Kind: Equatable {
      case paragraph
      case heading(Int)
      case code, quote
      case list(marker: String, depth: Int)
    }
    public let id: Int
    public let kind: Kind
    public var text: AttributedString
  }
  public let blocks: [Block]
  public init(_ source: String, citations: [Int: URL] = [:]) {
    let parsed = (try? AttributedString(markdown: source)) ?? AttributedString(source)
    var result: [Block] = []
    for run in parsed.runs {
      let intent = run.presentationIntent
      let id = intent?.components.first?.identity ?? 0
      var kind = Block.Kind.paragraph
      var ordinal: Int?
      var ordered = false
      var depth = 0
      for component in intent?.components ?? [] {
        switch component.kind {
        case .header(let level): kind = .heading(level)
        case .codeBlock: kind = .code
        case .blockQuote: if kind == .paragraph { kind = .quote }
        case .listItem(let value): ordinal = value
        case .orderedList:
          ordered = true
          depth += 1
        case .unorderedList: depth += 1
        default: break
        }
      }
      if let ordinal { kind = .list(marker: ordered ? "\(ordinal)." : "•", depth: depth) }
      var text = AttributedString(parsed[run.range])
      if let link = run.link, !Self.isWebLink(link) { text.link = nil }
      if result.last?.id == id {
        result[result.count - 1].text.append(text)
      } else {
        result.append(Block(id: id, kind: kind, text: text))
      }
    }
    // Bare web URLs are links too, while code samples remain literal.
    let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
    for index in result.indices where result[index].kind != .code {
      var text = result[index].text
      let plain = String(text.characters)
      // Numeric citations returned by seekInformation use the supplied, verified source map.
      // Existing Markdown destinations and inline code always take precedence.
      let references = try? NSRegularExpression(pattern: #"\[(\d+)\]"#)
      for match in references?.matches(in: plain, range: NSRange(plain.startIndex..., in: plain))
        ?? []
      {
        guard let numberRange = Range(match.range(at: 1), in: plain),
          let number = Int(plain[numberRange]), let url = citations[number], Self.isWebLink(url),
          let range = Range(match.range, in: plain),
          let start = AttributedString.Index(range.lowerBound, within: text),
          let end = AttributedString.Index(range.upperBound, within: text),
          Self.canLink(text[start..<end])
        else { continue }
        text[start..<end].link = url
      }
      for match in detector?.matches(in: plain, range: NSRange(plain.startIndex..., in: plain))
        ?? []
      {
        guard let url = match.url, Self.isWebLink(url), let range = Range(match.range, in: plain),
          let start = AttributedString.Index(range.lowerBound, within: text),
          let end = AttributedString.Index(range.upperBound, within: text)
        else { continue }
        // Preserve Markdown links that already have a chosen label and destination.
        if Self.canLink(text[start..<end]) { text[start..<end].link = url }
      }
      result[index].text = text
    }
    blocks = result
  }
  private static func canLink(_ text: AttributedSubstring) -> Bool {
    text.runs.allSatisfy {
      $0.link == nil && $0.inlinePresentationIntent?.contains(.code) != true
    }
  }
  public static func isWebLink(_ url: URL) -> Bool {
    ["https", "http"].contains(url.scheme ?? "") && url.host != nil
      && url.user == nil && url.password == nil
  }
}
