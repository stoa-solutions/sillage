import AVKit
import RecallKit
import SwiftUI
import VideoToolbox
import WebKit

@MainActor
final class Player: NSObject, ObservableObject, WKNavigationDelegate, WKScriptMessageHandler {
  @Published private(set) var ready = false
  @Published private(set) var playing = false
  @Published var failure = ""
  @Published private(set) var studio = UserDefaults.standard.bool(forKey: "studioMode")
  @Published private(set) var studioReady = false
  @Published private(set) var preparingStudio = false
  @Published private(set) var elapsed: Double = 0
  @Published private(set) var duration: Double = 0
  /// Music volume from 0 to 1, shared by both players; the DJ's voice lowers it temporarily.
  @Published var volume = UserDefaults.standard.object(forKey: "musicVolume") as? Double ?? 1 {
    didSet {
      UserDefaults.standard.set(volume, forKey: "musicVolume")
      applyVolume()
    }
  }
  static var supports4K: Bool { VTIsHardwareDecodeSupported(kCMVideoCodecType_AV1) }
  @Published private(set) var quality: StudioQuality = {
    let saved =
      StudioQuality(rawValue: UserDefaults.standard.string(forKey: "studioQuality") ?? "") ?? .hd
    return saved == .ultra && !Player.supports4K ? .hd : saved
  }()
  @Published private(set) var downloadingStudio = false
  @Published private(set) var videoHeight: Int = 0
  var onProgress: (() -> Void)?
  private var wantsPlayback = true
  private var webResumePosition: Double?
  let nativePlayer = AVPlayer()
  private let studioCache = StudioVideoCache()
  private var studioTask: Task<Void, Never>?
  private var prefetchTask: Task<Void, Never>?
  private var nextTrack: Track?
  private var currentTrack: Track?
  private var nativeState: NSKeyValueObservation?
  private var itemState: NSKeyValueObservation?
  private var endObserver: NSObjectProtocol?
  private var timeObserver: Any?
  private var voiceDucked = false
  var onEnded: (() -> Void)?
  var onUnavailable: (() -> Void)?
  private var pending: (track: Track, start: Double, autoplay: Bool)?
  private var canEnd = false
  let webView: WKWebView
  private static let origin = "https://recall.stoa.solutions"
  override init() {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.mediaTypesRequiringUserActionForPlayback = []
    configuration.allowsAirPlayForMediaPlayback = true
    configuration.preferences.isElementFullscreenEnabled = true
    let bridge = """
      window.addEventListener('message', event => {
        if(event.source === window && event.origin === location.origin && event.data?.source === 'recall-dj-player')
          window.webkit.messageHandlers.player.postMessage(event.data);
      });
      """
    configuration.userContentController.addUserScript(
      WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    // The app reports failures natively, so the video fills the frame and the hint stays hidden.
    let layout = """
      const style = document.createElement('style');
      style.textContent = 'body{background:#000}#player{height:100vh!important;min-height:0!important}'
        + '#hint{display:none}#play{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%)}';
      document.head.appendChild(style);
      """
    configuration.userContentController.addUserScript(
      WKUserScript(source: layout, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    webView = WKWebView(frame: .zero, configuration: configuration)
    super.init()
    nativeState = nativePlayer.observe(\.timeControlStatus) { [weak self] native, _ in
      Task { @MainActor in
        guard let self, self.studioReady else { return }
        self.playing = native.timeControlStatus == .playing
      }
    }
    endObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime,
      object: nil, queue: .main
    ) { [weak self] event in
      let item = event.object as? AVPlayerItem
      Task { @MainActor in
        guard let self, self.studioReady, item === self.nativePlayer.currentItem else { return }
        self.playing = false
        self.onEnded?()
      }
    }
    timeObserver = nativePlayer.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main
    ) { [weak self] time in
      Task { @MainActor in
        guard let self, self.studioReady else { return }
        self.elapsed = time.seconds.isFinite ? time.seconds : 0
        let length = self.nativePlayer.currentItem?.duration.seconds ?? 0
        self.duration = length.isFinite ? length : 0
        self.videoHeight = Int(self.nativePlayer.currentItem?.presentationSize.height ?? 0)
        self.onProgress?()
      }
    }
    configuration.userContentController.add(self, name: "player")
    webView.navigationDelegate = self
    webView.load(URLRequest(url: URL(string: Self.origin + "/dj/player")!))
  }
  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    guard message.frameInfo.isMainFrame,
      message.frameInfo.request.url?.host == "recall.stoa.solutions",
      let value = message.body as? [String: Any], value["source"] as? String == "recall-dj-player"
    else { return }
    switch value["event"] as? String {
    case "ready":
      ready = true
      applyVolume()
      if let pending {
        self.pending = nil
        cueWeb(pending.track, start: pending.start, autoplay: pending.autoplay)
      }
    case "progress":
      guard !studioReady, !preparingStudio, value["id"] as? String == currentTrack?.id else {
        return
      }
      if let time = value["elapsed"] as? Double, time.isFinite {
        // A cued, paused YouTube item reports zero before its requested start is applied.
        if let resume = webResumePosition, time < resume - 2 { return }
        webResumePosition = nil
        elapsed = time
      }
      if let length = value["duration"] as? Double, length.isFinite { duration = length }
      onProgress?()
    case "state":
      if let id = value["id"] as? String, id != currentTrack?.id { return }
      guard !studioReady && !preparingStudio else { return }
      let state = value["state"] as? Int
      playing = state == 1
      if state == 1 {
        canEnd = true
        wantsPlayback = true
      }
      if state == 2 { wantsPlayback = false }
      if state == 0, canEnd {
        canEnd = false
        onEnded?()
      }
    case "blocked":
      guard !studioReady && !preparingStudio else { return }
      failure = "Clique sur Lecture pour lancer l’écoute."
    case "error":
      if let id = value["id"] as? String, id != currentTrack?.id { return }
      guard !studioReady && !preparingStudio else { return }
      failure = "YouTube bloque l’intégration de ce titre."
      onUnavailable?()
    default: break
    }
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { command("hello") }
  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) { failure = "Le lecteur ne peut pas joindre YouTube. Vérifie ta connexion." }
  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard navigationAction.targetFrame?.isMainFrame == true else {
      decisionHandler(.allow)
      return
    }
    guard navigationAction.request.url?.absoluteString == Self.origin + "/dj/player" else {
      if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url,
        ["https", "http"].contains(url.scheme)
      {
        NSWorkspace.shared.open(url)
      }
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }
  func cue(_ track: Track, start: Double = 0, autoplay: Bool = true) {
    currentTrack = track
    canEnd = false
    failure = ""
    studioTask?.cancel()
    nativePlayer.pause()
    nativePlayer.replaceCurrentItem(with: nil)
    studioReady = false
    elapsed = start
    duration = 0
    videoHeight = 0
    wantsPlayback = autoplay
    if studio {
      // Keep Studio's full-frame cover and loader until the clip is ready.
      preparingStudio = true
      downloadingStudio = true
      playing = false
      pending = nil
      sendWebCommand("pause")
      studioTask = Task {
        do {
          let file = try await studioCache.file(for: track.id, quality: quality)
          try Task.checkCancellation()
          guard currentTrack?.id == track.id, studio else { return }
          let item = AVPlayerItem(url: file)
          itemState = item.observe(\.status) { [weak self] item, _ in
            Task { @MainActor in
              guard let self, self.nativePlayer.currentItem === item, item.status == .failed else {
                return
              }
              self.nativePlayer.pause()
              self.studioReady = false
              self.failure = "Lecture locale indisponible. Retour au lecteur YouTube."
              self.cueWeb(track, start: self.elapsed, autoplay: self.wantsPlayback)
            }
          }
          nativePlayer.replaceCurrentItem(with: item)
          let resume = elapsed
          await nativePlayer.seek(
            to: CMTime(seconds: resume, preferredTimescale: 600), toleranceBefore: .zero,
            toleranceAfter: .zero)
          try Task.checkCancellation()
          guard currentTrack?.id == track.id, studio else { return }
          videoHeight = Int(item.presentationSize.height)
          applyVolume()
          downloadingStudio = false
          preparingStudio = false
          studioReady = true
          sendWebCommand("pause")
          if wantsPlayback { nativePlayer.play() }
          studioCache.trim(
            keeping: Set([track.id, nextTrack?.id].compactMap { $0 }), quality: quality)
        } catch {
          guard !Task.isCancelled, currentTrack?.id == track.id else { return }
          downloadingStudio = false
          preparingStudio = false
          failure = error.localizedDescription
          cueWeb(track, start: elapsed, autoplay: wantsPlayback)
        }
      }
    } else {
      preparingStudio = false
      downloadingStudio = false
      cueWeb(track, start: start, autoplay: autoplay)
    }
  }
  func prepareNext(_ track: Track?) {
    nextTrack = track
    let keep = Set([currentTrack?.id, track?.id].compactMap { $0 })
    studioCache.cancel(except: keep)
    prefetchTask?.cancel()
    guard studio, let track else { return }
    prefetchTask = Task { _ = try? await studioCache.file(for: track.id, quality: quality) }
  }
  func setStudio(_ value: Bool) {
    studio = value
    UserDefaults.standard.set(value, forKey: "studioMode")
    if !value {
      studioCache.cancel()
      prefetchTask?.cancel()
    }
    if let currentTrack {
      cue(currentTrack, start: elapsed, autoplay: wantsPlayback)
      prepareNext(nextTrack)
    }
  }
  func setQuality(_ value: StudioQuality) {
    let value: StudioQuality = value == .ultra && !Self.supports4K ? .hd : value
    guard quality != value else { return }
    quality = value
    UserDefaults.standard.set(value.rawValue, forKey: "studioQuality")
    studioCache.cancel()
    if studio, let currentTrack {
      cue(currentTrack, start: elapsed, autoplay: wantsPlayback)
      prepareNext(nextTrack)
    }
  }
  func seek(_ seconds: Double) {
    guard studioReady, seconds.isFinite else { return }
    nativePlayer.seek(to: CMTime(seconds: min(max(seconds, 0), duration), preferredTimescale: 600))
  }
  func reset() {
    studioTask?.cancel()
    prefetchTask?.cancel()
    studioCache.cancel()
    nativePlayer.pause()
    nativePlayer.replaceCurrentItem(with: nil)
    studioReady = false
    preparingStudio = false
    downloadingStudio = false
    elapsed = 0
    duration = 0
    currentTrack = nil
    nextTrack = nil
    pending = nil
    sendWebCommand("pause")
  }
  private func cueWeb(_ track: Track, start: Double = 0, autoplay: Bool = true) {
    guard ready else {
      pending = (track, start, autoplay)
      return
    }
    webResumePosition = start > 0 ? start : nil
    sendWebCommand("cue", extra: ["id": track.id, "autoplay": autoplay, "start": start])
  }
  func command(_ name: String, extra: [String: Any] = [:]) {
    if name == "play" { wantsPlayback = true }
    if name == "pause" { wantsPlayback = false }
    if name == "duck" || name == "restore" {
      voiceDucked = name == "duck"
      nativePlayer.volume = nativeVolume
    }
    if studioReady {
      if name == "play" { nativePlayer.play() }
      if name == "pause" { nativePlayer.pause() }
      return
    }
    sendWebCommand(name, extra: extra)
    // The web player restores its pre-duck volume; the slider may have moved meanwhile.
    if name == "restore" { applyVolume() }
  }
  private var nativeVolume: Float { Float(voiceDucked ? min(volume, 0.18) : volume) }
  private func applyVolume() {
    nativePlayer.volume = nativeVolume
    if !voiceDucked { sendWebCommand("volume", extra: ["value": Int(volume * 100)]) }
  }
  private func sendWebCommand(_ name: String, extra: [String: Any] = [:]) {
    var value = extra
    value["source"] = "recall-dj"
    value["command"] = name
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    let script =
      "window.postMessage(" + String(decoding: data, as: UTF8.self) + ", location.origin)"
    webView.evaluateJavaScript(script, completionHandler: nil)
  }
}

struct StudioPlayerView: NSViewRepresentable {
  let player: AVPlayer
  func makeNSView(context: Context) -> AVPlayerView {
    let view = AVPlayerView()
    view.player = player
    view.controlsStyle = .none
    view.videoGravity = .resizeAspectFill
    return view
  }
  func updateNSView(_ view: AVPlayerView, context: Context) { view.player = player }
}
// SwiftUI sizes this container, while WebKit remains free to reparent its view for fullscreen.
// Direct AutoLayout constraints on WKWebView collapse its viewport during that transition.
final class PlayerContainerView: NSView {
  init(webView: WKWebView) {
    super.init(frame: .zero)
    webView.translatesAutoresizingMaskIntoConstraints = true
    webView.autoresizingMask = [.width, .height]
    webView.frame = bounds
    addSubview(webView)
    wantsLayer = true
    layer?.cornerRadius = 10
    layer?.masksToBounds = true
    setAccessibilityElement(false)
    setAccessibilityChildren([webView])
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}
struct PlayerView: NSViewRepresentable {
  let player: Player
  func makeNSView(context: Context) -> PlayerContainerView {
    PlayerContainerView(webView: player.webView)
  }
  func updateNSView(_ nsView: PlayerContainerView, context: Context) {}
}
