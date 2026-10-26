import Foundation

/// yt-dlp's YouTube extractor needs an external JS runtime. GUI apps have a restricted PATH;
/// pass the installed Homebrew Node path explicitly instead of relying on shell discovery.
public enum StudioJavaScriptRuntime {
  public static func arguments(
    isExecutable: (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) }
  ) -> [String] {
    guard let node = ["/opt/homebrew/bin/node", "/usr/local/bin/node"].first(where: isExecutable)
    else { return [] }  // Keep yt-dlp's default Deno behaviour when Node isn't installed.
    return ["--no-js-runtimes", "--js-runtimes", "node:" + node]
  }
}
