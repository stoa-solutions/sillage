"""Small, testable rules shared by the Mac packager and its release checks."""
import re
import base64
from urllib.parse import urlsplit
from pathlib import Path

VERSION = re.compile(r"\d+\.\d+\.\d+\Z")
MACH_O = {b'\xfe\xed\xfa\xce', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca'}


def release_names(version, architecture):
    if not VERSION.fullmatch(version) or architecture not in {'arm64', 'x86_64', 'universal'}:
        raise ValueError('Invalid release version or architecture')
    stem = f'Sillage-{version}-{architecture}'
    return stem + '.zip', stem + '.dmg'


def require_public_signing(identity, profile, tools_available):
    if not identity.startswith('Developer ID Application:'):
        raise ValueError('Public release requires an Apple Developer ID Application certificate. Local signatures are previews only.')
    if not profile:
        raise ValueError('Public release requires MAC_NOTARY_PROFILE, stored privately in Keychain.')
    if not tools_available:
        raise ValueError('Public release requires working notarytool and stapler, discoverable through xcrun.')


def signing_targets(bundle):
    """Sign real files first, then containers from the inside out; never follow symlinks."""
    binaries, containers = [], []
    for path in Path(bundle).rglob('*'):
        if path.is_symlink():
            continue
        if path.is_dir() and path.suffix in {'.app', '.xpc', '.framework'}:
            containers.append(path)
        if path.is_file():
            with path.open('rb') as stream:
                if stream.read(4) in MACH_O:
                    binaries.append(path)
    order = lambda path: (-len(path.parts), str(path))
    return sorted(binaries, key=order) + sorted(containers, key=order)


def verify_clean_bundle(bundle):
    """Reject runtime data and credential material accidentally included as resources."""
    forbidden = {'.env', 'server.json', 'legacy-server.json', 'session.json', 'credentials.json', 'local-signing.json', 'Session', 'Studio', '.git', 'node_modules'}
    for path in Path(bundle).rglob('*'):
        if path.name in forbidden or path.suffix.lower() in {'.p12', '.p8', '.key', '.pem'}:
            raise ValueError(f'Refusing runtime or signing material in bundle: {path.relative_to(bundle)}')


def validate_update_configuration(feed, key):
    if not feed and not key:
        return
    if not feed or not key:
        raise ValueError('Automatic updates need both MAC_UPDATE_FEED_URL and MAC_UPDATE_PUBLIC_KEY')
    origin = urlsplit(feed)
    if origin.scheme != 'https' or not origin.hostname or origin.username or origin.password or origin.query or origin.fragment:
        raise ValueError('Update feeds must use HTTPS without credentials, query or fragment')
    try:
        if len(base64.b64decode(key, validate=True)) != 32:
            raise ValueError()
    except (ValueError, TypeError):
        raise ValueError('Updates require a base64 Ed25519 public key') from None
