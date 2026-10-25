import AVKit
import Combine
import RecallKit
import SwiftUI
import VideoToolbox
import WebKit

/// What the screens see of playback: the engine's state, the two video surfaces, and the
/// display and quality preferences. Studio is only a display choice; the downloaded clip plays
/// in Compact too, unless "YouTube player only" is chosen.
@MainActor
final class Player: ObservableObject {
  let youtube = YouTubePlayer()
  let clipPlayer = ClipPlayer()
  let engine: PlaybackEngine
  private let clips: StudioClips
  private var relay: AnyCancellable?

  @Published private(set) var studio = UserDefaults.standard.bool(forKey: "studioMode")
  @Published private(set) var quality: StudioQuality
  @Published private(set) var youtubeOnly = UserDefaults.standard.bool(forKey: "youtubeOnly")
  static var supports4K: Bool { VTIsHardwareDecodeSupported(kCMVideoCodecType_AV1) }

  init() {
    let saved =
      StudioQuality(rawValue: UserDefaults.standard.string(forKey: "studioQuality") ?? "") ?? .hd
    let quality = saved == .ultra && !Self.supports4K ? .hd : saved
    self.quality = quality
    clips = StudioClips(quality: quality)
    engine = PlaybackEngine(
      youtube: youtube, clip: clipPlayer, clips: clips,
      volume: UserDefaults.standard.object(forKey: "musicVolume") as? Double ?? 1,
      downloads: !UserDefaults.standard.bool(forKey: "youtubeOnly"))
    relay = engine.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
  }

  var webView: WKWebView { youtube.webView }
  var nativePlayer: AVPlayer { clipPlayer.player }
  var playing: Bool { engine.playing }
  var elapsed: Double { engine.elapsed }
  var duration: Double { engine.duration }
  var failure: String { engine.failure }
  /// The downloaded clip is the one on screen and in the speakers.
  var clipActive: Bool { engine.active == .clip }
  var preparingClip: Bool { engine.preparingClip }
  /// YouTube stays on screen only until the clip has fully faded in.
  var youtubeHidden: Bool { clipActive && !engine.fading }
  var videoHeight: Int { clipActive ? clipPlayer.videoHeight : 0 }
  var volume: Double {
    get { engine.volume }
    set {
      engine.volume = newValue
      UserDefaults.standard.set(newValue, forKey: "musicVolume")
    }
  }
  func position(at date: Date) -> Double { engine.position(at: date) }
  func seek(_ seconds: Double) { engine.seek(seconds) }

  func setStudio(_ value: Bool) {
    studio = value
    UserDefaults.standard.set(value, forKey: "studioMode")
  }
  func setQuality(_ value: StudioQuality) {
    let value: StudioQuality = value == .ultra && !Self.supports4K ? .hd : value
    guard quality != value else { return }
    quality = value
    clips.quality = value
    UserDefaults.standard.set(value.rawValue, forKey: "studioQuality")
    engine.reloadClip()
  }
  func setYouTubeOnly(_ value: Bool) {
    youtubeOnly = value
    UserDefaults.standard.set(value, forKey: "youtubeOnly")
    engine.setDownloads(!value)
  }
}

/// The Studio cache as the engine's clip source: nearest clips first, others released.
@MainActor
final class StudioClips: ClipSource {
  private let cache = StudioVideoCache()
  var quality: StudioQuality {
    didSet { cache.cancel() }
  }
  private var prefetch: [Task<Void, Never>] = []
  init(quality: StudioQuality) { self.quality = quality }
  func clip(for id: String) async throws -> URL { try await cache.file(for: id, quality: quality) }
  func keep(_ ids: [String]) {
    let wanted = Array(ids.prefix(ListeningSession.preparedAhead + 1))
    cache.cancel(except: Set(wanted))
    prefetch.forEach { $0.cancel() }
    // One download at a time keeps the next song's clip first in line.
    prefetch = [
      Task { [cache, quality] in
        for id in wanted.dropFirst() {
          guard !Task.isCancelled else { return }
          _ = try? await cache.file(for: id, quality: quality)
        }
      }
    ]
    cache.trim(keeping: Set(wanted), quality: quality)
  }
}

