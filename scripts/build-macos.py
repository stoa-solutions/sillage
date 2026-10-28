"""Build Sillage without credentials; public releases require Apple validation."""
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
from macos_release import release_names, require_public_signing, signing_targets, verify_clean_bundle, validate_update_configuration

root = Path(__file__).resolve().parent.parent
project = root / 'apps/macos'
release_version = json.loads((project / 'version.json').read_text())
parser = argparse.ArgumentParser()
parser.add_argument('--universal', action='store_true')
parser.add_argument('--dmg', action='store_true', help='Also create a drag-to-Applications installation disk')
parser.add_argument('--public-release', action='store_true', help='Require Developer ID, notarization and Gatekeeper acceptance before emitting release metadata')
parser.add_argument('--skip-update-signature', action='store_true', help='Preview only; automatic updates disabled')
parser.add_argument('--version', default=release_version['version'])
parser.add_argument('--build', default=release_version['build'])
args = parser.parse_args()
if not re.fullmatch(r'\d+\.\d+\.\d+', args.version) or not args.build.isdigit():
    parser.error('Use a three-part version and a numeric build number')
output = root / '.output/macos'
output.mkdir(parents=True, exist_ok=True)
(output / 'release.json').unlink(missing_ok=True)
local_config = Path.home() / '.config/playlist-recall/local-signing.json'
local_identity = json.loads(local_config.read_text()).get('identity') if local_config.exists() else None
identity = os.environ.get('MAC_SIGNING_IDENTITY') or local_identity or '-'
profile = os.environ.get('MAC_NOTARY_PROFILE') if args.public_release else None
feed = os.environ.get('MAC_UPDATE_FEED_URL', '')
update_key = os.environ.get('MAC_UPDATE_PUBLIC_KEY', '')
if args.public_release:
    if args.skip_update_signature:
        parser.error('A local preview cannot also be a public release')
    tools_available = all(subprocess.run(['xcrun', '--find', tool], capture_output=True).returncode == 0 for tool in ['notarytool', 'stapler'])
    try:
        require_public_signing(identity, profile, tools_available)
    except ValueError as error:
        parser.error(str(error))
try:
    validate_update_configuration(feed, update_key)
except ValueError as error:
    parser.error(str(error))
updates = bool(feed) and not args.skip_update_signature
architectures = ['arm64', 'x86_64'] if args.universal else [platform.machine()]
label = 'universal' if args.universal else architectures[0]
archive_name, disk_name = release_names(args.version, label)
for arch in architectures:
    # Keep the tested SwiftPM artifact layout used by the bundle assembly below.
    subprocess.run(['swift', 'build', '--build-system', 'native', '--package-path', str(project), '-c', 'release', '--arch', arch], check=True)
bundle = output / 'Sillage.app'
if bundle.exists():
    shutil.rmtree(bundle)
contents = bundle / 'Contents'
for name in ['MacOS', 'Frameworks', 'Resources']:
    (contents / name).mkdir(parents=True)
binaries = [project / f'.build/{arch}-apple-macosx/release/RecallMac' for arch in architectures]
executable = contents / 'MacOS/RecallMac'
if len(binaries) == 1:
    shutil.copy2(binaries[0], executable)
else:
    subprocess.run(['lipo', '-create', *map(str, binaries), '-output', str(executable)], check=True)
executable.chmod(0o755)
framework = next((project / '.build/artifacts/sparkle').rglob('macos-arm64_x86_64/Sparkle.framework'))
shutil.copytree(framework, contents / 'Frameworks/Sparkle.framework', symlinks=True)
resources = project / f'.build/{architectures[0]}-apple-macosx/release/PlaylistRecallMac_RecallMac.bundle'
shutil.copytree(resources, contents / 'Resources' / resources.name)
for name in ['Sillage.icns', 'Installation.txt']:
    shutil.copy2(project / 'Resources' / name, contents / 'Resources' / name)
shutil.copy2(project / '.build/artifacts/sparkle/Sparkle/LICENSE', contents / 'Resources/Sparkle-LICENSE.txt')
info = {
    'CFBundleName': 'Sillage', 'CFBundleDisplayName': 'Sillage', 'CFBundleExecutable': 'RecallMac',
    'CFBundleIdentifier': 'solutions.stoa.playlist-recall', 'CFBundlePackageType': 'APPL',
    'CFBundleURLTypes': [{'CFBundleURLName': 'Sillage Sign In', 'CFBundleURLSchemes': ['playlist-recall']}],
    'CFBundleShortVersionString': args.version, 'CFBundleVersion': args.build,
    'LSMinimumSystemVersion': '14.0', 'NSHighResolutionCapable': True, 'CFBundleIconFile': 'Sillage.icns',
    'NSMicrophoneUsageDescription': 'Sillage écoute ton envie musicale seulement quand tu actives le micro.',
    'NSSpeechRecognitionUsageDescription': 'Sillage transforme ta demande vocale en texte pour ton DJ personnel.',
    'NSAppTransportSecurity': {'NSAllowsLocalNetworking': True},
    'SUEnableAutomaticChecks': updates, 'SUAutomaticallyUpdate': updates, 'SUEnableSystemProfiling': False,
}
if updates:
    info.update(SUFeedURL=feed, SUPublicEDKey=update_key)
