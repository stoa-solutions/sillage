import Foundation
import RecallKit

func studioPresentationChecks() throws {
  var chrome = StudioChrome()
  chrome.configure(enabled: true, at: 10)
  try expect(chrome.visible(at: 12.9), "Studio hid its controls before the inactivity delay")
  try expect(!chrome.visible(at: 13), "Studio never hid idle controls")
  chrome.interact(at: 13.5)
  try expect(chrome.visible(at: 14), "Mouse/keyboard activity did not restore controls")
  try expect(!chrome.visible(at: 16.5), "Idle deadline did not move after interaction")
  chrome.configure(enabled: false, at: 17)
  try expect(chrome.visible(at: 100), "Paused/reading pages lost their controls")
  chrome.configure(enabled: true, at: 101)
  try expect(chrome.visible(at: 101), "Entering Studio reused an expired idle deadline")

  let markdown = MessageMarkdown(
    "# Un artiste\n\nDu **gras** et [une source](https://example.com/article).\n\n- Premier\n- Deuxième\n\n> Une citation\n\n```swift\nlet url = \"https://example.com\"\n```"
  )
  try expect(markdown.blocks.count == 6, "Markdown paragraphs or list items merged")
  try expect(markdown.blocks[0].kind == .heading(1), "Markdown heading lost semantics")
  try expect(
    markdown.blocks[2].kind == .list(marker: "•", depth: 1), "Markdown list lost its marker")
  try expect(markdown.blocks[4].kind == .quote, "Markdown quote lost semantics")
  try expect(markdown.blocks[5].kind == .code, "Code fence lost semantics")
  try expect(
    markdown.blocks[1].text.runs.contains { $0.link?.host == "example.com" },
    "Markdown link is not clickable")
  try expect(
    markdown.blocks[1].text.runs.contains {
      $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true
    }, "Bold formatting lost")
  let numbered = MessageMarkdown("3. Trois\n4. Quatre")
  try expect(
    numbered.blocks[0].kind == .list(marker: "3.", depth: 1), "Ordered list renumbered incorrectly")
  let literal = MessageMarkdown("Un lien 🎵 https://example.com/source et [non](javascript:alert).")
  try expect(
    literal.blocks.flatMap { Array($0.text.runs) }.contains {
      $0.link?.absoluteString == "https://example.com/source"
    }, "Bare URL/Unicode offsets lost")
  try expect(
    !literal.blocks.flatMap { Array($0.text.runs) }.contains { $0.link?.scheme == "javascript" },
    "Unsafe Markdown link remained active")
  try expect(
    !markdown.blocks[5].text.runs.contains { $0.link != nil },
    "Code sample gained an interactive link")
  print(
    "Studio presentation checks passed: inactivity, restore, pause, Markdown semantics and safe links"
  )
}
