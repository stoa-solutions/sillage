import Foundation

/// One-use callback bound to a login started by this app; never accepts an API token in a URL.
public struct GoogleCallback: Sendable {
  private var state: String?
  private let expires: Date
  public init(state: String, now: Date = Date()) {
    self.state = state
    expires = now.addingTimeInterval(600)
  }
  public mutating func consume(_ url: URL, now: Date = Date()) -> String? {
    guard let expected = state, now < expires,
      url.scheme == "sillage", url.host == "auth",
      url.user == nil, url.password == nil, url.port == nil,
      url.path.isEmpty, url.fragment == nil,
      let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
      query.count == 2,
      query.filter({ $0.name == "state" }).count == 1,
      query.filter({ $0.name == "code" }).count == 1,
      query.first(where: { $0.name == "state" })?.value == expected,
      let code = query.first(where: { $0.name == "code" })?.value,
      (32...256).contains(code.count),
      code.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
    else { return nil }
    state = nil
    return code
  }
}