with (contents / 'Info.plist').open('wb') as handle:
    plistlib.dump(info, handle)
verify_clean_bundle(bundle)
entitlements = output / 'entitlements.plist'
values = {'com.apple.security.device.audio-input': True}
if not args.public_release:
    values['com.apple.security.cs.disable-library-validation'] = True
with entitlements.open('wb') as handle:
    plistlib.dump(values, handle)
# Never sign with --deep: nested Sparkle code must be signed from the inside out.
for target in signing_targets(bundle) + [bundle]:
    command = ['codesign', '--force', '--sign', identity, '--options', 'runtime']
    if args.public_release:
        command.append('--timestamp')
    if target == bundle:
        command.extend(['--entitlements', str(entitlements)])
    subprocess.run(command + [str(target)], check=True)
subprocess.run(['codesign', '--verify', '--deep', '--strict', str(bundle)], check=True)

def notarize(path):
    result = json.loads(subprocess.check_output(['xcrun', 'notarytool', 'submit', str(path), '--keychain-profile', profile, '--wait', '--output-format', 'json'], text=True))
    if result.get('status') != 'Accepted':
        raise SystemExit('Apple notarization was not accepted; release metadata was not emitted')
    return result['id']

notarization = {}
if args.public_release:
    submission = output / 'notary-submission.zip'
    subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(bundle), str(submission)], check=True)
    notarization['appSubmission'] = notarize(submission)
    subprocess.run(['xcrun', 'stapler', 'staple', str(bundle)], check=True)
    subprocess.run(['xcrun', 'stapler', 'validate', str(bundle)], check=True)
    subprocess.run(['spctl', '--assess', '--type', 'execute', '--verbose=2', str(bundle)], check=True)
archive = output / archive_name
archive.unlink(missing_ok=True)
subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(bundle), str(archive)], check=True)
signature = None
if updates:
    tools = project / '.build/artifacts/sparkle/Sparkle/bin'
    with tempfile.TemporaryDirectory(prefix='sillage-sign-') as temp:
        signing_copy = Path(temp) / archive.name
        shutil.copy2(archive, signing_copy)
        signature = subprocess.check_output([str(tools / 'sign_update'), '--account', 'recall-macos-updates', '-p', str(signing_copy)], text=True, timeout=120).strip()
        subprocess.run([str(tools / 'sign_update'), '--account', 'recall-macos-updates', '--verify', str(signing_copy), signature], check=True, timeout=120)
manifest = {
    'version': args.version, 'build': args.build, 'architecture': label,
    'minimumSystemVersion': '14.0', 'file': archive.name, 'size': archive.stat().st_size,
    'signature': signature, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
    'notarized': args.public_release, 'signing': 'Developer ID' if args.public_release else 'ad-hoc' if identity == '-' else 'local certificate',
    'distribution': 'public' if args.public_release else 'preview', 'automaticUpdates': updates,
    'sourceCommit': subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip(),
    'notarization': notarization,
}
if args.dmg or args.public_release:
    disk = output / disk_name
    with tempfile.TemporaryDirectory(prefix='sillage-installer-') as temp:
        stage = Path(temp)
        subprocess.run(['ditto', str(bundle), str(stage / bundle.name)], check=True)
        (stage / 'Applications').symlink_to('/Applications')
        shutil.copy2(project / 'Resources/Installation.txt', stage / 'Installation.txt')
        if not args.public_release:
            (stage / 'Aperçu non notarisé.txt').write_text('Version de préparation. Cette app ne dispose pas encore de validation Apple.\nElle ne doit pas être présentée comme une version publique sans avertissement.\n')
        subprocess.run(['hdiutil', 'create', '-volname', 'Sillage', '-srcfolder', str(stage), '-ov', '-format', 'UDZO', str(disk)], check=True)
    if args.public_release:
        subprocess.run(['codesign', '--sign', identity, '--timestamp', '--identifier', 'solutions.stoa.playlist-recall.installer', str(disk)], check=True)
        notarization['dmgSubmission'] = notarize(disk)
        subprocess.run(['xcrun', 'stapler', 'staple', str(disk)], check=True)
        subprocess.run(['xcrun', 'stapler', 'validate', str(disk)], check=True)
        subprocess.run(['spctl', '--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', str(disk)], check=True)
    manifest.update(installer=disk.name, installerSize=disk.stat().st_size, installerSha256=hashlib.sha256(disk.read_bytes()).hexdigest())
(output / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n')
(output / 'SHA256SUMS.txt').write_text(''.join(f'{manifest[key]}  {manifest[name]}\n' for key, name in [('sha256', 'file'), ('installerSha256', 'installer')] if name in manifest))
print(json.dumps(manifest, indent=2))
print('Public release validated by Apple.' if args.public_release else 'PREVIEW ONLY: Apple Developer ID and notarization still required before public download.')
