#!/usr/bin/env python3
"""Synthetic archive checks; no Apple compilation or signing qualification."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile


spec = importlib.util.spec_from_file_location("artifact", Path(__file__).with_name("macos-native-artifact.py"))
artifact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifact)


class NativeArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="mediflow-artifact-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.app = self.root / "source" / artifact.APP_NAME
        (self.app / "Contents/MacOS").mkdir(parents=True)
        self.plist = self.app / "Contents/Info.plist"
        self.plist.write_bytes(plistlib.dumps(dict(CFBundleIdentifier="com.mediflow.mobile",
                                                  CFBundlePackageType="APPL", CFBundleExecutable="MediFlow")))
        self.executable = self.app / "Contents/MacOS/MediFlow"
        self.executable.write_bytes(b"\xcf\xfa\xed\xfeSYNTHETIC NOT AN EXECUTABLE")
        self.executable.chmod(0o755)
        self.archive = self.root / "native.zip"
        self.destination = self.root / "output" / artifact.APP_NAME
        self.arguments = dict(revision="a" * 40, configuration="Debug", architecture="arm64")
        self.calls = []
        self.tools = patch.object(artifact, "run", side_effect=self.synthetic_tool)
        self.tools.start()
        self.addCleanup(self.tools.stop)

    def synthetic_tool(self, *arguments):
        self.calls.append(arguments)
        if arguments[0] == "lipo":
            return
        self.assertEqual(arguments[0], "ditto")
        if "-c" in arguments:
            with zipfile.ZipFile(arguments[-1], "w") as archive:
                for path in Path(arguments[-2]).rglob("*"):
                    archive.write(path, path.relative_to(Path(arguments[-2]).parent))
        else:
            with zipfile.ZipFile(arguments[-2]) as archive:
                archive.extractall(arguments[-1])
                for entry in archive.infolist():
                    (Path(arguments[-1]) / entry.filename).chmod((entry.external_attr >> 16) & 0o777)

    def export(self, **overrides):
        artifact.export_artifact(argparse.Namespace(app=str(self.app), output=str(self.archive),
                                                   **(self.arguments | overrides)))

    def import_app(self, **overrides):
        artifact.import_artifact(argparse.Namespace(archive=str(self.archive), destination=str(self.destination),
                                                   **(self.arguments | overrides)))

    def rewrite(self, mutate):
        with zipfile.ZipFile(self.archive) as archive:
            entries = [(entry, archive.read(entry)) for entry in archive.infolist()]
        with zipfile.ZipFile(self.archive, "w") as archive:
            for entry, data in entries:
                archive.writestr(entry, data)
            mutate(archive)
        receipt_file = artifact.receipt_path(self.archive)
        receipt = json.loads(receipt_file.read_text())
        receipt["sha256"] = artifact.digest(self.archive)
        receipt_file.write_text(json.dumps(receipt))

    def assert_rejected(self, message, **overrides):
        self.calls.clear()
        with self.assertRaisesRegex((ValueError, OSError, subprocess.CalledProcessError), message):
            self.import_app(**overrides)
        self.assertFalse(self.destination.exists())

    def test_round_trip_records_full_revision_and_optional_github_provenance(self):
        with patch.dict(os.environ, {"GITHUB_REPOSITORY": "example/mediflow", "GITHUB_RUN_ID": "123",
                                     "GITHUB_RUN_ATTEMPT": "2"}):
            self.export()
        receipt = json.loads(artifact.receipt_path(self.archive).read_text())
        self.assertEqual(receipt, dict(schemaVersion=1, **self.arguments, sha256=artifact.digest(self.archive),
                                       githubRepository="example/mediflow", githubRunId="123", githubRunAttempt="2"))
        self.import_app()
        self.assertEqual((self.destination / "Contents/MacOS/MediFlow").read_bytes(), self.executable.read_bytes())
        self.assertTrue(any(call[0] == "lipo" and call[-2:] == ("-verify_arch", "arm64") for call in self.calls))
        self.assertTrue(any(call[:3] == ("ditto", "-x", "-k") for call in self.calls))

    def test_mismatch_and_short_revision_rejected_before_extraction(self):
        self.export()
        for overrides in (dict(revision="b" * 40), dict(configuration="Release"), dict(architecture="x86_64")):
            with self.subTest(overrides=overrides):
                self.assert_rejected("receipt does not match", **overrides)
                self.assertEqual(self.calls, [])
        self.assert_rejected("full lowercase", revision="a" * 12)

    def test_internal_temporary_alias_is_resolved_without_accepting_caller_aliases(self):
        self.export()
        temporary = self.root / "physical-temp"
        temporary.mkdir()
        alias = self.root / "temp-alias"
        alias.symlink_to(temporary, target_is_directory=True)
        with patch.object(artifact.tempfile, "gettempdir", return_value=str(alias)):
            self.import_app()
        self.assertTrue(self.destination.is_dir())
        self.assertEqual(list(temporary.iterdir()), [])

    def test_hash_and_missing_receipt_rejected_before_destination_mutation(self):
        self.export()
        with self.archive.open("ab") as stream:
            stream.write(b"tampered")
        self.assert_rejected("SHA-256 mismatch")
        self.assertFalse(self.destination.parent.exists())
        artifact.receipt_path(self.archive).unlink()
        self.assert_rejected("Missing path")
        self.assertFalse(self.destination.parent.exists())

    def test_path_traversal_absolute_foreign_and_alias_paths_rejected_before_ditto(self):
        self.export()
        original = self.archive.read_bytes()
        for name in ("../escape", "/escape", "Other.app/Contents/file", "MediFlow.app/Contents/../escape",
                     "MediFlow.app/Contents/./escape", "MediFlow.app/Contents//escape", "MediFlow.app/Contents/file:stream",
                     "MediFlow.app/Contents\\escape", "MediFlow.app/contents/info.plist"):
            with self.subTest(name=name):
                self.archive.write_bytes(original)
                self.rewrite(lambda archive: archive.writestr(name, b"unsafe"))
                self.assert_rejected("Unsafe ZIP|Duplicate ZIP")
                self.assertEqual(self.calls, [])
                self.assertFalse(self.destination.parent.exists())

    def test_symlinks_special_files_and_sealed_or_packaged_apps_rejected(self):
        self.export()
        original = self.archive.read_bytes()
        for mode in (stat.S_IFLNK | 0o777, stat.S_IFIFO | 0o600):
            self.archive.write_bytes(original)
            entry = zipfile.ZipInfo("MediFlow.app/Contents/unsafe")
            entry.create_system = 3
            entry.external_attr = mode << 16
            self.rewrite(lambda archive: archive.writestr(entry, b"../../outside"))
            self.assert_rejected("symlink or special file")
            self.assertEqual(self.calls, [])
        for name in ("Contents/_CodeSignature/CodeResources", "Contents/CodeResources", "Contents/Resources/WebRuntime/server.js",
                     "Contents/Helpers/existing-helper"):
            self.archive.write_bytes(original)
            self.rewrite(lambda archive: archive.writestr("MediFlow.app/" + name, b"sealed"))
            self.assert_rejected("sealed|packaged")
            self.assertEqual(self.calls, [])

    def test_existing_destination_and_symlink_ancestors_preserved(self):
        self.export()
        self.destination.mkdir(parents=True)
        marker = self.destination / "keep"
        marker.write_text("preserved")
        with self.assertRaisesRegex(ValueError, "fresh"):
            self.import_app()
        self.assertEqual(marker.read_text(), "preserved")
        alias = self.root / "alias"
        alias.symlink_to(self.destination.parent, target_is_directory=True)
        self.destination = alias / "new" / artifact.APP_NAME
        self.assert_rejected("Symlink path")
        self.assertFalse((self.root / "output/new").exists())

    def test_native_bundle_and_lipo_validation_fail_without_publishing_destination(self):
        self.plist.write_bytes(plistlib.dumps(dict(CFBundleIdentifier="foreign", CFBundlePackageType="APPL", CFBundleExecutable="MediFlow")))
        with self.assertRaisesRegex(ValueError, "Info.plist"):
            self.export()
        self.assertFalse(self.archive.exists())
        self.setUp_valid_plist()
        self.export()
        def fail_lipo(*arguments):
            if arguments[0] == "lipo":
                raise subprocess.CalledProcessError(1, arguments)
            self.synthetic_tool(*arguments)
        with patch.object(artifact, "run", side_effect=fail_lipo):
            self.assert_rejected("non-zero exit")

    def setUp_valid_plist(self):
        self.plist.write_bytes(plistlib.dumps(dict(CFBundleIdentifier="com.mediflow.mobile", CFBundlePackageType="APPL", CFBundleExecutable="MediFlow")))

    def test_export_refuses_symlink_and_sealed_or_already_stamped_source(self):
        target = self.app / "Contents/link"
        target.symlink_to(self.plist)
        with self.assertRaisesRegex(ValueError, "Nonphysical"):
            self.export()
        target.unlink()
        target = self.app / "Contents/_CodeSignature"
        target.mkdir()
        with self.assertRaisesRegex(ValueError, "sealed"):
            self.export()
        target.rmdir()
        info = plistlib.loads(self.plist.read_bytes())
        info["LSEnvironment"] = {"MEDIFLOW_APP_REVISION": "already-packaged"}
        self.plist.write_bytes(plistlib.dumps(info))
        with self.assertRaisesRegex(ValueError, "stamped"):
            self.export()


if __name__ == "__main__":
    unittest.main()
