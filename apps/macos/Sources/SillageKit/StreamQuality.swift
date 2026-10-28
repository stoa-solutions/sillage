import AVFoundation

/// What is on screen and in the speakers: the downloaded clip as its file says, or what the
/// YouTube player reports. Nothing is guessed: an unknown part stays nil.
public struct StreamQuality: Equatable, Sendable {
  public enum Origin: Equatable, Sendable { case clip, youtube }
  public let origin: Origin
  public var height: Int?
  public var frameRate: Double?
  public var videoCodec: String?
  public var audioCodec: String?
  public var audioKbps: Int?
  public var sampleRate: Double?
  public var channels: Int?

  public init(
    origin: Origin, height: Int? = nil, frameRate: Double? = nil, videoCodec: String? = nil,
    audioCodec: String? = nil, audioKbps: Int? = nil, sampleRate: Double? = nil,
    channels: Int? = nil
  ) {
    self.origin = origin
    self.height = height
    self.frameRate = frameRate
    self.videoCodec = videoCodec
    self.audioCodec = audioCodec
    self.audioKbps = audioKbps
    self.sampleRate = sampleRate
    self.channels = channels
  }

  /// « 4K », « 1440p », « 1080p ».
  public var resolution: String? {
    guard let height, height > 0 else { return nil }
    return height >= 2000 ? "4K" : "\(height)p"
  }
  /// « 1080p · AAC 128 kb/s », or « 720p · audio YouTube » when YouTube keeps it to itself.
  public var summary: String {
    let audio: String =
      switch (audioCodec, audioKbps) {
      case (let codec?, let rate?): "\(codec) \(rate) kb/s"
      case (let codec?, nil): codec
      case (nil, _): origin == .youtube ? "audio YouTube" : ""
      }
    return [resolution, audio.isEmpty ? nil : audio].compactMap { $0 }.joined(separator: " · ")
  }
  public var videoDetail: String? {
    let rate = frameRate.map { "\(Int($0.rounded())) i/s" }
    let parts = [resolution, videoCodec, rate].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }
  public var audioDetail: String? {
    let khz = sampleRate.map {
      let value = $0 / 1000
      return (value == value.rounded() ? "\(Int(value))" : String(format: "%.1f", value))
        .replacingOccurrences(of: ".", with: ",") + " kHz"
    }
    let layout = channels.map { $0 == 1 ? "mono" : $0 == 2 ? "stéréo" : "\($0) canaux" }
    let parts = [audioCodec, audioKbps.map { "\($0) kb/s" }, khz, layout].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }

  /// The YouTube player's own words (`hd1080`, `large`…), or nil before it says anything.
  public static func youtube(_ label: String) -> StreamQuality? {
    let heights = [
      "tiny": 144, "small": 240, "medium": 360, "large": 480, "hd720": 720, "hd1080": 1080,
      "hd1440": 1440, "hd2160": 2160, "highres": 2160,
    ]
    guard let height = heights[label] else { return nil }
    return StreamQuality(origin: .youtube, height: height)
  }

  /// Codec names people know, from a track's four-character code.
  public static func codecName(_ code: FourCharCode) -> String? {
    let text = String(
      bytes: [24, 16, 8, 0].map { UInt8((code >> $0) & 0xFF) }, encoding: .ascii)?
      .trimmingCharacters(in: .whitespaces)
    switch text {
    case "avc1", "avc3": return "H.264"
    case "hvc1", "hev1": return "HEVC"
    case "av01": return "AV1"
    case "vp09": return "VP9"
    case "mp4a", "aac ": return "AAC"
    case "Opus", "opus": return "Opus"
    case "ac-3": return "Dolby Digital"
    case "ec-3": return "Dolby Digital Plus"
    case "alac": return "ALAC"
    case "fLaC": return "FLAC"
    case let other?: return other.isEmpty ? nil : other.uppercased()
    case nil: return nil
    }
  }

  /// Reads the clip file: video size, frame rate and codec; audio codec, rate and layout.
  public static func describe(_ asset: AVAsset) async -> StreamQuality {
    var quality = StreamQuality(origin: .clip)
    if let video = try? await asset.loadTracks(withMediaType: .video).first {
      if let size = try? await video.load(.naturalSize) { quality.height = Int(abs(size.height)) }
      if let rate = try? await video.load(.nominalFrameRate), rate > 0 {
        quality.frameRate = Double(rate)
      }
      if let format = try? await video.load(.formatDescriptions).first {
        quality.videoCodec = codecName(CMFormatDescriptionGetMediaSubType(format))
      }
    }
    if let audio = try? await asset.loadTracks(withMediaType: .audio).first {
      if let rate = try? await audio.load(.estimatedDataRate), rate > 0 {
        quality.audioKbps = Int((Double(rate) / 1000).rounded())
      }
      if let format = try? await audio.load(.formatDescriptions).first {
        quality.audioCodec = codecName(CMFormatDescriptionGetMediaSubType(format))
        if let basic = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee {
          if basic.mSampleRate > 0 { quality.sampleRate = basic.mSampleRate }
          if basic.mChannelsPerFrame > 0 { quality.channels = Int(basic.mChannelsPerFrame) }
        }
      }
    }
    return quality
  }
}
