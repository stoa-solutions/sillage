import AppKit
import Carbon.HIToolbox
import RecallKit
import SwiftUI

/// Réglages → Bureau: the global shortcut, the pill, the music during dictation and the Dock.
struct DeskSettings: View {
  @ObservedObject var desk: DeskIntegration
  @AppStorage("showsMenuBarExtra") private var showsMenuBar = true

  var body: some View {
    Section {
      LabeledContent("Parler au DJ") { ShortcutRecorder(desk: desk) }
      if !desk.shortcutIssue.isEmpty {
        Text(desk.shortcutIssue).font(.caption).foregroundStyle(.orange)
      }
      Text(
        "Maintiens le raccourci pour parler et relâche pour envoyer. Un appui bref garde le micro ouvert : appuie à nouveau pour envoyer, ou fais une pause de trois secondes."
      ).font(.callout).foregroundStyle(.secondary)
    } header: {
      Text("Raccourci global")
    }
    Section("Pendant la dictée") {
      Picker("Musique", selection: $desk.dictationMusic) {
        ForEach(DictationMusic.allCases, id: \.self) { Text($0.label).tag($0) }
      }
      Toggle("Afficher la pastille d’écoute", isOn: $desk.showsPill)
      LabeledContent("Aperçu") {
        Button {
          desk.pill.demo(shortcut: desk.shortcut)
        } label: {
          Label("Essayer", systemImage: "sparkles")
        }
      }.disabled(!desk.showsPill)
      Picker("Position", selection: $desk.pillPlacement) {
        ForEach(DeskPillPlacement.allCases) { Text($0.label).tag($0) }
      }.disabled(!desk.showsPill)
      Text(
        "En bas de l’écran, la pastille se déplace à la souris et garde sa place. Changer la position la replace au centre."
      ).font(.callout).foregroundStyle(.secondary)
    }
    Section("Barre des menus et Dock") {
      Toggle("Afficher Sillage dans la barre des menus", isOn: $showsMenuBar)
        .onChange(of: showsMenuBar) { _, _ in desk.applyDockPolicy() }
      Toggle("Masquer du Dock quand la fenêtre est fermée", isOn: $desk.hidesDockWhenClosed)
        .disabled(!showsMenuBar)
      Text(
        "Fermer la fenêtre met la musique en pause. Les touches lecture et suivant du clavier, les AirPods et le Centre de contrôle pilotent Sillage."
      ).font(.callout).foregroundStyle(.secondary)
    }
  }
}

/// A Raycast-style recorder: click, press the combination, done. Échap cancels, ⌫ removes.
struct ShortcutRecorder: View {
  @ObservedObject var desk: DeskIntegration
  @State private var recording = false
  @State private var hint = ""
  @State private var monitor: Any?

  var body: some View {
    HStack(spacing: 6) {
      Button(action: toggleRecording) {
        HStack(spacing: 6) {
          if recording {
            Text(hint.isEmpty ? "Tape le raccourci…" : hint)
              .font(.system(size: 12)).foregroundStyle(hint.isEmpty ? .secondary : Color.orange)
          } else if let shortcut = desk.shortcut {
            Keycaps(shortcut: shortcut, prominent: true)
          } else {
            Text("Enregistrer un raccourci").font(.system(size: 12)).foregroundStyle(.secondary)
          }
        }
        .frame(minWidth: 150, minHeight: 28).padding(.horizontal, 8)
        .background(
          RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.primary.opacity(0.06))
        )
        .overlay(
          RoundedRectangle(cornerRadius: 8, style: .continuous)
            .strokeBorder(Color.primary.opacity(0.12), lineWidth: 1)
        )
        .overlay {
          if recording {
            // A pulsing ring: the field is waiting for keys.
            RoundedRectangle(cornerRadius: 8, style: .continuous)
              .strokeBorder(Color.recall, lineWidth: 1.5)
              .phaseAnimator([0.35, 1]) { ring, phase in
                ring.opacity(phase)
              } animation: { _ in
                .easeInOut(duration: 0.7)
              }
          }
        }
        .animation(.smooth(duration: 0.2), value: recording)
        .animation(.smooth(duration: 0.25), value: desk.shortcut)
        .contentShape(Rectangle())
      }.buttonStyle(.plain)
        .accessibilityLabel(
          recording ? "Enregistrement du raccourci" : desk.shortcut?.display ?? "Aucun raccourci")
      if desk.shortcut != .standard {
        Button {
          desk.setShortcut(.standard)
        } label: {
          Image(systemName: "arrow.counterclockwise")
        }.buttonStyle(.borderless).help("Revenir à \(DeskShortcut.standard.display)")
      }
      if desk.shortcut != nil {
        Button {
          desk.setShortcut(nil)
        } label: {
          Image(systemName: "xmark.circle.fill")
        }.buttonStyle(.borderless).foregroundStyle(.secondary).help("Supprimer le raccourci")
      }
    }
    .onDisappear(perform: stopRecording)
  }

  private func toggleRecording() {
    recording ? stopRecording() : startRecording()
  }

  private func startRecording() {
    recording = true
    hint = ""
    desk.suspendShortcut()
    monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
      MainActor.assumeIsolated { record(event) }
      return nil
    }
  }

  private func stopRecording() {
    guard recording else { return }
    recording = false
    if let monitor { NSEvent.removeMonitor(monitor) }
    monitor = nil
    desk.resumeShortcut()
  }

  private func record(_ event: NSEvent) {
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    let code = Int(event.keyCode)
    if flags.isDisjoint(with: [.command, .option, .control, .shift]) {
      if code == kVK_Escape {
        stopRecording()
        return
      }
      if code == kVK_Delete || code == kVK_ForwardDelete {
        stopRecording()
        desk.setShortcut(nil)
        return
      }
    }
    var modifiers: DeskShortcut.Modifiers = []
    if flags.contains(.control) { modifiers.insert(.control) }
    if flags.contains(.option) { modifiers.insert(.option) }
    if flags.contains(.shift) { modifiers.insert(.shift) }
    if flags.contains(.command) { modifiers.insert(.command) }
    let shortcut = DeskShortcut(
      keyCode: UInt32(event.keyCode), modifiers: modifiers, key: Self.label(event))
    guard shortcut.isUsable else {
      hint = "Ajoute ⌃, ⌥ ou ⌘"
      NSSound.beep()
      return
    }
    stopRecording()
    desk.setShortcut(shortcut)
  }

  private static let named: [Int: String] = [
    kVK_Space: "Espace", kVK_Return: "↩", kVK_Tab: "⇥", kVK_Delete: "⌫",
    kVK_ForwardDelete: "⌦", kVK_Escape: "⎋", kVK_LeftArrow: "←", kVK_RightArrow: "→",
    kVK_UpArrow: "↑", kVK_DownArrow: "↓", kVK_Home: "↖", kVK_End: "↘", kVK_PageUp: "⇞",
    kVK_PageDown: "⇟", kVK_F1: "F1", kVK_F2: "F2", kVK_F3: "F3", kVK_F4: "F4", kVK_F5: "F5",
    kVK_F6: "F6", kVK_F7: "F7", kVK_F8: "F8", kVK_F9: "F9", kVK_F10: "F10", kVK_F11: "F11",
    kVK_F12: "F12",
  ]

  /// The key as printed on this keyboard layout, without the modifiers' effect.
  private static func label(_ event: NSEvent) -> String {
    if let name = named[Int(event.keyCode)] { return name }
    let base = event.charactersIgnoringModifiers?.uppercased() ?? ""
    return base.isEmpty ? "#\(event.keyCode)" : base
  }
}
