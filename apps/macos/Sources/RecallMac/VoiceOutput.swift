import AVFoundation
import Combine
import RecallKit

// Speaks DJ replies with Gemini, or the macOS voice when the provider fails.
// The player is ducked while speaking and restored afterwards.
@MainActor
final class VoiceOutput: NSObject, ObservableObject, AVAudioPlayerDelegate,
  AVSpeechSynthesizerDelegate
{
  @Published private(set) var status = ""
  private let player: Player
  private var task: Task<Void, Never>?
  private var audio: AVAudioPlayer?
  private let synthesizer = AVSpeechSynthesizer()
  private var currentUtterance: AVSpeechUtterance?
  var onFallback: (() -> Void)?

  init(player: Player) {
    self.player = player
    super.init()
    synthesizer.delegate = self
  }
  func speak(_ text: String, using synthesize: @escaping (String) async throws -> Data) {
    stop()
    status = "Le DJ prépare sa voix…"
    task = Task {
      do {
        let data = try await synthesize(text)
        try Task.checkCancellation()
        let sound = try AVAudioPlayer(data: data)
        sound.delegate = self
        audio = sound
        player.command("duck")
        if !sound.play() { throw RecallError.message("L’audio n’a pas démarré.") }
        status = "Le DJ parle · voix Gemini"
      } catch {
        guard !Task.isCancelled else { return }
        speakLocally(text)
        onFallback?()
      }
    }
  }
  func speakLocally(_ text: String) {
    stop()
    let utterance = AVSpeechUtterance(string: text)
    currentUtterance = utterance
    utterance.voice = AVSpeechSynthesisVoice(language: "fr-FR")
    player.command("duck")
    synthesizer.speak(utterance)
    status = "Le DJ parle · voix macOS"
  }
  func stop() {
    task?.cancel()
    audio?.stop()
    audio = nil
    currentUtterance = nil
    synthesizer.stopSpeaking(at: .immediate)
    player.command("restore")
    status = ""
  }
  nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    Task { @MainActor in
      guard self.audio === player else { return }
      self.audio = nil
      self.player.command("restore")
      self.status = ""
    }
  }
  nonisolated func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance
  ) {
    Task { @MainActor in
      guard self.currentUtterance === utterance else { return }
      self.currentUtterance = nil
      self.player.command("restore")
      self.status = ""
    }
  }
}
