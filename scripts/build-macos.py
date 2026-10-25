"""Build an isolated, credential-free macOS app bundle and signed Sparkle archive."""
from pathlib import Path
import argparse
import json
import hashlib
import os
import platform
import re
import plistlib
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
project = root / "apps/macos"
release_version = json.loads((project / "version.json").read_text())
parser = argparse.ArgumentParser()
parser.add_argument("--universal", action="store_true")
parser.add_argument("--dmg", action="store_true", help="Also create a drag-to-Applications installation disk")
parser.add_argument("--skip-update-signature", action="store_true", help="Local test build only; never publish this archive as an update")
parser.add_argument("--version", default=release_version["version"])
parser.add_argument("--build", default=release_version["build"])
args = parser.parse_args()
if not re.fullmatch(r"\d+\.\d+\.\d+", args.version) or not args.build.isdigit():
    parser.error("Use a three-part version and a numeric build number")
local_config = Path.home() / ".config/playlist-recall/local-signing.json"
local_identity = json.loads(local_config.read_text()).get("identity") if local_config.exists() else None
identity = os.environ.get("MAC_SIGNING_IDENTITY") or local_identity or "-"
local_signing = not os.environ.get("MAC_SIGNING_IDENTITY") and bool(local_identity)
architectures = ["arm64", "x86_64"] if args.universal else ["arm64" if platform.machine() == "arm64" else "x86_64"]
for arch in architectures:
    subprocess.run(["swift", "build", "--package-path", str(project), "-c", "release", "--arch", arch], check=True)
output = root / ".output/macos"
output.mkdir(parents=True, exist_ok=True)
# Never leave metadata describing a previous archive if rebuilding or signing fails.
(output / "release.json").unlink(missing_ok=True)
bundle = output / "Playlist Recall.app"
if bundle.exists():
    shutil.rmtree(bundle)
contents = bundle / "Contents"
for name in ["MacOS", "Frameworks", "Resources"]:
    (contents / name).mkdir(parents=True)
binaries = [project / f".build/{arch}-apple-macosx/release/RecallMac" for arch in architectures]
executable = contents / "MacOS/RecallMac"
if len(binaries) == 1:
    shutil.copy2(binaries[0], executable)
else:
    subprocess.run(["lipo", "-create", *map(str, binaries), "-output", str(executable)], check=True)
executable.chmod(0o755)
framework = project / ".build/artifacts/sparkle/Sparkle/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework"
if not framework.exists():
    framework = next((project / ".build/artifacts/sparkle").rglob("macos-arm64_x86_64/Sparkle.framework"))
shutil.copytree(framework, contents / "Frameworks/Sparkle.framework", symlinks=True)
# Include SwiftPM resources in the installed app, not only the build directory.
resources = project / f".build/{architectures[0]}-apple-macosx/release/PlaylistRecallMac_RecallMac.bundle"
shutil.copytree(resources, contents / "Resources" / resources.name)
shutil.copy2(root / "apps/extension/public/icon/128.png", contents / "Resources/Recall.png")
shutil.copy2(project / "Resources/Installation.txt", contents / "Resources/Installation.txt")
shutil.copy2(project / ".build/artifacts/sparkle/Sparkle/LICENSE", contents / "Resources/Sparkle-LICENSE.txt")
info = {
    "CFBundleName": "Playlist Recall", "CFBundleDisplayName": "Playlist Recall", "CFBundleExecutable": "RecallMac",
    "CFBundleIdentifier": "solutions.stoa.playlist-recall", "CFBundlePackageType": "APPL",
    "CFBundleURLTypes": [{"CFBundleURLName": "Recall Sign In", "CFBundleURLSchemes": ["playlist-recall"]}],
    "CFBundleShortVersionString": args.version, "CFBundleVersion": args.build,
    "LSMinimumSystemVersion": "14.0", "NSHighResolutionCapable": True, "CFBundleIconFile": "Recall.png",
    "NSMicrophoneUsageDescription": "Recall écoute ton envie musicale seulement quand tu actives le micro.",
    "NSSpeechRecognitionUsageDescription": "Recall transforme ta demande vocale en texte pour ton DJ personnel.",
    "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
    "SUFeedURL": "https://recall.stoa.solutions/macos/appcast.xml",
    "SUPublicEDKey": (project / "Resources/UpdatePublicKey.txt").read_text().strip(),
    "SUEnableAutomaticChecks": True, "SUAutomaticallyUpdate": True, "SUEnableSystemProfiling": False,
}
with (contents / "Info.plist").open("wb") as handle:
    plistlib.dump(info, handle)
