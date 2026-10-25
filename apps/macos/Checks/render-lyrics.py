"""Render production SwiftUI lyrics views offscreen, without launching Recall or loading a session."""
from pathlib import Path
import argparse
import os
import subprocess
import tempfile

project = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("output", type=Path, help="Directory for the six PNG checks")
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
subprocess.run(["swift", "build", "--package-path", str(project)], check=True)
build = Path(subprocess.check_output(
    ["swift", "build", "--package-path", str(project), "--show-bin-path"], text=True
).strip())
# Link the actual UI and models, replacing only the application's entry point.
# This avoids bootstrapping accounts, audio capture, Sparkle or a foreground window.
objects = [path for path in (build / "RecallMac.product/Objects.LinkFileList").read_text().splitlines()
           if not path.endswith("/RecallApp.swift.o")]
framework = project / ".build/artifacts/sparkle/Sparkle/Sparkle.xcframework/macos-arm64_x86_64"
with tempfile.TemporaryDirectory(prefix="recall-lyrics-ui-") as temporary:
    root = Path(temporary)
    binary = root / "LyricsRenderChecks"
    subprocess.run([
        "xcrun", "swiftc", "-parse-as-library", "-I", str(build / "Modules"),
        "-F", str(framework), str(project / "Checks/RenderLyrics.swift"),
        *objects, "-o", str(binary),
    ], check=True)
    subprocess.run([str(binary), str(args.output.resolve())],
                   env=dict(os.environ, RECALL_DATA_DIR=str(root / "data")), check=True, timeout=30)
print(f"Rendered production panels: {args.output.resolve()}")
