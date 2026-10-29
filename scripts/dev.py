#!/usr/bin/env python3
"""Local development on a private copy of production.

  python3 scripts/dev.py db pull   copy production into the local PostgreSQL (replaces it)
  python3 scripts/dev.py api       API on http://127.0.0.1:3101, reloaded on every save (tsx watch)
  python3 scripts/dev.py app       "Sillage Dev" rebuilt and relaunched on every Swift save
  python3 scripts/dev.py all       both, in one terminal

Everything private lives outside the repository, in ../sillage-dev next to the main clone
(SILLAGE_DEV_DIR to change it): the dumps, server.env (DATABASE_URL, PORT, PUBLIC_URL),
dev.env (SILLAGE_PROD_SSH, SILLAGE_DEV_ACCOUNT) and the data folder of the development app.
The development app has its own bundle id and SILLAGE_DATA_DIR: it never touches the
installed Sillage, and its token exists only in the local database.
"""
from __future__ import annotations

import base64
import json
import os
import plistlib
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "apps/macos"
COMMON = Path(subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                             cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip())
DEV = Path(os.environ.get("SILLAGE_DEV_DIR") or COMMON.parent.parent / "sillage-dev")
CONTAINER = "sillage-dev-db"
IMAGE = "pgvector/pgvector:0.8.7-pg17"  # same as production
BUNDLE = ROOT / ".output/macos-dev/Sillage Dev.app"


def settings(name: str) -> dict[str, str]:
    path = DEV / name
    if not path.exists():
        sys.exit(f"{path} manque : voir docs/developing.md, « Copie locale de la production ».")
    values = {}
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"')
    return values


def run(*args: str, **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=True, **kwargs)


def database_ready() -> None:
    """Starts the local PostgreSQL, creating it on first use with the password of server.env."""
    url = settings("server.env")["DATABASE_URL"]
    state = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER], capture_output=True, text=True)
    if state.returncode != 0:
        password = url.split("://", 1)[1].split("@", 1)[0].split(":", 1)[1]
        port = url.rsplit(":", 1)[1].split("/", 1)[0]
        run("docker", "run", "-d", "--name", CONTAINER, "--restart", "unless-stopped",
            "-e", "POSTGRES_USER=sillage", "-e", f"POSTGRES_PASSWORD={password}", "-e", "POSTGRES_DB=sillage",
            "-p", f"127.0.0.1:{port}:5432", "-v", f"{CONTAINER}:/var/lib/postgresql/data", IMAGE, stdout=subprocess.DEVNULL)
    elif state.stdout.strip() != "true":
        run("docker", "start", CONTAINER, stdout=subprocess.DEVNULL)
    while subprocess.run(["docker", "exec", CONTAINER, "pg_isready", "-U", "sillage", "-d", "sillage"], capture_output=True).returncode:
        time.sleep(0.5)


