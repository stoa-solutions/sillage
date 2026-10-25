import AVKit
import RecallKit
import SwiftUI
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
  private var pending: Track?
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
      if let pending {
        self.pending = nil
        cue(pending)
      }
    case "state":
      guard !studioReady && !preparingStudio else { return }
      let state = value["state"] as? Int
      playing = state == 1
      if state == 1 { canEnd = true }
      if state == 0, canEnd {
        canEnd = false
        onEnded?()
      }
    case "blocked":
      guard !studioReady && !preparingStudio else { return }
      failure = "Clique sur Lecture pour lancer l’écoute."
    case "error":
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
  func cue(_ track: Track) {
    currentTrack = track
    canEnd = false
    failure = ""
    studioTask?.cancel()
    nativePlayer.pause()
    nativePlayer.replaceCurrentItem(with: nil)
    studioReady = false
    elapsed = 0
    duration = 0
    if studio {
      sendWebCommand("pause")
      playing = false
      preparingStudio = true
      studioTask = Task {
        do {
          let file = try await studioCache.file(for: track.id)
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
              self.cueWeb(track)
            }
          }
          nativePlayer.replaceCurrentItem(with: item)
          nativePlayer.volume = voiceDucked ? 0.18 : 1
          preparingStudio = false
          studioReady = true
          nativePlayer.play()
          studioCache.trim(keeping: Set([track.id, nextTrack?.id].compactMap { $0 }))
        } catch {
          guard !Task.isCancelled, currentTrack?.id == track.id else { return }
          preparingStudio = false
          failure = error.localizedDescription
          cueWeb(track)
        }
      }
    } else {
      preparingStudio = false
      cueWeb(track)
    }
  }
  func prepareNext(_ track: Track?) {
    nextTrack = track
    let keep = Set([currentTrack?.id, track?.id].compactMap { $0 })
    studioCache.cancel(except: keep)
    prefetchTask?.cancel()
    guard studio, let track else { return }
    prefetchTask = Task { _ = try? await studioCache.file(for: track.id) }
  }
  func setStudio(_ value: Bool) {
    studio = value
    UserDefaults.standard.set(value, forKey: "studioMode")
    if !value {
      studioCache.cancel()
      prefetchTask?.cancel()
    }
    if let currentTrack {
      cue(currentTrack)
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
    currentTrack = nil
    nextTrack = nil
    pending = nil
    sendWebCommand("pause")
  }
  private func cueWeb(_ track: Track) {
    guard ready else {
      pending = track
      return
    }
    sendWebCommand("cue", extra: ["id": track.id, "autoplay": true])
  }
  func command(_ name: String, extra: [String: Any] = [:]) {
    if name == "duck" {
      voiceDucked = true
      nativePlayer.volume = 0.18
    }
    if name == "restore" {
      voiceDucked = false
      nativePlayer.volume = 1
    }
    if studioReady {
      if name == "play" { nativePlayer.play() }
      if name == "pause" { nativePlayer.pause() }
      return
    }
    sendWebCommand(name, extra: extra)
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
