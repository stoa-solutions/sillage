import AppKit
import SillageKit
import SwiftUI

@testable import SillageMac

@main struct RenderChecks {
  @MainActor static func main() async throws {
    NSApplication.shared.setActivationPolicy(.prohibited)
    let output = URL(fileURLWithPath: CommandLine.arguments[1])
    let connection = try Connection(
      url: "https://lyrics.example.test", token: String(repeating: "x", count: 32))
    let track = Track(id: "aaaaaaaaaaa", title: "Fixture")
    let player = Player()
    for (name, lyrics) in [
      (
        "synced",
        Lyrics(
          status: .synced,
          lines: [
            LyricsLine(startMs: 0, endMs: 3000, text: "Première ligne de test"),
            LyricsLine(startMs: 3000, endMs: 6000, text: "Un même style dans chaque affichage"),
            LyricsLine(startMs: 6000, endMs: 9000, text: "Et la suite du morceau"),
          ], sourceName: "LRCLIB")
      ),
      (
        "plain",
        Lyrics(
          status: .plain, lines: [],
          text:
            "Première ligne de test\nUn même style dans chaque affichage\nEt la suite du morceau",
          sourceName: "LRCLIB")
      ),
      ("missing", Lyrics(status: .missing, lines: [])),
    ] {
      let model = LyricsModel(fetch: { _, _ in lyrics })
      model.show(track, next: nil, connection: connection)
      while model.loading { await Task.yield() }
      for width in [320, 380] {
        let root = LyricsPanel(model: model, player: player, connection: connection)
          .frame(width: CGFloat(width), height: 520).background(Color(white: 0.075))
          .preferredColorScheme(.dark)
        let host = NSHostingView(rootView: root)
        let window = NSWindow(
          contentRect: NSRect(x: -10000, y: -10000, width: width, height: 520),
          styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        host.frame = NSRect(x: 0, y: 0, width: width, height: 520)
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(120))
        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
          fatalError("No bitmap")
        }
        host.cacheDisplay(in: host.bounds, to: rep)
        guard let png = rep.representation(using: .png, properties: [:]) else {
          fatalError("No PNG")
        }
        try png.write(to: output.appendingPathComponent("\(name)-\(width).png"))
        window.contentView = nil
        window.close()
      }
      model.reset()
    }
    print("Rendered six production lyrics panels without opening a window or reading a session")
  }
}