def db_pull() -> None:
    target = shlex.split(settings("dev.env")["SILLAGE_PROD_SSH"])
    dumps = DEV / "dumps"
    dumps.mkdir(parents=True, exist_ok=True, mode=0o700)
    dump = dumps / time.strftime("prod-%Y%m%d-%H%M%S.dump")
    print("Copie de la production…")
    remote = "c=$(docker ps --format '{{.Names}}' | grep '^sillage-db-'); docker exec $c pg_dump -U sillage -Fc sillage"
    with open(os.open(dump, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as handle:
        run("ssh", *target, remote, stdout=handle)
    database_ready()
    for statement in ("drop database if exists sillage with (force)", "create database sillage"):
        run("docker", "exec", CONTAINER, "psql", "-q", "-U", "sillage", "-d", "postgres", "-c", statement)
    with dump.open("rb") as handle:
        run("docker", "exec", "-i", CONTAINER, "pg_restore", "-U", "sillage", "-d", "sillage", "--no-owner", "--no-privileges", stdin=handle)
    for old in sorted(dumps.glob("*.dump"))[:-3]:  # keep the three most recent copies
        old.unlink()
    # The app's development token lived in the replaced database.
    (DEV / "app-data/Session/session.json").unlink(missing_ok=True)
    print(f"Base locale remplacée par {dump.name}.")


def api_process() -> subprocess.Popen:
    database_ready()
    env = {**os.environ, **settings("server.env")}
    return subprocess.Popen(["npm", "run", "dev:server"], cwd=ROOT, env=env)


def session_ready(data: Path) -> None:
    """A token for the development account, created in the local database only."""
    session = data / "Session/session.json"
    if session.exists():
        return
    account = settings("dev.env")["SILLAGE_DEV_ACCOUNT"]
    database_ready()
    env = {**os.environ, **settings("server.env"), "TOKEN_NAME": "Sillage Dev (local)"}
    with tempfile.TemporaryDirectory() as directory:
        connection = Path(directory) / "connection.json"
        run("npx", "tsx", "src/modules/auth/token.cli.ts", "create", account, str(connection), cwd=ROOT / "apps/server", env=env)
        payload = {"server": base64.b64encode(connection.read_bytes()).decode()}
    session.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(os.open(session, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
        json.dump(payload, handle)


def sdk() -> str:
    if os.environ.get("SDKROOT"):
        return os.environ["SDKROOT"]
    xcode = subprocess.run(["xcode-select", "-p"], capture_output=True, text=True).stdout.strip()
    if "Xcode" in xcode:
        return subprocess.run(["xcrun", "--show-sdk-path"], capture_output=True, text=True).stdout.strip()
    # Command Line Tools alone: the SDK the SwiftUI macros of this toolchain compile against.
    return "/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk"


def build() -> bool:
    started = time.time()
    # -interposable lets InjectionNext swap functions in the running app; debug builds only.
    result = subprocess.run(["swift", "build", "--build-system", "native", "--package-path", str(PACKAGE),
                             "--product", "SillageMac", "-Xlinker", "-interposable"],
                            env={**os.environ, "SDKROOT": sdk()})
    if result.returncode == 0:
        print(f"Compilé en {time.time() - started:.1f} s")
    return result.returncode == 0


def assemble(data: Path) -> Path:
    products = PACKAGE / ".build/arm64-apple-macosx/debug"
    contents = BUNDLE / "Contents"
    for name in ("MacOS", "Frameworks", "Resources"):
        (contents / name).mkdir(parents=True, exist_ok=True)
    shutil.copy2(products / "SillageMac", contents / "MacOS/SillageMac")
    resources = contents / "Resources/SillageMac_SillageMac.bundle"
    shutil.rmtree(resources, ignore_errors=True)
    shutil.copytree(products / "SillageMac_SillageMac.bundle", resources)
    framework = contents / "Frameworks/Sparkle.framework"
    if not framework.exists():
        source = next((PACKAGE / ".build/artifacts/sparkle").rglob("macos-arm64_x86_64/Sparkle.framework"))
        shutil.copytree(source, framework, symlinks=True)
        shutil.copy2(PACKAGE / "Resources/Sillage.icns", contents / "Resources/Sillage.icns")
    with (contents / "Info.plist").open("wb") as handle:
        plistlib.dump({
            "CFBundleName": "Sillage Dev", "CFBundleDisplayName": "Sillage Dev", "CFBundleExecutable": "SillageMac",
            "CFBundleIdentifier": "solutions.stoa.sillage.dev", "CFBundlePackageType": "APPL",
            "CFBundleShortVersionString": "0.0.0", "CFBundleVersion": "0", "LSMinimumSystemVersion": "14.0",
            "NSHighResolutionCapable": True, "CFBundleIconFile": "Sillage.icns",
            "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
            "SUEnableAutomaticChecks": False, "SUAutomaticallyUpdate": False,
            # Opened from the Finder or `open`, the app still keeps to its own data folder.
            "LSEnvironment": {"SILLAGE_DATA_DIR": str(data)},
        }, handle)
    run("codesign", "--force", "--sign", "-", str(BUNDLE), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return contents / "MacOS/SillageMac"


def sources_stamp() -> float:
    files = [PACKAGE / "Package.swift", *(PACKAGE / "Sources").rglob("*.swift"), *(PACKAGE / "Sources").rglob("*.json")]
    return max(f.stat().st_mtime for f in files if f.exists())


def app_loop() -> None:
    data = DEV / "app-data"
    session_ready(data)
    env = {**os.environ, "SILLAGE_DATA_DIR": str(data)}
    app: subprocess.Popen | None = None

    def relaunch() -> None:
        nonlocal app
        if app and app.poll() is None:
            app.send_signal(signal.SIGTERM)
            try:
                app.wait(timeout=5)
            except subprocess.TimeoutExpired:
                app.kill()
        app = subprocess.Popen([str(assemble(data))], env=env)

    stamp = sources_stamp()
    if build():
        relaunch()
    print("Sillage Dev surveille apps/macos/Sources : enregistre un fichier Swift pour recompiler.")
    try:
        while True:
            time.sleep(0.4)
            current = sources_stamp()
            if current == stamp:
                continue
            time.sleep(0.3)  # let an editor finish writing several files
            stamp = sources_stamp()
            if build():
                relaunch()
            else:
                print("Échec de compilation : la version précédente reste ouverte.")
    finally:
        if app and app.poll() is None:
            app.terminate()


def main() -> None:
    command = sys.argv[1:] or ["all"]
    if command == ["db", "pull"]:
        db_pull()
    elif command == ["db", "start"]:
        database_ready()
    elif command == ["api"]:
        sys.exit(api_process().wait())
    elif command == ["app"]:
        app_loop()
    elif command == ["all"]:
        api = api_process()
        try:
            app_loop()
        finally:
            api.terminate()
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    sys.stdout.reconfigure(line_buffering=True)  # progress shows up live, even through a pipe
    try:
        main()
    except KeyboardInterrupt:
        pass
