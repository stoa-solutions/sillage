import AVFoundation
import Combine
import SillageKit
import Speech

@MainActor public final class InputMeter: ObservableObject {
  /// 0…1, zero when the microphone is closed.
  @Published public internal(set) var level: Float = 0
}

@MainActor public final class Microphone: ObservableObject {
  @Published public private(set) var listening = false
  @Published public private(set) var starting = false
  @Published public private(set) var finishing = false
  @Published public private(set) var transcript = ""
  /// Input loudness for the listening waveform, published apart so screens that only show the
  /// dictation state are not redrawn for every audio buffer.
  public let meter = InputMeter()
  public var active: Bool { starting || listening || finishing }
  public var status: String {
    if starting { return "Autorisation et préparation du micro…" }
    if finishing { return "Je termine la transcription…" }
    return transcript.isEmpty ? "Je t’écoute… Clique pour envoyer ta demande." : transcript
  }
  private var engine: AVAudioEngine?
  private var recognizer: SFSpeechRecognizer?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var tapInstalled = false
  private var generation = UUID()
  private var silenceTask: Task<Void, Never>?
  private var deadlineTask: Task<Void, Never>?
  private var finalTask: Task<Void, Never>?
  public var onText: ((String) -> Void)?
  public var onError: ((String) -> Void)?

  private let microphonePermission: () async -> Bool
  private let speechPermission: () async -> SFSpeechRecognizerAuthorizationStatus
  public init(
    microphonePermission: @escaping () async -> Bool = {
      await AVCaptureDevice.requestAccess(for: .audio)
    },
    speechPermission: @escaping () async -> SFSpeechRecognizerAuthorizationStatus = {
      await withCheckedContinuation { continuation in
        SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
      }
    }
  ) {
    self.microphonePermission = microphonePermission
    self.speechPermission = speechPermission
  }

  public func toggle() async {
    if starting {
      stop()
      return
    }
    if finishing { return }
    if listening {
      finish()
      return
    }
    stop()
    let ticket = generation
    starting = true
    let micAllowed = await microphonePermission()
    guard generation == ticket else { return }
    guard micAllowed else {
      fail("Autorise Sillage dans Réglages Système → Confidentialité et sécurité → Microphone.")
      return
    }
    let speechStatus = await speechPermission()
    guard generation == ticket else { return }
    guard speechStatus == .authorized else {
      fail(
        "Autorise Sillage dans Réglages Système → Confidentialité et sécurité → Reconnaissance vocale."
      )
      return
    }
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "fr-FR")),
      recognizer.isAvailable
    else {
      fail("La dictée française est indisponible. Vérifie ta connexion ou utilise le chat.")
      return
    }
    self.recognizer = recognizer
    do {
      transcript = ""
      // Recreate the engine for each session so a changed input device is picked up.
      let engine = AVAudioEngine()
      self.engine = engine
      let input = engine.inputNode
      let hardware = input.inputFormat(forBus: 0)
      guard hardware.sampleRate > 0, hardware.channelCount > 0 else {
        throw SillageError.message(
          "Aucun micro utilisable. Vérifie l’entrée audio dans Réglages Système → Son.")
      }
      let audioRequest = SFSpeechAudioBufferRecognitionRequest()
      audioRequest.shouldReportPartialResults = true
      audioRequest.taskHint = .dictation
      // Apple may process speech online; do not force an unavailable local language model.
      request = audioRequest
      input.installTap(onBus: 0, bufferSize: 1024, format: hardware) { [weak self] buffer, _ in
        audioRequest.append(buffer)
        let loudness = Self.loudness(buffer)
        Task { @MainActor in
          guard let self, self.generation == ticket, self.listening else { return }
          self.meter.level = loudness
        }
      }
      tapInstalled = true
      starting = false
      listening = true
      task = recognizer.recognitionTask(with: audioRequest) { [weak self] result, error in
        Task { @MainActor in
          guard let self, self.generation == ticket, self.listening || self.finishing else {
            return
          }
          if let result {
            let text = result.bestTranscription.formattedString
            let changed = text != self.transcript
            self.transcript = text
            if result.isFinal {
              self.complete()
              return
            }
            if changed, self.listening, !text.isEmpty { self.scheduleSilence(ticket) }
          }
          if error != nil {
            if self.finishing, !self.transcript.isEmpty {
              self.complete()
            } else {
              self.fail(
                "La dictée s’est interrompue. Vérifie le micro et la connexion, puis réessaie.")
            }
          }
        }
      }
      engine.prepare()
      try engine.start()
      deadlineTask = Task { [weak self] in
        try? await Task.sleep(nanoseconds: 55_000_000_000)
        guard !Task.isCancelled, let self, self.generation == ticket else { return }
        self.finish()
      }
    } catch { fail(error.localizedDescription) }
  }

  private func scheduleSilence(_ ticket: UUID) {
    silenceTask?.cancel()
    silenceTask = Task { [weak self] in
      try? await Task.sleep(nanoseconds: 3_000_000_000)
      guard !Task.isCancelled, let self, self.generation == ticket else { return }
      self.finish()
    }
  }
  /// Root mean square of the first channel, mapped from -50…0 dBFS to 0…1.
  private nonisolated static func loudness(_ buffer: AVAudioPCMBuffer) -> Float {
    guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
    var sum: Float = 0
    for index in 0..<Int(buffer.frameLength) { sum += samples[index] * samples[index] }
    let rms = (sum / Float(buffer.frameLength)).squareRoot()
    let decibels = 20 * log10(max(rms, 0.000_01))
    return min(1, max(0, (decibels + 50) / 50))
  }
  private func stopCapture() {
    engine?.stop()
    if tapInstalled {
      engine?.inputNode.removeTap(onBus: 0)
      tapInstalled = false
    }
  }
  private func finish() {
    guard listening else { return }
    listening = false
    finishing = true
    meter.level = 0
    silenceTask?.cancel()
    deadlineTask?.cancel()
    stopCapture()
    // endAudio/finish allow final recognition; cancellation would discard pending words.
    request?.endAudio()
    task?.finish()
    let ticket = generation
    finalTask = Task { [weak self] in
      try? await Task.sleep(nanoseconds: 4_000_000_000)
      guard !Task.isCancelled, let self, self.generation == ticket else { return }
      self.complete()
    }
  }
  private func complete() {
    let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    stop()
    if text.isEmpty {
      onError?("Je n’ai pas entendu de parole. Vérifie l’entrée audio et réessaie.")
    } else {
      onText?(text)
    }
  }
  private func fail(_ message: String) {
    stop()
    onError?(message)
  }
  public func stop(submit: Bool = false) {
    if submit, listening {
      finish()
      return
    }
    generation = UUID()
    silenceTask?.cancel()
    silenceTask = nil
    deadlineTask?.cancel()
    deadlineTask = nil
    finalTask?.cancel()
    finalTask = nil
    starting = false
    listening = false
    finishing = false
    meter.level = 0
    stopCapture()
    request?.endAudio()
    task?.cancel()
    task = nil
    request = nil
    recognizer = nil
    engine = nil
  }
}
