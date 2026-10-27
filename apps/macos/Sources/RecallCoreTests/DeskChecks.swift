import Foundation
import RecallKit

func deskChecks() throws {
  // Hold: release after the threshold sends at once.
  var gesture = PushToTalkGesture()
  try expect(gesture.pressed(at: 10) == .start, "Press did not start dictation")
  try expect(gesture.pressed(at: 10.1) == nil, "Key repeat restarted dictation")
  try expect(gesture.released(at: 11) == .submit, "Hold release did not send")
  try expect(!gesture.listening, "Hold stayed listening after release")

  // Tap: keeps listening hands-free; the next press sends and its release does nothing.
  try expect(gesture.pressed(at: 20) == .start, "Tap did not start dictation")
  try expect(gesture.released(at: 20.1) == nil, "Tap sent immediately")
  try expect(gesture.listening, "Tap did not keep listening")
  try expect(gesture.pressed(at: 25) == .submit, "Second tap did not send")
  try expect(gesture.released(at: 25.1) == nil, "Closing release started a new dictation")
  try expect(gesture.pressed(at: 30) == .start, "Gesture did not return to idle")

  // Silence ends the dictation while the key is still held: that release stays silent.
  gesture.dictationEnded(keyHeld: true)
  try expect(gesture.released(at: 40) == nil, "Release after silence acted")
  try expect(gesture.pressed(at: 41) == .start, "Gesture stuck after silence")

  // Permissions still pending at release: the request stays open hands-free.
  gesture.releasedWhileStarting()
  try expect(gesture.listening, "Release during permission prompt cancelled dictation")
  gesture.dictationEnded(keyHeld: false)
  try expect(!gesture.listening, "Ended dictation still listening")

  let standard = DeskShortcut.standard
  try expect(standard.display == "⌥ ⇧ Espace", "Default shortcut label changed")
  try expect(standard.isUsable, "Default shortcut unusable")
  let shiftOnly = DeskShortcut(keyCode: 2, modifiers: [.shift], key: "D")
  try expect(!shiftOnly.isUsable, "Shift-only shortcut accepted")
  let all = DeskShortcut(keyCode: 2, modifiers: [.command, .shift, .control, .option], key: "D")
  try expect(all.keycaps == ["⌃", "⌥", "⇧", "⌘", "D"], "Keycaps out of Apple order")
  let decoded = try JSONDecoder().decode(DeskShortcut.self, from: JSONEncoder().encode(all))
  try expect(decoded == all, "Shortcut did not survive storage")
  print("Desk checks passed: hold, tap, silence, pending permissions, shortcut storage")
}
