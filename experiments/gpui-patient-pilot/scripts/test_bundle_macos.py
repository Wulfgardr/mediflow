import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import bundle_macos as bundle


class BundleTests(unittest.TestCase):
    def test_staging_preserves_existing_artifacts_and_rejects_installation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for destination in (root, Path.home() / "Applications/candidate", Path("/Applications/candidate"), Path("/APPLICATIONS/candidate"), bundle.ROOT / "output"):
                with self.assertRaises(ValueError):
                    bundle.validate_destination(destination)
            (root / "redirect").symlink_to(Path.home() / "Applications")
            with self.assertRaises(ValueError):
                bundle.validate_destination(root / "redirect/candidate")
            self.assertEqual(bundle.validate_destination(root / "new"), root.resolve() / "new")

    def test_inventory_detects_content_mode_and_resource_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            resource = root / "resource"
            resource.write_bytes(b"original")
            before = bundle.inventory(root)
            self.assertEqual(before, bundle.inventory(root))
            resource.write_bytes(b"modified")
            self.assertNotEqual(before, bundle.inventory(root))
            resource.write_bytes(b"original")
            resource.chmod(0o755)
            self.assertNotEqual(before, bundle.inventory(root))
            resource.unlink()
            self.assertNotEqual(before, bundle.inventory(root))
            resource.symlink_to("missing")
            with self.assertRaises(ValueError):
                bundle.inventory(root)

    def test_build_number_uses_numeric_apple_components(self):
        self.assertEqual(bundle.build_number("000000" + "0" * 34), "1.0.0")
        self.assertEqual(bundle.build_number("ffffff" + "0" * 34), "1678.72.15")
        self.assertNotEqual(bundle.build_number("abcdef"), bundle.build_number("abcdee"))

    def test_missing_or_tampered_license_stops_packaging(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "crate"
            source.mkdir()
            packaging = root / "packaging"
            (packaging / "licenses").mkdir(parents=True)
            index = packaging / "licenses/sources.json"
            index.write_text("[]")
            metadata = {"workspace_members": [], "packages": [{
                "id": "crate", "name": "crate", "version": "1", "source": "registry",
                "license": "MIT", "manifest_path": str(source / "Cargo.toml")}]}
            with patch.object(bundle, "PACKAGING", packaging):
                with self.assertRaisesRegex(ValueError, "Missing license"):
                    bundle.collect_licenses(metadata, root / "missing")
                index.write_text(json.dumps([{"package": "crate@1", "file": "MIT", "sha256": "bad"}]))
                (packaging / "licenses/MIT").write_text("tampered")
                with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                    bundle.collect_licenses(metadata, root / "tampered")


if __name__ == "__main__":
    unittest.main()
