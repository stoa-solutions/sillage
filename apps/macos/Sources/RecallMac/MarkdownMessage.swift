import RecallKit
import SwiftUI

/// Use Foundation's real Markdown parser, with native selection and safe clickable web links.
struct MarkdownMessage: View {
  private let source: String
  @StateObject private var rendered: MarkdownContent
  init(_ source: String) {
    self.source = source
    _rendered = StateObject(wrappedValue: MarkdownContent(source))
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
          }.padding(10).background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
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
      .onChange(of: source) { _, value in rendered.update(value) }
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
  init(_ source: String) {
    self.source = source
    blocks = MessageMarkdown(source).blocks
  }
  func update(_ value: String) {
    guard value != source else { return }
    source = value
    blocks = MessageMarkdown(value).blocks
  }
}
