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
  private let engine: PlaybackEngine
  private var task: Task<Void, Never>?
  private let prepared = PreparedSpeech()
  private var preparation: Task<Void, Never>?
  private var preparationKey: String?
  private var audio: AVAudioPlayer?
  private let synthesizer = AVSpeechSynthesizer()
  private var currentUtterance: AVSpeechUtterance?
  var onFallback: (() -> Void)?
  var onCloudPlayback: (() -> Void)?

  init(engine: PlaybackEngine) {
    self.engine = engine
    super.init()
    synthesizer.delegate = self
  }
  func speak(
    _ text: String, context: String, using synthesize: @escaping (String) async throws -> Data
  ) {
    stop()
    status = "Le DJ prépare sa voix…"
    task = Task {
      do {
        let key = context + ":" + text
        let cached = try await prepared.take(key: key)
        let data: Data
        if let cached { data = cached } else { data = try await synthesize(text) }
        try Task.checkCancellation()
        let sound = try AVAudioPlayer(data: data)
        sound.delegate = self
        audio = sound
        engine.duck(true)
        if !sound.play() { throw RecallError.message("L’audio n’a pas démarré.") }
        status = "Le DJ parle · voix Gemini"
        onCloudPlayback?()
      } catch {
        guard !Task.isCancelled else { return }
        speakLocally(text)
        onFallback?()
      }
    }
  }
  func prepare(
    _ text: String, context: String, using synthesize: @escaping (String) async throws -> Data
  ) {
    let key = context + ":" + text
    guard preparationKey != key else { return }
    clearPreparation()
    preparationKey = key
    let active = task
    preparation = Task {
      // Serialize provider calls; the account permits one speech request at a time.
      await active?.value
      guard !Task.isCancelled else { return }
      prepared.prepare(key: key) { try await synthesize(text) }
    }
  }
  func clearPreparation() {
    preparation?.cancel()
    preparation = nil
    preparationKey = nil
    prepared.clear()
  }
  func speakLocally(_ text: String) {
    stop()
    let utterance = AVSpeechUtterance(string: text)
    currentUtterance = utterance
    utterance.voice = AVSpeechSynthesisVoice(language: "fr-FR")
    engine.duck(true)
    synthesizer.speak(utterance)
    status = "Le DJ parle · voix macOS"
  }
  func stop() {
    task?.cancel()
    audio?.stop()
    audio = nil
    currentUtterance = nil
    synthesizer.stopSpeaking(at: .immediate)
    engine.duck(false)
    status = ""
  }
  nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    Task { @MainActor in
      guard self.audio === player else { return }
      self.audio = nil
      self.engine.duck(false)
      self.status = ""
    }
  }
  nonisolated func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance
  ) {
    Task { @MainActor in
      guard self.currentUtterance === utterance else { return }
      self.currentUtterance = nil
      self.engine.duck(false)
      self.status = ""
    }
  }
}
