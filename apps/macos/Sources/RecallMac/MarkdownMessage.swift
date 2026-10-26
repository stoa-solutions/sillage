import RecallKit
import SwiftUI

/// Use Foundation's real Markdown parser, with native selection and safe clickable web links.
struct MarkdownMessage: View {
  private let source: String
  private let citations: [Int: URL]
  @StateObject private var rendered: MarkdownContent
  init(_ source: String, sources: [InformationSource] = []) {
    self.source = source
    let citations = sources.reduce(into: [Int: URL]()) { result, item in
      if let url = item.safeURL { result[item.id] = url }
    }
    self.citations = citations
    _rendered = StateObject(wrappedValue: MarkdownContent(source, citations: citations))
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 9) {
      ForEach(rendered.blocks) { block in
        switch block.kind {
        case .heading(let level):
          Text(block.text).font(level == 1 ? .title3.weight(.semibold) : .headline)
        case .code:
          ScrollView(.horizontal) {
            Text(block.text).font(.system(.callout, design: .monospaced)).fixedSize(
              horizontal: true, vertical: false)
          }.padding(10).background(Color.sillageHover, in: RoundedRectangle(cornerRadius: 8))
        case .quote:
          HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 1).fill(.secondary.opacity(0.4)).frame(width: 2)
            Text(block.text).foregroundStyle(.secondary)
          }.fixedSize(horizontal: false, vertical: true)
        case .list(let marker, let depth):
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(marker).foregroundStyle(.secondary).frame(minWidth: 12, alignment: .trailing)
            Text(block.text).frame(maxWidth: .infinity, alignment: .leading)
          }.padding(.leading, CGFloat(max(0, depth - 1)) * 14)
        case .paragraph:
          Text(block.text).frame(maxWidth: .infinity, alignment: .leading)
        }
      }
    }.textSelection(.enabled).lineSpacing(2).tint(.recall)
      .onChange(of: source) { _, value in rendered.update(value, citations: citations) }
      .onChange(of: citations) { _, value in rendered.update(source, citations: value) }
      .environment(
        \.openURL,
        OpenURLAction { url in
          MessageMarkdown.isWebLink(url) ? .systemAction : .discarded
        })
  }
}

/// Playback ticks must not parse every old message again. Each bubble owns its rendered text.
@MainActor private final class MarkdownContent: ObservableObject {
  @Published private(set) var blocks: [MessageMarkdown.Block]
  private var source: String
  private var citations: [Int: URL]
  init(_ source: String, citations: [Int: URL]) {
    self.source = source
    self.citations = citations
    blocks = MessageMarkdown(source, citations: citations).blocks
  }
  func update(_ value: String, citations: [Int: URL]) {
    guard value != source || self.citations != citations else { return }
    source = value
    self.citations = citations
    blocks = MessageMarkdown(value, citations: citations).blocks
  }
}
