#!/usr/bin/env python3
"""Render the real discovery label style and reject SwiftUI runtime warnings."""
from pathlib import Path
import json
import subprocess
import tempfile
import time


root = Path(__file__).resolve().parents[1]
source = (root / "apps/macos/Sources/SillageMac/DiscoverView.swift").read_text()
start = source.index("struct AnyLabelStyle: LabelStyle {")
end = source.index("\n}\n", start) + 2
style = source[start:end]
fixture = r'''
import AppKit
import SwiftUI

STYLE_SOURCE

@main struct LabelStyleProbe {
  @MainActor static func measure(compact: Bool) -> CGFloat {
    let label = Label("Écouter", systemImage: "play.fill")
      .labelStyle(compact ? AnyLabelStyle(.iconOnly) : AnyLabelStyle(.titleAndIcon))
      .font(.system(size: 18)).padding(12)
    let view = NSHostingView(rootView: label)
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 320, height: 100),
      styleMask: [.borderless], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    window.contentView = view
    for _ in 0..<3 {
      view.layoutSubtreeIfNeeded()
      RunLoop.main.run(until: Date().addingTimeInterval(0.1))
      view.displayIfNeeded()
    }
    let width = view.fittingSize.width
    window.close()
    return width
  }

  @MainActor static func main() throws {
    NSApplication.shared.setActivationPolicy(.prohibited)
    let widths = ["compact": measure(compact: true), "regular": measure(compact: false)]
    print(String(decoding: try JSONEncoder().encode(widths), as: UTF8.self))
  }
}
'''.replace("STYLE_SOURCE", style)

with tempfile.TemporaryDirectory(prefix="sillage-label-styles-") as directory:
    path = Path(directory)
    swift = path / "Probe.swift"
    binary = path / "SillageLabelStyleProbe"
    swift.write_text(fixture)
    subprocess.run(
        ["xcrun", "swiftc", "-parse-as-library", str(swift), "-o", str(binary)],
        check=True,
        timeout=60,
    )
    process = subprocess.Popen(
        [str(binary)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    output, error = process.communicate(timeout=15)
    if process.returncode:
        raise SystemExit(error)
    widths = json.loads(output)
    assert 0 < widths["compact"] < widths["regular"], widths
    # Give the unified log a moment to persist this short-lived process's faults.
    time.sleep(1)
    result = subprocess.run(
        [
            "/usr/bin/log", "show", "--last", "2m", "--style", "ndjson",
            "--predicate",
            'process == "SillageLabelStyleProbe" AND subsystem == "com.apple.runtime-issues"',
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    warnings = []
    for line in result.stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("processID") == process.pid:
            message = event.get("eventMessage", "")
            if "Accessing Environment" in message:
                warnings.append(message)
    assert not warnings, f"SwiftUI environment warnings: {warnings}"
    print("Label styles: compact icons, regular titles, no SwiftUI environment warning.")
