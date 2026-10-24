"""Package compiled extension without personal catalog, vectors or credentials."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parent.parent
source = root / "apps/extension/.output/chrome-mv3"
manifest = json.loads((source / "manifest.json").read_text())
output = root / ".output" / f"playlist-recall-webstore-{manifest['version']}.zip"
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(source.rglob("*")):
        if not file.is_file():
            continue
        relative = file.relative_to(source)
        if relative.parts[0] == "data" or file.name.startswith(".") or file.suffix in {".map", ".pem", ".env", ".part"}:
            continue
        archive.write(file, str(relative))
with zipfile.ZipFile(output) as archive:
    assert "manifest.json" in archive.namelist()
    assert not any(name.startswith("data/") for name in archive.namelist())
    assert archive.testzip() is None
print(output)
