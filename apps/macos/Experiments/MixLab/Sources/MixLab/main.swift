import AVFoundation
import AudioKit
import Foundation

struct LabError: Error, LocalizedError {
  let errorDescription: String?
  init(_ text: String) { errorDescription = text }
}

func check(_ value: Bool, _ text: String) throws {
  if !value { throw LabError(text) }
}

/// Render in bounded blocks through AudioKit's real graph. Never opens an audio device.
func render(_ plan: Transition, first: URL, second: URL, output: URL) throws -> [String: Any] {
  let rate = 44100.0
  let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2)!
  try check(
    output.standardizedFileURL != first.standardizedFileURL
      && output.standardizedFileURL != second.standardizedFileURL,
    "La sortie ne doit pas remplacer un extrait source.")
  let fileA = try AVAudioFile(forReading: first)
  let fileB = try AVAudioFile(forReading: second)
  try check(
    Double(fileA.length) / fileA.processingFormat.sampleRate >= plan.segment,
    "Le premier extrait est trop court.")
  try check(
    Double(fileB.length) / fileB.processingFormat.sampleRate >= plan.segment,
    "Le second extrait est trop court.")
  guard let a = AudioPlayer(file: fileA, buffered: false),
    let b = AudioPlayer(file: fileB, buffered: false)
  else { throw LabError("Lecture AudioKit indisponible.") }
  let bassA = LowShelfFilter(a, cutoffFrequency: 180)
  let bassB = LowShelfFilter(b, cutoffFrequency: 180)
  let mixer = Mixer(bassA, bassB)
  // Reserve headroom for correlated peaks during overlap; no positive EQ boost in this pilot.
  mixer.volume = 0.65
  mixer.outputFormat = format
  let engine = AudioEngine()
  engine.outputAudioFormat = format
  engine.output = mixer
  let av = engine.avEngine
  try av.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 1024)
  try engine.start()
  defer {
    a.stop()
    b.stop()
    engine.stop()
  }
  var fileSettings = format.settings
  fileSettings.removeValue(forKey: AVLinearPCMIsNonInterleaved)
  let writer = try AVAudioFile(forWriting: output, settings: fileSettings)
  guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024) else {
    throw LabError("Allocation audio impossible.")
  }
  let total = AVAudioFramePosition((plan.duration * rate).rounded())
  let incoming = AVAudioFramePosition((plan.incomingStart * rate).rounded())
  var startedB = false
  var peak: Float = 0
  var sum: Double = 0
  var samples = 0
  var retries = 0
  var firstEnergy: Double = 0
  var lastEnergy: Double = 0
  let began = Date()
  a.play(from: 0, to: plan.segment)
  while av.manualRenderingSampleTime < total {
    let cursor = av.manualRenderingSampleTime
    if cursor >= incoming, !startedB {
      b.play(from: 0, to: plan.segment)
      startedB = true
    }
    let time = Double(cursor) / rate
    let gain = plan.gains(at: time)
    a.volume = gain.outgoing
    b.volume = gain.incoming
    let bass = plan.bass(at: time)
    bassA.gain = bass.outgoing
    bassB.gain = bass.incoming
    let boundary = cursor < incoming ? incoming : total
    let count = AVAudioFrameCount(min(1024, total - cursor, boundary - cursor))
    let status = try av.renderOffline(count, to: buffer)
    guard status == .success else {
      retries += 1
      try check(retries < 100, "Le rendu audio ne progresse pas.")
      continue
    }
    retries = 0
    try check(buffer.frameLength == count, "Le moteur a rendu un bloc incomplet.")
    guard let channels = buffer.floatChannelData else { throw LabError("Format PCM inattendu.") }
    for channel in 0..<Int(format.channelCount) {
      for i in 0..<Int(buffer.frameLength) {
        let value = channels[channel][i]
        try check(value.isFinite, "Échantillon audio invalide.")
        peak = max(peak, abs(value))
        let energy = Double(value * value)
        sum += energy
        samples += 1
        if time < 1 { firstEnergy += energy }
        if time > plan.duration - 1 { lastEnergy += energy }
      }
    }
    try writer.write(from: buffer)
  }
  try check(
    samples > 0 && firstEnergy > 0.001 && lastEnergy > 0.001,
    "Un des deux extraits est resté silencieux.")
  try check(peak < 1, "Le mix dépasse le niveau numérique maximal.")
  return [
    "mode": plan.mode.rawValue, "duration": plan.duration,
    "peak": peak, "rms": sqrt(sum / Double(samples)),
    "renderSeconds": Date().timeIntervalSince(began), "frames": total,
    "source": "AudioKit 5.7.2; offline PCM; two decks; no beat analysis",
  ]
}

