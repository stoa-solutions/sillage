import Foundation

/// Pages opened over tabs (an artist, then an album…): each tab keeps its own stack, so going
/// back lands exactly where that tab was left. No UI: the window maps tabs and pages to views.
public struct PageStacks<Tab: Hashable, Page: Hashable>: Equatable {
  private var stacks: [Tab: [Page]] = [:]
  public init() {}

  /// The page shown over the tab, if any.
  public func current(in tab: Tab) -> Page? { stacks[tab]?.last }
  /// The page under the current one: what « Retour » leads to when it is not the tab itself.
  public func previous(in tab: Tab) -> Page? {
    guard let stack = stacks[tab], stack.count > 1 else { return nil }
    return stack[stack.count - 2]
  }
  /// Opening the page already on top does nothing: a second click never stacks a duplicate.
  public mutating func open(_ page: Page, in tab: Tab) {
    guard stacks[tab]?.last != page else { return }
    stacks[tab, default: []].append(page)
  }
  /// Closes the top page; false when the tab shows no page.
  @discardableResult public mutating func back(in tab: Tab) -> Bool {
    stacks[tab]?.popLast() != nil
  }
  /// Back to the tab itself.
  public mutating func clear(_ tab: Tab) { stacks[tab] = nil }
}