entitlements = output / "entitlements.plist"
values = {"com.apple.security.device.audio-input": True}
if identity == "-" or local_signing:
    values["com.apple.security.cs.disable-library-validation"] = True
with entitlements.open("wb") as handle:
    plistlib.dump(values, handle)
subprocess.run(["codesign", "--force", "--deep", "--sign", identity, "--options", "runtime", "--entitlements", str(entitlements), str(bundle)], check=True)
subprocess.run(["codesign", "--verify", "--deep", "--strict", str(bundle)], check=True)
notarized = False
profile = os.environ.get("MAC_NOTARY_PROFILE")
if profile:
    if identity == "-" or local_signing:
        raise SystemExit("Apple notarization requires a Developer ID signing identity")
    submission = output / "notary-submission.zip"
    subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(bundle), str(submission)], check=True)
    result = json.loads(subprocess.check_output(["xcrun", "notarytool", "submit", str(submission), "--keychain-profile", profile, "--wait", "--output-format", "json"], text=True))
    if result.get("status") != "Accepted":
        raise SystemExit("Apple notarization was not accepted")
    subprocess.run(["xcrun", "stapler", "staple", str(bundle)], check=True)
    subprocess.run(["xcrun", "stapler", "validate", str(bundle)], check=True)
    notarized = True
label = "universal" if args.universal else architectures[0]
archive = output / f"Playlist-Recall-{args.version}-{label}.zip"
if archive.exists():
    archive.unlink()
subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(bundle), str(archive)], check=True)
tools = project / ".build/artifacts/sparkle/Sparkle/bin"
signature = None
if not args.skip_update_signature:
    # The signing helper only needs this archive, not access to the Documents folder.
    with tempfile.TemporaryDirectory(prefix="recall-sign-") as temp:
        signing_copy = Path(temp) / archive.name
        shutil.copy2(archive, signing_copy)
        signature = subprocess.check_output([str(tools / "sign_update"), "--account", "recall-macos-updates", "-p", str(signing_copy)], text=True, timeout=120).strip()
        subprocess.run([str(tools / "sign_update"), "--account", "recall-macos-updates", "--verify", str(signing_copy), signature], check=True, timeout=120)
manifest = {"version": args.version, "build": args.build, "architecture": label, "file": archive.name, "size": archive.stat().st_size, "signature": signature, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "notarized": notarized, "signing": "ad-hoc" if identity == "-" else "local certificate" if local_signing else "Developer ID"}
if args.dmg:
    disk = output / f"Playlist-Recall-{args.version}-{label}.dmg"
    with tempfile.TemporaryDirectory(prefix="recall-installer-") as temp:
        stage = Path(temp)
        shutil.copytree(bundle, stage / bundle.name, symlinks=True)
        (stage / "Applications").symlink_to("/Applications")
        shutil.copy2(project / "Resources/Installation.txt", stage / "Lire avant installation.txt")
        subprocess.run(["hdiutil", "create", "-volname", "Playlist Recall", "-srcfolder", str(stage), "-ov", "-format", "UDZO", str(disk)], check=True)
    manifest["installer"] = disk.name
    manifest["installerSha256"] = hashlib.sha256(disk.read_bytes()).hexdigest()
(output / "release.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(bundle)
print(archive)
print("Sparkle archive signature verified." if signature else "Local archive only: update signature pending Trousseau authorization.")
print("Apple notarization remains a separate release step.")