/// Reproducible test signals, not a claim about the quality of transitions between songs.
func fixture(_ url: URL, frequency: Double, rate: Double = 44100) throws {
  let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2)!
  let count = AVAudioFrameCount(rate * 12)
  let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: count)!
  buffer.frameLength = count
  let channels = buffer.floatChannelData!
  for i in 0..<Int(count) {
    let time = Double(i) / rate
    // Distinct tones with a small 120 BPM pulse and click-free file boundaries.
    let pulse = exp(-20 * time.truncatingRemainder(dividingBy: 0.5))
    let edge = min(1, time * 100, (12 - time) * 100)
    let value = Float(
      (0.15 * sin(2 * .pi * frequency * time) + 0.1 * pulse * sin(2 * .pi * 70 * time)) * edge)
    for channel in 0..<2 { channels[channel][i] = value }
  }
  var fileSettings = format.settings
  fileSettings.removeValue(forKey: AVLinearPCMIsNonInterleaved)
  let file = try AVAudioFile(forWriting: url, settings: fileSettings)
  try file.write(from: buffer)
}

func run() throws {
  let args = Array(CommandLine.arguments.dropFirst())
  guard args.count == 1 || args.count == 3 else {
    throw LabError("Usage : MixLab <dossier-sortie> [extrait-a.wav extrait-b.wav]")
  }
  let out = URL(fileURLWithPath: args[0], isDirectory: true)
  try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
  let fixtures = args.count == 1
  let first = fixtures ? out.appendingPathComponent("signal-a.wav") : URL(fileURLWithPath: args[1])
  let second = fixtures ? out.appendingPathComponent("signal-b.wav") : URL(fileURLWithPath: args[2])
  if fixtures {
    try fixture(first, frequency: 220)
    try fixture(second, frequency: 330, rate: 48000)
  }
  for mode in [Transition.Mode.fade, .bassSwap] {
    let plan = Transition(mode: mode, segment: 12, overlap: 4)
    for step in 0...100 {
      let g = plan.gains(at: plan.incomingStart + 4 * Double(step) / 100)
      try check(
        abs(g.outgoing * g.outgoing + g.incoming * g.incoming - 1) < 0.00001,
        "L’enveloppe de transition n’est pas à puissance constante.")
    }
  }
  var results: [[String: Any]] = []
  for mode in Transition.Mode.allCases {
    results.append(
      try render(
        Transition(mode: mode, segment: 12, overlap: 4),
        first: first, second: second, output: out.appendingPathComponent(mode.rawValue + ".wav")))
  }
  if fixtures {
    let fade = results.first { ($0["mode"] as? String) == "fade" }!["rms"] as! Double
    let filtered = results.first { ($0["mode"] as? String) == "bassSwap" }!["rms"] as! Double
    try check(filtered < fade, "Le filtre n’a pas atténué les basses du signal témoin.")
  }
  let report: [String: Any] = [
    "synthetic": fixtures, "results": results,
    "installedAppChanged": false, "beatMatching": false, "videoSynchronization": "not integrated",
  ]
  try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    .write(to: out.appendingPathComponent("results.json"))
  print(
    String(
      data: try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]),
      encoding: .utf8)!)
}

do { try run() } catch {
  fputs(error.localizedDescription + "\n", stderr)
  exit(1)
}
