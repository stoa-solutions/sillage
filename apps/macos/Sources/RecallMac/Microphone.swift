import AVFoundation
import Combine
import RecallKit
import Speech

@MainActor final class Microphone: ObservableObject {
  @Published private(set) var listening = false
  @Published private(set) var transcript = ""
  private let engine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var tapInstalled = false
  private var generation = UUID()
  private var silenceTask: Task<Void, Never>?
  var onText: ((String) -> Void)?
  var onError: ((String) -> Void)?
  func toggle() async {
    if listening {
      stop(submit: true)
      return
    }
    let ticket = UUID()
    generation = ticket
    let micAllowed = await AVCaptureDevice.requestAccess(for: .audio)
    let speechStatus = await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
    }
    guard generation == ticket else { return }
    guard micAllowed, speechStatus == .authorized else {
      onError?(
        "Autorise Recall dans Réglages Système → Confidentialité et sécurité → Microphone et Reconnaissance vocale."
      )
      return
    }
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "fr-FR")),
      recognizer.isAvailable
    else {
      onError?("La dictée française est indisponible. Le chat reste utilisable.")
      return
    }
    do {
      transcript = ""
      let audioRequest = SFSpeechAudioBufferRecognitionRequest()
      audioRequest.shouldReportPartialResults = true
      audioRequest.taskHint = .dictation
      // Prefer on-device recognition when supported. Otherwise Apple's speech service may process audio.
      if recognizer.supportsOnDeviceRecognition { audioRequest.requiresOnDeviceRecognition = true }
      request = audioRequest
      let input = engine.inputNode
      let format = input.outputFormat(forBus: 0)
      guard format.sampleRate > 0 else {
        throw RecallError.message("Aucun micro utilisable. Vérifie l’entrée audio du Mac.")
      }
      input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
        audioRequest.append(buffer)
      }
      tapInstalled = true
      engine.prepare()
      try engine.start()
      listening = true
      task = recognizer.recognitionTask(with: audioRequest) { [weak self] result, error in
        Task { @MainActor in
          guard let self, self.generation == ticket, self.listening else { return }
          if let result {
            self.transcript = result.bestTranscription.formattedString
            self.silenceTask?.cancel()
            self.silenceTask = Task { [weak self] in
              try? await Task.sleep(nanoseconds: 1_800_000_000)
              guard !Task.isCancelled else { return }
              self?.stop(submit: true)
            }
            if result.isFinal { self.stop(submit: true) }
          } else if error != nil {
            self.stop(submit: false)
            self.onError?("La dictée s’est interrompue. Réessaie ou écris ton envie.")
          }
        }
      }
    } catch {
      stop(submit: false)
      onError?(error.localizedDescription)
    }
  }
  func stop(submit: Bool = false) {
    let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    generation = UUID()
    silenceTask?.cancel()
    silenceTask = nil
    listening = false
    engine.stop()
    if tapInstalled {
      engine.inputNode.removeTap(onBus: 0)
      tapInstalled = false
    }
    request?.endAudio()
    task?.cancel()
    task = nil
    request = nil
    if submit, !text.isEmpty { onText?(text) }
  }
}
