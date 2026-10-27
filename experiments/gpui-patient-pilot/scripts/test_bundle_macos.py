import json
import plistlib
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

    def test_manifest_rejects_missing_embedded_brand(self):
        with tempfile.TemporaryDirectory() as directory:
            executable = Path(directory) / "client"
            assets = bundle.brand_assets()
            executable.write_bytes(b"executable" + b"".join(data for _, data in assets))
            self.assertEqual(len(bundle.embedded_brand_inventory(executable)), 2)
            for name, missing in assets:
                executable.write_bytes(b"executable" + b"".join(data for _, data in assets if data != missing))
                with self.assertRaisesRegex(ValueError, name):
                    bundle.embedded_brand_inventory(executable)

    def test_minimum_macos_matches_u0_and_generated_plist(self):
        config = json.loads((bundle.PACKAGING / "macos.json").read_text())
        info = plistlib.loads(plistlib.dumps(bundle.bundle_info(config, "0.1.0", "abcdef")))
        self.assertEqual(info["LSMinimumSystemVersion"], bundle.contract_minimum_macos())
        config["minimum_macos"] = "11.0"
        with self.assertRaisesRegex(ValueError, "U0"):
            bundle.bundle_info(config, "0.1.0", "abcdef")

    def test_link_only_license_is_rejected_in_source_and_supplement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "crate"
            source.mkdir()
            packaging = root / "packaging"
            licenses = packaging / "licenses"
            licenses.mkdir(parents=True)
            text = licenses / "LICENSE.md"
            text.write_text("Licensed under [MIT](https://opensource.org/license/MIT).\n")
            (licenses / "sources.json").write_text(json.dumps([{
                "package": "crate@1", "file": text.name, "sha256": bundle.digest(text)}]))
            metadata = {"workspace_members": [], "packages": [{
                "id": "crate", "name": "crate", "version": "1", "source": "registry",
                "license": "MIT", "manifest_path": str(source / "Cargo.toml")}]}
            with patch.object(bundle, "PACKAGING", packaging):
                for kind in ("supplement", "source"):
                    if kind == "source":
                        (source / "LICENSE.md").write_bytes(text.read_bytes())
                    with self.assertRaisesRegex(ValueError, "Missing complete license text for crate@1"):
                        bundle.collect_licenses(metadata, root / kind)

    def test_build_number_uses_numeric_apple_components(self):
        self.assertEqual(bundle.build_number("000000" + "0" * 34), "1.0.0")
        self.assertEqual(bundle.build_number("ffffff" + "0" * 34), "1678.72.15")
        self.assertNotEqual(bundle.build_number("abcdef"), bundle.build_number("abcdee"))

    def test_every_versioned_supplement_has_complete_text_in_package_directory(self):
        supplements = json.loads((bundle.PACKAGING / "licenses/sources.json").read_text())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "crate"
            source.mkdir()
            (source / "copying.rs").write_text("pub struct Copying;")
            packages = []
            for item in supplements:
                name, version = item["package"].split("@")
                packages.append({"id": item["package"], "name": name, "version": version,
                                 "source": "registry", "license": "MIT",
                                 "manifest_path": str(source / "Cargo.toml")})
            destination = root / "licenses"
            bundle.collect_licenses({"workspace_members": [], "packages": packages}, destination)
            inventory = json.loads((destination / "packages.json").read_text())["packages"]
            self.assertEqual(len(inventory), len(supplements))
            for item in supplements:
                with self.subTest(package=item["package"]):
                    output = destination / item["package"]
                    self.assertTrue(bundle.has_complete_license_text(list(output.iterdir())))
                    for extra in item.get("license_texts", []):
                        self.assertEqual(bundle.digest(output / extra["file"]), extra["sha256"])

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
