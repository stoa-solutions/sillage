import AVFoundation
import RecallKit

// Speaks DJ replies with Gemini, or the macOS voice when the provider fails.
// The player is ducked while speaking and restored afterwards.
@MainActor
final class VoiceOutput: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
  private let player: Player
  private var task: Task<Void, Never>?
  private var audio: AVAudioPlayer?
  private let synthesizer = AVSpeechSynthesizer()
  var onFallback: (() -> Void)?

  init(player: Player) {
    self.player = player
    super.init()
    synthesizer.delegate = self
  }
  func speak(_ text: String, using synthesize: @escaping (String) async throws -> Data) {
    task?.cancel()
    task = Task {
      do {
        let data = try await synthesize(text)
        try Task.checkCancellation()
        let sound = try AVAudioPlayer(data: data)
        sound.delegate = self
        audio = sound
        player.command("duck")
        if !sound.play() { throw RecallError.message("L’audio n’a pas démarré.") }
      } catch {
        guard !Task.isCancelled else { return }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "fr-FR")
        player.command("duck")
        synthesizer.speak(utterance)
        onFallback?()
      }
    }
  }
  func stop() {
    task?.cancel()
    audio?.stop()
    audio = nil
    synthesizer.stopSpeaking(at: .immediate)
    player.command("restore")
  }
  nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    Task { @MainActor in self.player.command("restore") }
  }
  nonisolated func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance
  ) { Task { @MainActor in self.player.command("restore") } }
}