/// The official YouTube player in a WebKit page, bridged by strictly checked messages.
@MainActor
final class YouTubePlayer: NSObject, PlaybackBackend, WKNavigationDelegate, WKScriptMessageHandler {
  var onSignal: ((PlaybackSignal) -> Void)?
  var onFailure: ((String) -> Void)?
  let webView: WKWebView
  private(set) var position: Double = 0
  private var ready = false
  private var pending: (id: String, start: Double, autoplay: Bool)?
  private var currentID: String?
  private var canEnd = false
  private var resumeAt: Double?
  private var seeking: (target: Double, started: Date)?
  private var level = 1.0
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
    // The page's CSP refuses inline <style>; rules added to its own stylesheet are allowed.
    let layout = """
      const rules = ['body{background:#000}', '#player{height:100vh!important;min-height:0!important}',
        '#hint{display:none}', '#play{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%)}'];
      const link = document.querySelector('link[rel=stylesheet]');
      const apply = () => {
        const sheet = link && link.sheet;
        if (!sheet || sheet.recallLayout) return;
        sheet.recallLayout = true;
        for (const rule of rules) sheet.insertRule(rule, sheet.cssRules.length);
      };
      apply();
      link?.addEventListener('load', apply);
      """
    configuration.userContentController.addUserScript(
      WKUserScript(source: layout, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    webView = WKWebView(frame: .zero, configuration: configuration)
    super.init()
    configuration.userContentController.add(WeakPlayerMessageHandler(self), name: "player")
    webView.navigationDelegate = self
  }

  private var pageLoaded = false
  private func loadPageIfNeeded() {
    guard !pageLoaded else { return }
    pageLoaded = true
    webView.load(URLRequest(url: URL(string: Self.origin + "/dj/player")!))
  }

  func load(_ source: PlaybackSource, at start: Double, autoplay: Bool) async throws {
    guard case .youtube(let id) = source else { return }
    loadPageIfNeeded()
    currentID = id
    canEnd = false
    seeking = nil
    position = start
    guard ready else {
      pending = (id, start, autoplay)
      return
    }
    resumeAt = start > 0 ? start : nil
    send("cue", ["id": id, "autoplay": autoplay, "start": start])
  }
  func play() { send("play") }
  func pause() { send("pause") }
  func seek(to seconds: Double) {
    guard let id = currentID else { return }
    resumeAt = nil
    seeking = (seconds, Date())
    position = seconds
    send("seek", ["id": id, "seconds": seconds])
  }
  func stop() {
    currentID = nil
    pending = nil
    send("pause")
  }
  func setVolume(_ level: Double) {
    self.level = level
    send("volume", ["value": Int((level * 100).rounded())])
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
      setVolume(level)
      if let pending {
        self.pending = nil
        resumeAt = pending.start > 0 ? pending.start : nil
        send("cue", ["id": pending.id, "autoplay": pending.autoplay, "start": pending.start])
      }
    case "progress":
      guard value["id"] as? String == currentID, let time = value["elapsed"] as? Double,
        time.isFinite
      else { return }
      if let seek = seeking, abs(time - seek.target) > 1, Date().timeIntervalSince(seek.started) < 2
      {
        return
      }
      seeking = nil
      // A cued, paused YouTube item reports zero before its requested start is applied.
      if let resume = resumeAt, time < resume - 2 { return }
      resumeAt = nil
      position = time
      let length = value["duration"] as? Double ?? 0
      onSignal?(.progress(elapsed: time, duration: length.isFinite ? length : 0))
    case "state":
      if let id = value["id"] as? String, id != currentID { return }
      let state = value["state"] as? Int
      if state == 1 { canEnd = true }
      onSignal?(.playing(state == 1))
      if state == 0, canEnd {
        canEnd = false
        onSignal?(.ended)
      }
    case "blocked":
      onFailure?("Clique sur Lecture pour lancer l’écoute.")
    case "error":
      if let id = value["id"] as? String, id != currentID { return }
      onFailure?("YouTube bloque l’intégration de ce titre.")
      onSignal?(.unavailable)
    default: break
    }
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { send("hello") }
  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) { onFailure?("Le lecteur ne peut pas joindre YouTube. Vérifie ta connexion.") }
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
  private func send(_ name: String, _ extra: [String: Any] = [:]) {
    guard pageLoaded else { return }
    var value = extra
    value["source"] = "recall-dj"
    value["command"] = name
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    let script =
      "window.postMessage(" + String(decoding: data, as: UTF8.self) + ", location.origin)"
    webView.evaluateJavaScript(script, completionHandler: nil)
  }
}

/// WebKit retains its message handlers. A weak forwarding target lets the whole player go.
@MainActor
private final class WeakPlayerMessageHandler: NSObject, WKScriptMessageHandler {
  weak var target: YouTubePlayer?
  init(_ target: YouTubePlayer) { self.target = target }
  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    target?.userContentController(controller, didReceive: message)
  }
}

/// Both players stacked in one frame: the clip fades in over YouTube, so nothing moves.
struct VideoSurface: View {
  @ObservedObject var player: Player
  var fill = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    ZStack {
      Color.black
      // WebKit paints over sibling views, whatever the SwiftUI order: hide it once the clip is in.
      PlayerView(player: player, cornerRadius: fill ? 0 : 10, hidden: player.youtubeHidden)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      // AVPlayerView would otherwise keep the clip's natural size instead of the frame's.
      StudioPlayerView(player: player.nativePlayer, fill: fill)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .opacity(player.clipActive ? 1 : 0)
        .allowsHitTesting(player.clipActive)
    }.animation(reduceMotion ? nil : .easeInOut(duration: 0.6), value: player.clipActive)
  }
}

struct StudioPlayerView: NSViewRepresentable {
  let player: AVPlayer
  var fill = true
  func makeNSView(context: Context) -> AVPlayerView {
    let view = AVPlayerView()
    view.player = player
    view.controlsStyle = .none
    view.videoGravity = fill ? .resizeAspectFill : .resizeAspect
    return view
  }
  func updateNSView(_ view: AVPlayerView, context: Context) {
    view.player = player
    view.videoGravity = fill ? .resizeAspectFill : .resizeAspect
  }
}
// SwiftUI sizes this container, while WebKit remains free to reparent its view for fullscreen.
// Direct AutoLayout constraints on WKWebView collapse its viewport during that transition.
final class PlayerContainerView: NSView {
  init(webView: WKWebView, cornerRadius: CGFloat) {
    super.init(frame: .zero)
    webView.translatesAutoresizingMaskIntoConstraints = true
    webView.autoresizingMask = [.width, .height]
    webView.frame = bounds
    addSubview(webView)
    wantsLayer = true
    layer?.cornerRadius = cornerRadius
    layer?.masksToBounds = true
    setAccessibilityElement(false)
    setAccessibilityChildren([webView])
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}
struct PlayerView: NSViewRepresentable {
  let player: Player
  var cornerRadius: CGFloat = 10
  var hidden = false
  func makeNSView(context: Context) -> PlayerContainerView {
    PlayerContainerView(webView: player.webView, cornerRadius: cornerRadius)
  }
  func updateNSView(_ nsView: PlayerContainerView, context: Context) { nsView.isHidden = hidden }
}
