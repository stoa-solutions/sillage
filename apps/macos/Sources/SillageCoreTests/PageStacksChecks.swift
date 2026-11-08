import Foundation
import SillageKit

/// Pages over tabs: each tab its own stack, no duplicate on top, « Retour » one page at a time.
func pageStacksChecks() throws {
  enum Tab { case dj, library }
  var stacks = PageStacks<Tab, String>()
  try expect(stacks.current(in: .dj) == nil && !stacks.back(in: .dj), "Empty stack went back")
  stacks.open("Mac Miller", in: .library)
  stacks.open("Mac Miller", in: .library)
  try expect(
    stacks.current(in: .library) == "Mac Miller" && stacks.previous(in: .library) == nil,
    "Opening the page already shown stacked a duplicate")
  stacks.open("Swimming", in: .library)
  try expect(
    stacks.previous(in: .library) == "Mac Miller" && stacks.current(in: .dj) == nil,
    "A page opened over Bibliothèque leaked into DJ")
  try expect(stacks.back(in: .library) && stacks.current(in: .library) == "Mac Miller", "Back")
  stacks.open("Swimming", in: .dj)
  stacks.clear(.dj)
  try expect(
    stacks.current(in: .dj) == nil && stacks.current(in: .library) == "Mac Miller",
    "Clearing one tab touched another")
}
