import RecallKit
import SwiftUI
import WebKit

@MainActor
final class Player: NSObject, ObservableObject, WKNavigationDelegate, WKScriptMessageHandler {
  @Published private(set) var ready = false
  @Published private(set) var playing = false
  @Published var failure = ""
  var onEnded: (() -> Void)?
  var onUnavailable: (() -> Void)?
  private var pending: Track?
  let webView: WKWebView
  private static let origin = "https://recall.stoa.solutions"
  override init() {
    let configuration = WKWebViewConfiguration()
    configuration.mediaTypesRequiringUserActionForPlayback = []
    configuration.allowsAirPlayForMediaPlayback = true
    let bridge = """
      window.addEventListener('message', event => {
        if(event.source === window && event.origin === location.origin && event.data?.source === 'recall-dj-player')
          window.webkit.messageHandlers.player.postMessage(event.data);
      });
      """
    configuration.userContentController.addUserScript(
      WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    webView = WKWebView(frame: .zero, configuration: configuration)
    super.init()
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
      let state = value["state"] as? Int
      playing = state == 1
      if state == 0 { onEnded?() }
    case "blocked": failure = "Clique sur Lecture pour lancer l’écoute."
    case "error":
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
    failure = ""
    guard ready else {
      pending = track
      return
    }
    command("cue", extra: ["id": track.id, "autoplay": true])
  }
  func command(_ name: String, extra: [String: Any] = [:]) {
    var value = extra
    value["source"] = "recall-dj"
    value["command"] = name
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    let script =
      "window.postMessage(" + String(decoding: data, as: UTF8.self) + ", location.origin)"
    webView.evaluateJavaScript(script, completionHandler: nil)
  }
}
struct PlayerView: NSViewRepresentable {
  let player: Player
  func makeNSView(context: Context) -> WKWebView { player.webView }
  func updateNSView(_ nsView: WKWebView, context: Context) {}
}
