"""Create a Sparkle feed only from a signed archive. Does not upload anything."""
from pathlib import Path
import argparse
import json
import hashlib
import re
import urllib.parse
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="https://recall.stoa.solutions/macos")
parser.add_argument("--allow-local-beta", action="store_true")
args = parser.parse_args()
folder = root / ".output/macos"
release = json.loads((folder / "release.json").read_text())
if not release.get("signature"):
    raise SystemExit("Refusing update feed: archive has no Sparkle signature. Authorize the signing helper and rebuild.")
if not release.get("notarized") and not args.allow_local_beta:
    raise SystemExit("Public release requires Apple notarization. --allow-local-beta is only for explicitly accepted test builds.")
parsed = urllib.parse.urlparse(args.base_url)
if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
    raise SystemExit("An HTTPS update origin without credentials is required")
if not re.fullmatch(r"(?:Playlist-Recall|Sillage)-\d+\.\d+\.\d+-(arm64|x86_64|universal)\.zip", release["file"]):
    raise SystemExit("Invalid release filename")
archive = folder / release["file"]
if archive.stat().st_size != release["size"] or hashlib.sha256(archive.read_bytes()).hexdigest() != release.get("sha256"):
    raise SystemExit("Archive changed after signing")
namespace = "http://www.andymatuschak.org/xml-namespaces/sparkle"
ET.register_namespace("sparkle", namespace)
rss = ET.Element("rss", version="2.0")
channel = ET.SubElement(rss, "channel")
ET.SubElement(channel, "title").text = "Sillage pour Mac"
item = ET.SubElement(channel, "item")
ET.SubElement(item, "title").text = "Sillage " + release["version"]
ET.SubElement(item, "{" + namespace + "}version").text = release["build"]
ET.SubElement(item, "{" + namespace + "}shortVersionString").text = release["version"]
ET.SubElement(item, "{" + namespace + "}minimumSystemVersion").text = "14.0.0"
ET.SubElement(item, "enclosure", {
    "url": args.base_url.rstrip("/") + "/" + release["file"],
    "length": str(release["size"]), "type": "application/octet-stream",
    "{" + namespace + "}edSignature": release["signature"],
})
ET.indent(rss)
ET.ElementTree(rss).write(folder / "appcast.xml", encoding="utf-8", xml_declaration=True)
print(folder / "appcast.xml")
