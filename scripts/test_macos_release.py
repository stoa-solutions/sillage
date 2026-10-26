import tempfile
import unittest
from pathlib import Path
from macos_release import release_names, require_public_signing, signing_targets, verify_clean_bundle, validate_update_configuration


class MacReleaseTests(unittest.TestCase):
    def test_public_release_requires_real_distribution_configuration(self):
        for identity, profile, tools in [('-', 'profile', True), ('Sillage local', 'profile', True), ('Developer ID Application: Stoa (TEAM)', '', True), ('Developer ID Application: Stoa (TEAM)', 'profile', False)]:
            with self.subTest(identity=identity, profile=profile, tools=tools):
                with self.assertRaises(ValueError):
                    require_public_signing(identity, profile, tools)
        require_public_signing('Developer ID Application: Stoa (TEAM)', 'profile', True)

    def test_update_configuration_cannot_embed_private_url_credentials(self):
        key = 'A' * 43 + '='
        validate_update_configuration('', '')
        validate_update_configuration('https://updates.example.test/appcast.xml', key)
        for feed, value in [('http://example.test/feed', key), ('https://user:secret@example.test/feed', key), ('https://example.test/feed?token=private', key), ('https://example.test/feed#secret', key), ('https://example.test/feed', 'invalid'), ('', key)]:
            with self.subTest(feed=feed):
                with self.assertRaises(ValueError):
                    validate_update_configuration(feed, value)

    def test_brand_names_cannot_escape_output_directory(self):
        self.assertEqual(release_names('1.8.1', 'universal'), ('Sillage-1.8.1-universal.zip', 'Sillage-1.8.1-universal.dmg'))
        for version, architecture in [('../1.8.1', 'universal'), ('1.8.1', '../arm64'), ('1.8.1\n', 'arm64')]:
            with self.assertRaises(ValueError):
                release_names(version, architecture)

    def test_signing_is_inside_out_without_following_framework_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / 'Sillage.app'
            framework = app / 'Contents/Frameworks/Sparkle.framework'
            helper = framework / 'Versions/B/XPCServices/Installer.xpc'
            binary = helper / 'Contents/MacOS/Installer'
            binary.parent.mkdir(parents=True)
            binary.write_bytes(b'\xcf\xfa\xed\xfe' + b'fixture')
            (framework / 'Current').symlink_to('Versions/B', target_is_directory=True)
            targets = signing_targets(app)
            self.assertEqual(targets, [binary, helper, framework])

    def test_packaging_excludes_sessions_and_private_signing_keys(self):
        for name in ['Session/server', 'Resources/.env', 'Resources/key.p12']:
            with tempfile.TemporaryDirectory() as directory:
                app = Path(directory)
                path = app / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('synthetic')
                with self.assertRaises(ValueError):
                    verify_clean_bundle(app)
        with tempfile.TemporaryDirectory() as directory:
            verify_clean_bundle(Path(directory))


if __name__ == '__main__':
    unittest.main()
